// State of the walk builder: a port of use-walk-draft.ts, the logic of walk-creation-panel.tsx and
// research-panel.tsx. Texts are kept as Russian sources ([UiText]) and translated by the screen.
import 'dart:async';
import 'dart:convert';
import 'dart:math' as math;

import 'package:flutter/foundation.dart';

import '../../core/api/api_error.dart';
import '../../core/auth/session.dart';
import '../../core/location/locate.dart';
import '../../walk_engine/car_route.dart';
import '../../walk_engine/distance.dart';
import '../walks/walk_cards.dart' show WalkAccess, WalkCard;
import 'builder_api.dart';
import 'builder_storage.dart';
import 'messages.dart';
import 'model.dart';
import 'throttle.dart';
import 'walk_document.dart';

/// Which walk the builder opens (site `/?walk=create&…`).
class BuilderArgs {
  const BuilderArgs({this.localId, this.accountId, this.incoming, this.resume = false});

  final String? localId;
  final String? accountId;

  /// A start point handed over by the map («Построить прогулку отсюда»).
  final Place? incoming;

  /// Continue the stored draft instead of starting a new one.
  final bool resume;

  bool get fresh => localId == null && accountId == null && !resume;

  static final _uuid = RegExp(r'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$');

  /// The arguments of a builder link, or the Russian source of why the link cannot be opened
  /// (site `creationInputError`).
  static ({BuilderArgs? args, String? error}) parse(Map<String, String> query) {
    const conflict = 'Ссылка содержит конфликтующие параметры.';
    final ids = ['local', 'id', 'catalog', 'share'].where(query.containsKey).toList();
    final incoming = ['address', 'lat', 'lon'].any(query.containsKey);
    final isNew = query.containsKey('new'), resume = query.containsKey('resume');
    if (ids.length > 1 || (ids.isNotEmpty && (incoming || isNew || resume)) || (isNew && resume)) return (args: null, error: conflict);
    if (ids.any((key) => key != 'local' && key != 'id')) return (args: null, error: 'Редактировать можно только свою прогулку.');
    final local = query['local'], id = query['id'];
    if (local != null && !_uuid.hasMatch(local)) return (args: null, error: 'Локальная прогулка не найдена. Исходные данные сохранены.');
    if (id != null && !_uuid.hasMatch(id)) return (args: null, error: 'Прогулка не найдена.');
    Place? place;
    if (incoming) {
      place = placeFromQuery(query);
      if (place == null) return (args: null, error: 'В ссылке нет корректной точки начала. Выберите адрес в Москве.');
    }
    return (args: BuilderArgs(localId: local, accountId: id, incoming: place, resume: resume), error: null);
  }
}

/// Site `placeFromQuery`: an address with its point in Moscow.
Place? placeFromQuery(Map<String, String> query) {
  final address = query['address'], lat = double.tryParse(query['lat'] ?? ''), lon = double.tryParse(query['lon'] ?? '');
  if (address == null || address.isEmpty || lat == null || lon == null) return null;
  final place = {'address': address, 'location': {'lat': lat, 'lon': lon}};
  return address.length <= 180 && isPlace(place) ? Place.fromJson(place) : null;
}

enum BuilderTarget { start, destination, stop }

/// How the end of the walk is chosen: a place or a duration.
enum EndpointMode { destination, time }

enum SaveOutcome { saved, review, login, failed }

class BuilderServices {
  const BuilderServices({
    required this.api,
    required this.storage,
    required this.walks,
    required this.session,
    required this.preferredTravelMode,
    this.locator,
    this.clock = const SystemClock(),
    this.uuid = newUuid,
  });

  final BuilderApi api;
  final BuilderStorage storage;
  final DeviceLocalWalkStore walks;

  /// The signed-in user from the server; throws when the session cannot be checked.
  final Future<AuthUser?> Function() session;
  final TravelMode Function() preferredTravelMode;

  /// One-shot «где я»; null when the device cannot locate.
  final Locator? locator;
  final Clock clock;
  final String Function() uuid;
}

const _pollInterval = Duration(seconds: 3);
const _saveFailed = 'Не удалось сохранить. Не закрывайте страницу; скачайте копию.';

class BuilderController extends ChangeNotifier {
  BuilderController(this._services, this.args) : drafts = DraftStore(_services.storage) {
    research = ResearchState._(this);
  }

  final BuilderServices _services;
  final BuilderArgs args;
  final DraftStore drafts;
  late final ResearchState research;

