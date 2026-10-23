// Port of src/features/walks/add-food-stop.ts: routes the way through a food place between its neighbouring
// stops and saves the walk with the new stop — in place for the walker's own walk, as a copy otherwise.
import 'dart:convert';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../app/providers.dart';
import '../../core/api/api_error.dart';
import '../../core/settings/settings_store.dart';
import '../../walk_engine/checkpoint.dart';
import '../../walk_engine/cities.dart';
import '../../walk_engine/json_read.dart';
import '../../walk_engine/walk_session.dart' show CheckpointStore;
import '../../walk_engine/walk_view.dart';
import '../food/food_model.dart';
import '../player/checkpoint_store.dart';
import '../walk_builder/builder_api.dart';
import '../walk_builder/builder_storage.dart' show newUuid;
import '../walk_builder/model.dart' show Plan, isPlanIn;
import 'food_stop.dart';
import 'local_walks.dart';
import 'walk_link.dart';
import 'walk_loader.dart';

/// The changed walk; [moved] links to the copy when the walk was not the walker's own.
class FoodStopResult {
  const FoodStopResult(this.data, this.moved);
  final WalkViewData data;

  /// The copy's link when the walk was not the walker's own; null when it changed in place.
  final WalkLink? moved;
}

/// An account walk as the server saved it.
typedef SavedAccountWalk = ({String id, int revision});

/// What [addFoodStop] needs from the app; tests pass fakes.
class FoodStopDeps {
  const FoodStopDeps({
    required this.plan,
    required this.updateAccountWalk,
    required this.createAccountWalk,
    required this.signedInUserId,
    required this.localStore,
    required this.settings,
    required this.checkpoints,
    required this.newId,
  });

  /// `POST /api/walk-plan` with the raw answer; transient failures may be retried.
  final Future<Object?> Function(Map<String, Object?> body) plan;

  /// `PATCH /api/me/walks/{id}` guarded by [revision]; never retried.
  final Future<SavedAccountWalk> Function(String id, String title, Map<String, Object?> snapshot, int revision) updateAccountWalk;

  /// `POST /api/me/walks`; [idempotencyKey] makes a repeated send return the walk created first.
  final Future<SavedAccountWalk> Function(String title, Map<String, Object?> snapshot, String idempotencyKey) createAccountWalk;

  /// The signed-in user's id, or null for a guest.
  final Future<String?> Function() signedInUserId;
  final LocalWalkStore localStore;

  /// Keeps the walk direction of every walk.
  final SettingsStore settings;

  /// Keeps the playback checkpoints (`otgolosok:playback:…`).
  final CheckpointStore checkpoints;
  final String Function() newId;
}

const _refusedWay = FoodStopError('Не получилось проложить пешеходный путь к этому заведению.');
const _badPlan = ApiError.corrupt('Сервис вернул некорректный маршрут. Попробуйте ещё раз.');

PlaybackLocale _playbackLocale(ContentLocale locale) => switch (locale) {
      ContentLocale.ru => PlaybackLocale.ru,
      ContentLocale.en => PlaybackLocale.en,
      ContentLocale.zh => PlaybackLocale.zh,
    };

/// The copy keeps the walker's direction and the place in the story they were listening to (in the
/// walk's language only). Without storage the copy starts from the beginning, as any new walk.
Future<void> _carryOver(FoodStopDeps deps, String from, String to, ContentLocale locale) async {
  try {
    if (deps.settings.reversed(from)) await deps.settings.setReversed(to, true);
    final playback = _playbackLocale(locale);
    for (final suffix in const ['', ':reverse']) {
      final raw = deps.checkpoints.read(playbackStorageKey(from, playback) + suffix);
      if (raw == null) continue;
      final checkpoint = jsonDecode(raw);
      if (checkpoint is Map<String, Object?> && checkpoint['routeId'] == from) {
        await deps.checkpoints.write(playbackStorageKey(to, playback) + suffix, jsonEncode({...checkpoint, 'routeId': to}));
      }
    }
  } on Object catch (_) {
    // The copy is saved already; losing the direction or the checkpoint must not fail it.
  }
}

