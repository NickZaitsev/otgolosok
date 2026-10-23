import 'package:dio/dio.dart' show CancelToken;
import 'package:flutter/foundation.dart';

import '../../core/api/api_client.dart';
import '../../core/api/api_error.dart';
import '../../walk_engine/js_json.dart';
import '../../walk_engine/json_read.dart';
import '../../walk_engine/walk_view.dart';
import '../offline/offline_packs.dart';
import 'local_walks.dart';
import 'walk_link.dart';

/// A walk view together with the JSON it was read from (kept for the offline copy).
@immutable
class WalkViewData {
  const WalkViewData(this.view, this.json);
  final WalkView view;
  final Map<String, Object?> json;
}

/// An opened walk; [savedAt] is set when it came from the offline copy.
@immutable
class LoadedWalk {
  const LoadedWalk({required this.data, required this.offlineRef, this.savedAt});
  final WalkViewData data;

  /// Where this walk's offline copy lives; null when none can be kept (a guest's account walk).
  final OfflineWalkRef? offlineRef;

  /// ISO time of the offline copy the walk was opened from; null for a fresh answer.
  final String? savedAt;

  WalkView get view => data.view;
  bool get offline => savedAt != null;
}

/// Validates a view and checks it is in the requested language (site `requestedView`).
WalkViewData requestedView(Object? json, ContentLocale locale) {
  final map = readMap(json);
  final view = WalkView.fromJson(map);
  if (view.locale != locale) failFormat('Сервис вернул прогулку на другом языке.');
  return WalkViewData(view, map);
}

/// The view of a walk kept only on this device: no stories yet (site `localWalkView`).
WalkViewData localWalkView(Map<String, Object?> document, int revision, [ContentLocale locale = ContentLocale.ru]) {
  final ru = locale == ContentLocale.ru;
  final stops = readList(document['stops']);
  final json = <String, Object?>{
    'document': document,
    'revision': revision,
    'contentVersion': ru ? 'local:$revision' : 'local:${locale.wire}:$revision',
    if (!ru) 'requestedLocale': locale.wire,
    if (!ru) 'documentLocalization': {'requestedLocale': locale.wire, 'contentLocale': 'ru', 'fallbackReason': 'missing'},
    'chapters': [
      for (final stop in stops)
        {
          'id': readMap(stop)['id'],
          'status': readMap(stop)['storyRef'] != null ? 'preparing' : 'not_requested',
          'story': null,
          'audio': null,
          if (!ru) 'localization': {'requestedLocale': locale.wire, 'contentLocale': locale.wire, 'fallbackReason': null},
        },
    ],
  };
  return WalkViewData(WalkView.fromJson(json), json);
}

/// Opens walks by link (site `walk-loader.ts`): from the server, and from the offline copy when
/// the network or the server fails. «Not found» and «no access» answers are never replaced by a copy.
class WalkLoader {
  WalkLoader({required this._api, required this._packs, required this._localStore});

  final ApiClient _api;
  final OfflinePackManager _packs;
  final LocalWalkStore Function() _localStore;

  /// Where the offline copy of the walk of [link] lives; null when none can be kept.
  static OfflineWalkRef? offlineRefOf(WalkLink link, ContentLocale locale, String? userId) => switch (link) {
        CatalogWalkLink(:final slug) => offlineWalkRef(OfflineWalkKind.catalog, slug, null, locale),
        SharedWalkLink(:final token) => offlineWalkRef(OfflineWalkKind.share, token, null, locale),
        AccountWalkLink(:final id) => offlineWalkRef(OfflineWalkKind.id, id, userId, locale),
        LocalWalkLink(:final id) => offlineWalkRef(OfflineWalkKind.local, id, null, locale),
      };