  Draft _draft = Draft.empty();
  Draft get draft => _draft;

  bool loaded = false;
  UiText? storageError;
  UiText? message;
  UiText? error;
  UiText? busy;
  bool locating = false;

  /// A started request owns the builder until it ends (site `action.current`).
  bool _action = false;
  bool get acting => _action;

  Place? candidate;
  BuilderTarget target = BuilderTarget.start;
  GeoPoint? focus;

  /// Stops picked by the planner (`auto`) or by hand.
  bool automatic = true;
  bool reviewed = false;
  bool researchOffered = false;
  String? pollId;
  String recoveryId = '';
  EndpointMode initialMode = EndpointMode.destination;

  /// The account walk needs a signed-in user; the screen sends the user to the login page.
  bool loginRequired = false;

  AuthUser? _user;
  WalkCard? _serverWalk;
  WalkCard? get serverWalk => _serverWalk;
  String? _localId;
  String? _localIdForView;
  String? _stored;

  /// The stored draft text that could not be read; offered for download instead of the empty draft.
  String? _unreadable;
  bool _writable = false;
  bool _accountDirty = false;
  int? _localRevision;
  Map<String, Object?>? _document;
  String? _operationKey;
  Future<void>? _statusRequest;
  int _pollToken = 0;
  final _persistQueue = SerialQueue();
  bool _disposed = false;
  void Function()? _cancelLocate;

  // Parking near a car stop being added (site walk-creation-panel.tsx).
  bool parkingBusy = false;
  UiText? parkingError;
  List<ParkingPlace> parkingOptions = const [];
  String parkingId = '';
  Object? _parkingKey;
  int _parkingToken = 0;

  bool get busyNow => busy != null || locating;

  void _changed() {
    if (_disposed) return;
    _syncParking();
    research._sync();
    notifyListeners();
  }

  @override
  void dispose() {
    _disposed = true;
    _pollToken++;
    _parkingToken++;
    research._token++;
    _cancelLocate?.call();
    super.dispose();
  }

  /// Opens the draft, the local walk or the account walk of [args] (site `restore`).
  Future<void> restore() async {
    final storage = _services.storage;
    try {
      _stored = await drafts.read();
      Draft restored;
      try {
        restored = parseDraft(_stored);
      } catch (_) {
        _unreadable = _stored;
        rethrow;
      }
      _draft = restored;
      final fresh = args.fresh;
      final hasSaved = restored.start != null && !fresh;
      final activeAccount = await storage.read(BuilderKeys.activeAccount);
      final activeLocal = await storage.read(BuilderKeys.activeLocal);
      final walkId = args.accountId ?? (args.localId == null && hasSaved ? activeAccount : null);
      final selectedLocalId = args.localId ?? (walkId == null && hasSaved ? activeLocal : null);
      if (fresh) {
        var previousId = activeLocal;
        if (activeAccount != null && restored.start != null) {
          // An account walk edited here is kept as a local walk, so starting anew never loses it.
          previousId = _services.uuid();
          await _services.walks.saveJson(draftToWalkDocument(restored, previousId));
        }
        if (previousId != null && _stored != null) await storage.write(BuilderKeys.pending(previousId), _stored!);
        restored = Draft.empty(_services.preferredTravelMode());
      }
      if (selectedLocalId != null) {
        final pending = await storage.read(BuilderKeys.pending(selectedLocalId));
        if (pending != null) restored = parseDraft(pending);
        final item = await _services.walks.getJson(selectedLocalId);
        if (item == null) throw StateError('Локальная прогулка не найдена. Исходные данные сохранены.');
        final sameDraft = selectedLocalId == activeLocal;
        final opened = walkDocumentToDraft(item.document, restored.jobs);
        restored = sameDraft || pending != null
            ? opened.copyWith(research: Value(restored.research), researchApplied: Value(restored.researchApplied), submitting: Value(restored.submitting))
            : opened;
        _localId = selectedLocalId;
        _localRevision = item.revision;
        _document = item.document;
      } else if (walkId == null) {
        _localId = _services.uuid();
      }
      AuthUser? user;
      try {
        user = await _services.session();
      } catch (caught) {
        if (walkId != null) rethrow;
        if (_disposed) return;
        error = const Phrase('Не удалось проверить вход. Локальный черновик доступен.');
      }
      if (_disposed) return;
      _user = user;
      if (walkId != null) {
        if (user == null) {
          loginRequired = true;
          return;
        }
        final data = await _services.api.accountWalk(walkId);
        if (_disposed) return;
        if (data.snapshotError != null) throw ModelError(data.snapshotError!);
        final pendingAccount = activeAccount == walkId;
        final pendingRevision = int.tryParse(await storage.read(BuilderKeys.activeRevision) ?? '');
        if (pendingAccount && hasSaved && pendingRevision != data.walk.revision) {
          throw const ModelError('Прогулка в аккаунте изменилась. Скачайте черновик перед обновлением страницы.');
        }
        _accountDirty = pendingAccount && hasSaved;
        final snapshot = data.snapshot;
        final document = snapshot is Map<String, Object?> && snapshot['version'] == 2 ? validateWalkDocument(snapshot) : null;
        if (!_accountDirty) restored = document != null ? walkDocumentToDraft(document) : draftFromJson(snapshot);
        // A legacy snapshot is not a walk document; saving builds a fresh one.
        _document = document;
        _serverWalk = data.walk;
        await storage.write(BuilderKeys.activeAccount, data.walk.id);
        await storage.write(BuilderKeys.activeRevision, '${data.walk.revision}');
      }
      final incoming = args.incoming;
      final startHere = !hasSaved && walkId == null && args.localId == null && incoming != null;
      if (startHere) {
        final title = 'Прогулка от ${incoming.address}';
        restored = Draft.empty(_services.preferredTravelMode()).copyWith(start: Value(incoming), title: title.length > 120 ? title.substring(0, 120) : title);
      }
      initialMode = restored.destination != null
          ? EndpointMode.destination
          : hasSaved || selectedLocalId != null || walkId != null
              ? EndpointMode.time
              : EndpointMode.destination;
      _draft = restored;
      _writable = true;
      automatic = restored.stops.isEmpty;
      focus = restored.start?.location;
      _localIdForView = _localId;
      research._initial = _draft.research;
      if (startHere) await persist(restored);
    } catch (caught) {
      if (_disposed) return;
      storageError = ErrorText(caught, 'Не удалось открыть черновик.');
    } finally {
      if (!_disposed) {
        loaded = true;
        _changed();
        if (_writable) unawaited(refreshOnFocus());
      }
    }
  }