/// Routes the way through [place] between its neighbouring stops and saves the walk of [link] with it.
/// Throws [FoodStopError] when the venue cannot join the walk, and the API or storage errors as they are.
Future<FoodStopResult> addFoodStop(WalkViewData data, WalkLink link, FoodPlace place, FoodStopDeps deps) async {
  // A localized view may carry translated display labels. Mutations always start from the source
  // document so translated labels are never persisted as Russian.
  final source = data.view.sourceDocument ?? data.view.document;
  final sourceJson = readMap(data.json['sourceDocument'] ?? data.json['document']);
  final leg = foodStopLeg(source, place.location);
  final request = foodLegRequest(leg, place);
  Plan? plan;
  if (request != null) {
    final Object? value;
    try {
      value = await deps.plan(request);
    } on ApiError catch (error) {
      // The planner's own words speak of a whole walk; a refused way is about this venue.
      if (error.status == 400 || error.status == 404) throw _refusedWay;
      rethrow;
    }
    // The way to the venue stays in the walk's own city, whichever city that is.
    if (!isPlanIn(value, (lat, lon) => cityAt(lat, lon)?.name == source.city) || readList(readMap(value)['stops']).length != 1) throw _badPlan;
    plan = Plan.fromJson(value);
  }
  final changed = insertFoodStop(sourceJson, place, leg, plan, deps.newId());
  final locale = data.view.locale;
  switch (link) {
    case LocalWalkLink():
      final item = await deps.localStore.save(WalkDocument.fromJson(changed), expectedRevision: data.view.revision);
      return FoodStopResult(viewWithDocument(data, item.document.toJson(), item.revision, _localVersion(locale, item.revision)), null);
    case AccountWalkLink(:final id):
      final walk = await deps.updateAccountWalk(id, readString(changed['title']), changed, data.view.revision);
      return FoodStopResult(viewWithDocument(data, changed, walk.revision, 'account:${walk.revision}'), null);
    case CatalogWalkLink() || SharedWalkLink():
      // Someone else's walk stays as published: the walker gets their own copy, in the account when signed in.
      final copy = <String, Object?>{...changed, 'id': deps.newId()};
      validateWalkDocumentJson(copy);
      final copyId = copy['id']! as String;
      String? user;
      try {
        user = await deps.signedInUserId();
      } on Object catch (_) {
        // Without a known session the copy stays on the device, as for a guest.
      }
      if (user != null) {
        final walk = await deps.createAccountWalk(readString(copy['title']), copy, 'walk-$copyId');
        // The server assigns a fresh ID when the document's ID is taken.
        final document = <String, Object?>{...copy, 'id': walk.id};
        validateWalkDocumentJson(document);
        await _carryOver(deps, data.view.document.id, walk.id, locale);
        return FoodStopResult(viewWithDocument(data, document, walk.revision, 'account:${walk.revision}'), AccountWalkLink(walk.id));
      }
      final item = await deps.localStore.save(WalkDocument.fromJson(copy));
      await _carryOver(deps, data.view.document.id, copyId, locale);
      return FoodStopResult(viewWithDocument(data, item.document.toJson(), item.revision, _localVersion(locale, item.revision)), LocalWalkLink(copyId));
  }
}

/// The content version a local walk view carries, as `localWalkView` builds it.
String _localVersion(ContentLocale locale, int revision) => locale == ContentLocale.ru ? 'local:$revision' : 'local:${locale.wire}:$revision';

SavedAccountWalk _saved(AccountWalkRecord record) => (id: record.walk.id, revision: record.walk.revision);

/// [FoodStopDeps] wired to the app's API, session, device walks and preferences.
final foodStopDepsProvider = Provider<FoodStopDeps>((ref) {
  final api = ref.watch(builderApiProvider);
  final session = ref.watch(sessionStoreProvider);
  final settings = ref.watch(settingsProvider);
  return FoodStopDeps(
    plan: api.plan,
    updateAccountWalk: (id, title, snapshot, revision) async => _saved(await api.updateAccountWalk(id, title, snapshot, revision)),
    createAccountWalk: (title, snapshot, key) async => _saved(await api.createAccountWalk(title, snapshot, key)),
    signedInUserId: () async => session.user?.id,
    localStore: ref.watch(localWalkStoreProvider),
    settings: settings,
    checkpoints: SettingsCheckpointStore(settings),
    newId: newUuid,
  );
});