  /// [locale] must be the language the API client sends as `?lang=`; [userId] owns account copies.
  Future<LoadedWalk> load(WalkLink link, {required ContentLocale locale, required String? userId, CancelToken? cancel}) {
    Future<WalkViewData> fetch(String path) =>
        _api.get(path, (json) => requestedView(json, locale), localized: true, cancel: cancel);
    return switch (link) {
      CatalogWalkLink(:final slug) =>
        _withOffline(() => fetch('/api/story-walks/${Uri.encodeComponent(slug)}/view'), offlineRefOf(link, locale, userId)),
      SharedWalkLink(:final token) =>
        _withOffline(() => fetch('/api/story-walks/shared/${Uri.encodeComponent(token)}'), offlineRefOf(link, locale, userId)),
      AccountWalkLink(:final id) =>
        _withOffline(() => fetch('/api/me/walks/${Uri.encodeComponent(id)}/view'), offlineRefOf(link, locale, userId)),
      LocalWalkLink(:final id) => _local(id, locale, cancel),
    };
  }

  Future<LoadedWalk> _withOffline(Future<WalkViewData> Function() online, OfflineWalkRef? ref,
      {bool Function(WalkView saved)? usable}) async {
    try {
      return LoadedWalk(data: await online(), offlineRef: ref);
    } on ApiError catch (error) {
      if (ref == null || error.isCancelled || !error.allowsOfflineFallback) rethrow;
      final saved = await _packs.load(ref, seedFood: true);
      if (saved == null || !(usable?.call(saved.view) ?? true)) rethrow;
      final json = saved.json;
      if (json is! Map<String, Object?>) rethrow;
      return LoadedWalk(data: WalkViewData(saved.view, json), offlineRef: ref, savedAt: saved.manifest.savedAt);
    }
  }

  Future<LoadedWalk> _local(String id, ContentLocale locale, CancelToken? cancel) async {
    final item = await _localStore().get(id);
    if (item == null) throw const ApiError(message: 'Локальная прогулка не найдена.', status: 404, code: 'NOT_FOUND');
    final ref = offlineRefOf(LocalWalkLink(id), locale, null);
    final document = item.document.toJson();
    try {
      // A copy of an older revision would hide the local edits; the walk then opens without stories.
      return await _withOffline(() => resolveLocalWalkView(document, item.revision, locale, cancel), ref,
          usable: (saved) => saved.revision == item.revision);
    } on ApiError catch (error) {
      if (error.isCancelled) rethrow;
      return LoadedWalk(data: localWalkView(document, item.revision, locale), offlineRef: ref);
    }
  }

  /// A guest walk lives only on the device, so the server fills in the published stories of its
  /// stops from the sent document (site `resolveLocalWalkView`).
  Future<WalkViewData> resolveLocalWalkView(Map<String, Object?> document, int revision, ContentLocale locale, CancelToken? cancel) async {
    final base = localWalkView(document, revision, locale);
    if (!base.view.document.stops.any((stop) => stop.storyRef != null)) return base;
    final resolved = await _api.send(
      'POST',
      '/api/story-walks/resolve',
      (json) {
        final data = requestedView(json, locale);
        final chapters = data.view.chapters;
        final source = data.json['sourceDocument'];
        if (data.view.revision != revision ||
            chapters.length != base.view.chapters.length ||
            [for (var i = 0; i < chapters.length; i++) chapters[i].id != base.view.chapters[i].id].any((differs) => differs) ||
            (source != null && jsJsonStringify(source) != jsJsonStringify(document))) {
          failFormat();
        }
        return data;
      },
      body: {'document': document, 'revision': revision},
      idempotent: true,
      localized: true,
      cancel: cancel,
    );
    final ru = locale == ContentLocale.ru;
    final json = <String, Object?>{
      ...base.json,
      'document': resolved.json['document'],
      if (resolved.json['sourceDocument'] != null) 'sourceDocument': resolved.json['sourceDocument'],
      if (resolved.json.containsKey('documentLocalization')) 'documentLocalization': resolved.json['documentLocalization'],
      'contentVersion': ru ? 'local:$revision:${resolved.view.contentVersion}' : 'local:${locale.wire}:$revision:${resolved.view.contentVersion}',
      'chapters': resolved.json['chapters'],
    };
    try {
      return WalkViewData(WalkView.fromJson(json), json);
    } on FormatException {
      throw const ApiError.corrupt();
    }
  }
}