  /// Saves [next] as the draft and, for a local walk, as its walk document (site `persist`).
  Future<bool> persist(Draft next) async {
    final limit = manualStopLimit(next.start, next.jobs);
    if (next.stops.length > limit) {
      error = Phrase('В прогулке может быть не больше {count} остановок с учётом истории начальной точки.', {'count': limit});
      _changed();
      return false;
    }
    _draft = next;
    _changed();
    if (!_writable) return false;
    return _persistQueue.run(() async {
      if (!_writable) return false;
      try {
        _stored = await drafts.save(next, _stored);
        final localId = _localId;
        if (localId == null) {
          _accountDirty = true;
        } else {
          final document = draftToWalkDocument(next, localId, _document);
          final revision = await _services.walks.saveJson(document, expectedRevision: _localRevision);
          _document = document;
          _localRevision = revision;
          final storage = _services.storage;
          await storage.write(BuilderKeys.activeLocal, localId);
          await storage.write(BuilderKeys.pending(localId), next.encode());
          await storage.remove(BuilderKeys.activeAccount);
        }
        if (storageError != null) {
          storageError = null;
          _changed();
        }
        return true;
      } catch (caught) {
        _writable = false;
        storageError = ErrorText(caught, _saveFailed);
        _changed();
        return false;
      }
    });
  }

  /// A form change (site `edit`): drops the route and checks of the previous version.
  Future<bool> edit(DraftChange change) {
    reviewed = false;
    error = null;
    message = null;
    researchOffered = false;
    if (change.stops != null) {
      automatic = false;
    } else if (change.parameters) {
      automatic = true;
    }
    return persist(editDraft(_draft, change));
  }

  void setTarget(BuilderTarget value) {
    target = value;
    _changed();
  }

  void setCandidate(Place? value) {
    candidate = value;
    _changed();
  }

  void setReviewed(bool value) {
    reviewed = value;
    _changed();
  }

  void setRecoveryId(String value) {
    recoveryId = value.trim();
    _changed();
  }

  void setParkingId(String value) {
    parkingId = value;
    _changed();
  }

  void setError(UiText? value) {
    error = value;
    _changed();
  }

  /// Refreshes the stages of the walk's stories; one request at a time.
  Future<void> refreshJobs() => _statusRequest ??= _refreshJobs().whenComplete(() => _statusRequest = null);

  Future<void> _refreshJobs() async {
    final updates = <String, GenerationStage>{};
    for (final id in {for (final job in _draft.jobs) job.id}) {
      final job = await _services.api.storyJob(id);
      if (_disposed) return;
      if (job.id != id) throw const ModelError('Сервис вернул другую историю.');
      updates[id] = job.stage;
    }
    if (updates.isEmpty) return;
    final next = _draft.copyWith(jobs: [for (final job in _draft.jobs) job.withStage(updates[job.id] ?? job.stage)]);
    if (!await persist(next)) throw const ModelError('Не удалось сохранить обновлённые статусы.');
  }

  /// Called when the builder opens and when the app returns to the foreground.
  Future<void> refreshOnFocus() async {
    if (_action || !_writable || _draft.jobs.isEmpty) return;
    try {
      await refreshJobs();
    } catch (caught) {
      if (caught is ApiError && caught.isCancelled) return;
      error = ErrorText(caught, 'Не удалось обновить статусы.');
      _changed();
    }
  }

  void _startPoll(String id) {
    final token = ++_pollToken;
    pollId = id;
    unawaited(_poll(id, token));
  }

  Future<void> _poll(String id, int token) async {
    bool stale() => token != _pollToken || _disposed;
    while (!stale()) {
      if (_action) {
        await _services.clock.sleep(_pollInterval);
        continue;
      }
      try {
        await refreshJobs();
      } catch (caught) {
        if (stale()) return;
        error = ErrorText(caught, 'Связь прервалась. Обновите статус кнопкой.');
        pollId = null;
        _changed();
        return;
      }
      if (stale()) return;
      final job = _draft.jobs.where((job) => job.id == id).firstOrNull;
      if (job == null || job.stage.terminal) {
        pollId = null;
        _changed();
        return;
      }
      await _services.clock.sleep(_pollInterval);
    }
  }

  /// Finds the house for [query] or at [point] and makes it the candidate (site `resolve`).
  Future<Place?> resolve({String? query, GeoPoint? point}) async {
    if (_action) return null;
    reviewed = false;
    candidate = null;
    error = null;
    _action = true;
    busy = const Phrase('Ищем адрес…');
    _changed();
    try {
      final place = await _services.api.resolvePlace(query: query, point: point);
      if (place == null) throw const ModelError('Не найден точный адрес дома в Москве. Уточните улицу и номер.');
      candidate = place;
      focus = place.location;
      return place;
    } catch (caught) {
      error = ErrorText(caught, 'Не удалось найти адрес.');
      return null;
    } finally {
      _action = false;
      busy = null;
      _changed();
    }
  }

  /// «Моё местоположение»: one fix, then the house at it.
  void locate() {
    _cancelLocate?.call();
    final locator = _services.locator;
    if (locator == null) {
      error = const LocateFailureText(LocateError.unsupported);
      _changed();
      return;
    }
    locating = true;
    _changed();
    _cancelLocate = locator.locate((update) {
      if (update is LocateFixUpdate && !update.isFinal) return;
      _cancelLocate = null;
      locating = false;
      if (_disposed) return;
      switch (update) {
        case LocateErrorUpdate(:final error):
          this.error = LocateFailureText(error);
          _changed();
        case LocateFixUpdate(:final fix):
          _changed();
          unawaited(resolve(point: GeoPoint(fix.lat, fix.lon)));
      }
    });
  }

  /// Applies [place] to [to] (site `selectAddress`); false when it cannot be added as a stop.
  Future<bool> selectAddress(Place place, [BuilderTarget? to]) async {
    switch (to ?? target) {
      case BuilderTarget.start:
        await edit(DraftChange(start: Value(place)));
      case BuilderTarget.destination:
        await edit(DraftChange(destination: Value(place), mode: WalkMode.open));
      case BuilderTarget.stop:
        final stops = [..._draft.stops, place];
        if (!validStops(_draft.start, stops, _draft.destination)) {
          error = const Phrase('Эту остановку нельзя добавить: проверьте расстояние и число остановок.');
          _changed();
          return false;
        }
        await edit(DraftChange(stops: stops));
    }
    candidate = null;
    _changed();
    return true;
  }

  /// The candidate with the chosen parking (site `confirmCandidate`).
  Future<bool> confirmCandidate() async {
    final place = candidate;
    if (place == null) return false;
    return selectAddress(parkingId.isEmpty ? place : place.copyWith(parkingId: parkingId));
  }

  /// Leaves the address input of [target], clearing its endpoint (site `cancelAddress`).
  Future<void> cancelAddress() async {
    if (target == BuilderTarget.start) {
      await edit(const DraftChange(start: Value(null)));
    } else if (target == BuilderTarget.destination) {
      await edit(const DraftChange(destination: Value(null), mode: WalkMode.open));
    }
    candidate = null;
    error = null;
    _changed();
  }

  Future<void> changeTravelMode(TravelMode next) async {
    if (next == _draft.travelMode) return;
    await edit(DraftChange(travelMode: next, minutes: next == TravelMode.driving ? 60 : 30));
  }

  bool _sameStops(List<Place> result, List<Place> wanted) {
    for (var index = 0; index < result.length; index++) {
      final want = index < wanted.length ? wanted[index] : null;
      if (want == null || result[index].address != want.address || result[index].location != want.location) return false;
    }
    return true;
  }

  /// Builds the route; true when the draft now has it (site `plan`).
  Future<bool> plan() async {
    final snapshot = _draft;
    final start = snapshot.start;
    if (start == null || _action || candidate != null) return false;
    _action = true;
    busy = Phrase(snapshot.driving ? 'Строим автомобильный маршрут…' : 'Строим пешеходный маршрут…');
    reviewed = false;
    error = null;
    researchOffered = false;
    final manual = !automatic;
    await persist(snapshot.copyWith(route: const Value(null), researchApplied: const Value(false)));
    try {
      final result = await _services.api.plan({
        'start': start.toJson(),
        'mode': snapshot.mode.name,
        'minutes': snapshot.minutes,
        'travelMode': snapshot.travelMode.name,
        if (snapshot.destination != null) 'destination': snapshot.destination!.toJson(),
        if (manual) 'stops': [for (final stop in snapshot.stops) stop.toJson()],
      });
      if (_disposed) return false;
      const invalid = ModelError('Сервис вернул некорректный маршрут. Попробуйте построить заново.');
      if (!isPlan(result)) throw invalid;
      final route = Plan.fromJson(result);
      if ((route.car != null) != snapshot.driving ||
          !validStops(start, route.stops, snapshot.destination, snapshot.jobs) ||
          route.totalMinutes > snapshot.minutes ||
          (manual && !_sameStops(route.stops, snapshot.stops))) {
        throw invalid;
      }
      await persist(_draft.copyWith(stops: route.stops, route: Value(route)));
      automatic = false;
      message = null;
      return true;
    } catch (caught) {
      if (_disposed) return false;
      final insufficient = shouldOfferResearch(!manual, caught is ApiError ? caught.code : null);
      researchOffered = insufficient;
      error = insufficient ? const Phrase('Рядом пока мало готовых историй.') : ErrorText(caught, 'Маршрут недоступен.');
      return false;
    } finally {
      _action = false;
      busy = null;
      _changed();
    }
  }

  /// The first stop without a published or ordered story.
  Place? get nextPlace => _draft.stops
      .where((place) => place.contentId == null && !_draft.jobs.any((job) => storyAddressKey(job.place.address) == storyAddressKey(place.address)))
      .firstOrNull;

  StoryRef? get activeJob => _draft.jobs.where((job) => !job.stage.terminal).firstOrNull;

  bool get writable => _writable;

  /// Orders the story of [nextPlace] (site `prepareNext`).
  Future<void> prepareNext() async {
    final next = nextPlace;
    if (_action ||
        !reviewed ||
        _draft.route == null ||
        _draft.researchApplied == true ||
        candidate != null ||
        next == null ||
        activeJob != null ||
        _draft.submitting != null ||
        !_writable) {
      return;
    }
    _action = true;
    busy = const Phrase('Создаём одну историю…');
    error = null;
    _changed();
    try {
      await refreshJobs();
      if (_draft.jobs.any((job) => !job.stage.terminal)) {
        message = const Phrase('Другая история ещё готовится, возможно после повтора. Дождитесь завершения.');
        return;
      }
      // The intent is recorded before the POST: an unknown result is then recovered, never repeated.
      if (!await persist(_draft.copyWith(submitting: Value(next)))) return;
      final job = await _services.api.createStoryJob(next.address, _services.uuid());
      if (_disposed) return;
      final saved = await persist(_draft.copyWith(
        submitting: const Value(null),
        jobs: rememberStory(_draft.jobs, StoryRef(place: next, id: job.id, stage: job.stage)),
      ));
      if (saved && !job.stage.terminal) _startPoll(job.id);
      message = const Phrase('Ссылка на историю сохранена. Следующую можно подготовить после завершения этой.');
    } catch (caught) {
      if (_disposed) return;
      final status = caught is ApiError ? caught.status : null;
      if (status != null && status >= 400 && status < 500) {
        await persist(_draft.copyWith(submitting: const Value(null)));
        error = ErrorText(caught, 'Не удалось подготовить историю.');
      } else {
        error = ErrorText(
          caught,
          'Запрос прервался.',
          template: _draft.submitting != null
              ? '{error} Результат отправки неизвестен. Не повторяем её автоматически.'
              : '{error} Новая история не отправлена. Обновите статусы и повторите действие.',
        );
      }
    } finally {
      _action = false;
      busy = null;
      _changed();
    }
  }

  /// Attaches a story sent with an unknown result by its ID (site `recoverJob`).
  Future<void> recoverJob() async {
    final submitting = _draft.submitting;
    final id = recoveryId;
    if (submitting == null || !isJobId(id) || _action) return;
    _action = true;
    busy = const Phrase('Проверяем историю…');
    error = null;
    _changed();
    try {
      await refreshJobs();
      final job = await _services.api.storyJob(id);
      if (_disposed) return;
      final address = job.address;
      if (job.id != id || address == null || storyAddressKey(address) != storyAddressKey(submitting.address)) {
        throw const ModelError('История относится к другому адресу.');
      }
      await persist(_draft.copyWith(
        submitting: const Value(null),
        jobs: rememberStory(_draft.jobs, StoryRef(place: submitting, id: job.id, stage: job.stage)),
      ));
    } catch (caught) {
      if (_disposed) return;
      error = ErrorText(caught, 'Не удалось проверить историю.');
    } finally {
      _action = false;
      busy = null;
      _changed();
    }
  }

  /// The text of «Скачать черновик»: the stored copy that could not be read, else the current draft.
  String downloadText() => _unreadable ?? const JsonEncoder.withIndent('  ').convert(_draft.toJson());

  bool _saving = false;

  /// Saves the walk to the account (site `saveToAccount`).
  Future<SaveOutcome> saveToAccount() async {
    if (_user == null) return SaveOutcome.login;
    if (_saving) return SaveOutcome.failed;
    _saving = true;
    busy = const Phrase('Сохраняем прогулку…');
    error = null;
    _changed();
    final storage = _services.storage;
    try {
      var awaitsReview = false;
      final server = _serverWalk;
      final id = server?.id ?? _document?['id'] as String? ?? _localId ?? _services.uuid();
      final snapshot = draftToWalkDocument(_draft, id, _document);
      _document = snapshot;
      final title = snapshot['title']! as String;
      if (server != null) {
        final data = await _services.api.updateAccountWalk(server.id, title, snapshot, server.revision);
        _serverWalk = data.walk;
        await storage.write(BuilderKeys.activeAccount, data.walk.id);
        await storage.write(BuilderKeys.activeRevision, '${data.walk.revision}');
        // Changed texts of a public walk send it back to the editors before it returns to the top.
        awaitsReview = data.walk.awaitsReview;
      } else {
        final keyName = BuilderKeys.accountOperation(id);
        final key = _operationKey ?? await storage.read(keyName) ?? 'walk-${_services.uuid()}';
        _operationKey = key;
        await storage.write(keyName, key);
        final data = await _services.api.createAccountWalk(title, snapshot, key);
        // The server assigns a fresh ID when the document's ID belongs to another account.
        final saved = data.snapshot;
        if (saved is Map<String, Object?>) _document = saved;
        _serverWalk = data.walk;
        await storage.write(BuilderKeys.activeAccount, data.walk.id);
        await storage.write(BuilderKeys.activeRevision, '${data.walk.revision}');
      }
      _localId = null;
      _accountDirty = false;
      message = Phrase(awaitsReview ? 'Прогулка сохранена. В топе она появится после проверки редакцией.' : 'Прогулка сохранена в личном кабинете.');
      return awaitsReview ? SaveOutcome.review : SaveOutcome.saved;
    } catch (caught) {
      error = ErrorText(caught, 'Не удалось сохранить прогулку.');
      return SaveOutcome.failed;
    } finally {
      _saving = false;
      busy = null;
      _changed();
    }
  }

  /// The account walk [id] after a change of its access in the sharing sheet.
  void sharingChanged(String id, WalkAccess access) {
    final server = _serverWalk;
    if (server == null || server.id != id) return;
    final walk = server.withAccess(access);
    _serverWalk = walk;
    unawaited(_services.storage.write(BuilderKeys.activeRevision, '${walk.revision}').catchError((Object caught) {
      debugPrint('walk builder: revision not stored: $caught');
    }));
    _changed();
  }

  bool get signedIn => _user != null;

  /// The walk open in the builder.
  String? get openLocation {
    final server = _serverWalk;
    if (server != null) return '/walk?id=${server.id}';
    final local = _localIdForView;
    return local == null ? null : '/walk?local=$local';
  }

  /// The walk page of the built route; an edited account walk is saved first (site `openWalk`).
  Future<String?> openWalk() async {
    final location = openLocation;
    if (_draft.route == null || location == null || _action) return null;
    if (_serverWalk != null && _accountDirty && await saveToAccount() != SaveOutcome.saved) return null;
    // A draft opened without a stored local walk (no edit since) is saved first, so the walk page finds it.
    if (_serverWalk == null && _localRevision == null && !await persist(_draft)) return null;
    return openLocation;
  }

  /// Builds the route and returns the walk page to open (site `build`).
  Future<String?> build() async => await plan() ? openWalk() : null;

  // Parking options follow the candidate of a car stop; a new candidate cancels the old lookup.
  void _syncParking() {
    final place = candidate;
    final wanted = _draft.driving && target == BuilderTarget.stop && place != null;
    final key = wanted ? place.location : null;
    if (key == _parkingKey) return;
    _parkingKey = key;
    final token = ++_parkingToken;
    parkingOptions = const [];
    parkingId = '';
    parkingError = null;
    parkingBusy = wanted;
    if (!wanted) return;
    unawaited(_loadParking(place.location, token));
  }

  Future<void> _loadParking(GeoPoint location, int token) async {
    try {
      final places = await _services.api.nearbyParking(location);
      if (token != _parkingToken || _disposed) return;
      parkingOptions = places;
      parkingId = places.where((place) => place.access == ParkingAccess.public).firstOrNull?.id ?? '';
    } catch (caught) {
      if (token != _parkingToken || _disposed) return;
      parkingOptions = const [];
      parkingError = const Phrase('Не удалось загрузить парковки рядом.');
    }
    parkingBusy = false;
    _changed();
  }
}

/// The «Исследование района» panel (site research-panel.tsx).
class ResearchState {
  ResearchState._(this._owner);

  final BuilderController _owner;
  ResearchJob? job;
  UiText? error;
  bool missing = false;
  bool _posting = false;
  int _token = 0;
  String _identity = '';

  /// The research restored with the draft: only it, or an explicit status check, may look up an
  /// uncertain send.
  ResearchRef? _initial;

  Draft get _draft => _owner._draft;

  void _sync() {
    final ref = _draft.research;
    final identity = ref == null ? '' : '${researchKey(ref.request)}:${ref.recoveryToken}:${ref.id ?? 'intent'}';
    if (identity == _identity) return;
    _identity = identity;
    _restart();
  }

  void _restart() {
    final token = ++_token;
    final ref = _draft.research;
    if (ref == null || (ref.id == null && !identical(_initial, ref))) return;
    unawaited(_poll(ref, token));
  }

  bool _stale(int token) => token != _token || _owner._disposed;

  void _accept(ResearchJob result, ResearchRef expected) {
    final latest = _draft.research;
    if (latest == null ||
        latest.recoveryToken != expected.recoveryToken ||
        researchKey(latest.request) != researchKey(expected.request) ||
        (latest.id != null && latest.id != result.id)) {
      return;
    }
    final previous = job;
    job = previous != null && previous.id == result.id && previous.revision > result.revision ? previous : result;
    missing = false;
    error = null;
    // The known ID stays in memory even if storage fails; persist never rolls back state.
    if (latest.id != result.id) {
      unawaited(_owner.persist(_draft.copyWith(research: Value(latest.withId(result.id)))));
    } else {
      _owner._changed();
    }
  }

  Future<void> _poll(ResearchRef expected, int token) async {
    var failures = 0;
    final clock = _owner._services.clock;
    while (!_stale(token)) {
      if (_posting) {
        await clock.sleep(_pollInterval);
        continue;
      }
      try {
        final value = await _owner._services.api.researchJob(expected);
        if (_stale(token)) return;
        final result = readResearchJob(value, expected);
        _accept(result, expected);
        failures = 0;
        if (result.stage.terminal) return;
        await clock.sleep(_pollInterval);
      } catch (caught) {
        if (_stale(token)) return;
        if (caught is ApiError && caught.code == 'NOT_FOUND') {
          job = null;
          missing = true;
          error = Phrase(expected.id != null
              ? 'Сохранённая задача не найдена. Её ID остаётся в черновике.'
              : 'Сервер не нашёл задачу для сохранённой отправки. Можно явно попробовать снова.');
          _owner._changed();
          return;
        }
        error = ErrorText(caught, 'Связь прервалась.', template: '{error} Продолжим проверять статус; работа на сервере не отменена.');
        _owner._changed();
        failures = math.min(failures + 1, 5);
        final backoff = _pollInterval * math.pow(2, failures).toInt();
        await clock.sleep(backoff > const Duration(minutes: 1) ? const Duration(minutes: 1) : backoff);
      }
    }
  }

  bool get visible => !_draft.driving && (_owner.researchOffered || _draft.research != null);

  /// The job of the draft's research, once known.
  ResearchJob? get visibleJob {
    final current = job;
    return current != null && current.id == _draft.research?.id ? current : null;
  }

  bool get matches {
    final ref = _draft.research;
    return ref != null && researchMatches(_draft, ref);
  }

  bool get canStart {
    final ref = _draft.research;
    final offered = _owner.researchOffered;
    return (offered && (ref == null || !matches || missing)) || (missing && matches);
  }

  /// «Найти истории рядом» or, with [retry], «Продолжить поиск».
  Future<void> submit({bool retry = false, required bool disabled}) async {
    if (_owner._action || _posting || disabled) return;
    final latest = _draft;
    final current = job;
    final ref = latest.research;
    if (retry) {
      if (current == null || !current.canRetry || ref?.id != current.id) return;
    } else {
      final allowed = _owner.researchOffered || (missing && ref != null && researchMatches(latest, ref));
      if (!allowed || latest.start == null || (ref != null && !missing && researchMatches(latest, ref))) return;
    }
    _posting = true;
    _owner._action = true;
    _owner.busy = Phrase(retry ? 'Продолжаем исследование…' : 'Отправляем исследование…');
    error = null;
    _owner._changed();
    try {
      if (!const [30, 60, 90].contains(latest.minutes)) return;
      final request = ResearchRequest(start: latest.start!, destination: latest.destination, mode: latest.mode, minutes: latest.minutes);
      final expected = retry
          ? ref!
          : ResearchRef(
              request: request,
              stops: latest.stops,
              id: null,
              recoveryToken: ref != null && researchKey(ref.request) == researchKey(request) ? ref.recoveryToken : _owner._services.uuid(),
            );
      if (!await _owner.persist(latest.copyWith(research: Value(expected)))) return;
      if (!retry) _initial = null;
      missing = false;
      final api = _owner._services.api;
      final result = retry ? await api.retryResearch(expected.id!, current!.revision) : await api.createResearch(expected);
      if (_owner._disposed) return;
      _accept(readResearchJob(result, expected), expected);
      if (retry) _restart();
    } catch (caught) {
      if (_owner._disposed) return;
      final status = caught is ApiError ? caught.status : null;
      final rejected = status != null && (status < 500 || status == 503);
      // An explicit HTTP rejection created no job; an unknown transport outcome keeps the intent.
      if (!retry && rejected) missing = true;
      error = rejected
          ? ErrorText(caught, 'Ответ не получен.')
          : ErrorText(caught, 'Ответ не получен.',
              template: '{error} Результат отправки неизвестен. Нажмите «Проверить статус» или вернитесь позже: новой отправки не будет.');
      if (retry) _restart();
    } finally {
      _posting = false;
      _owner._action = false;
      _owner.busy = null;
      _owner._changed();
    }
  }

  /// «Проверить статус» of a send whose result is unknown.
  void checkStatus() {
    if (_owner._action || _posting) return;
    _initial = _draft.research;
    _restart();
  }

  /// «Использовать прогулку»: the researched route becomes the draft's route; returns the walk page.
  Future<String?> apply() async {
    final current = visibleJob;
    if (current == null) return null;
    try {
      if (await _owner.persist(applyResearch(_draft, current))) return await _owner.openWalk();
    } catch (caught) {
      error = ErrorText(caught, 'Не удалось применить прогулку.');
      _owner._changed();
    }
    return null;
  }
}
