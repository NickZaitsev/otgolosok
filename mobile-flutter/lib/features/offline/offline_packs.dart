import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math';

import 'package:crypto/crypto.dart';
import 'package:flutter/foundation.dart';

import '../../core/api/api_error.dart';
import '../../walk_engine/json_read.dart';
import '../../walk_engine/walk_view.dart';
import 'offline_food.dart';

/// The largest offline copy of one walk: recordings plus food.
const maxPackBytes = 60 * 1024 * 1024;

/// How the walk was opened, which decides who owns its offline copy.
enum OfflineWalkKind { id, catalog, share, local }

/// Where a saved copy lives: [scope] owns it, [walkId] is the key the walk is opened by.
@immutable
class OfflineWalkRef {
  const OfflineWalkRef({required this.scope, required this.walkId, this.requestedLocale = ContentLocale.ru});
  final String scope;
  final String walkId;
  final ContentLocale requestedLocale;

  @override
  bool operator ==(Object other) =>
      other is OfflineWalkRef && other.scope == scope && other.walkId == walkId && other.requestedLocale == requestedLocale;

  @override
  int get hashCode => Object.hash(scope, walkId, requestedLocale);

  @override
  String toString() => 'OfflineWalkRef($scope, $walkId, ${requestedLocale.wire})';
}

/// Account walks are private: they are saved under the user id and removed on sign-out. Catalog
/// and shared walks are readable by anyone with the link, and local walks already live on this
/// device, so their copies are kept on sign-out (site `offlineWalkRef`).
OfflineWalkRef? offlineWalkRef(OfflineWalkKind kind, String key, String? userId, [ContentLocale requestedLocale = ContentLocale.ru]) {
  if (key.isEmpty) return null;
  final scope = switch (kind) {
    OfflineWalkKind.id => userId,
    OfflineWalkKind.catalog => 'public:catalog',
    OfflineWalkKind.share => 'public:shared',
    OfflineWalkKind.local => 'device:local',
  };
  if (scope == null || scope.isEmpty) return null;
  return OfflineWalkRef(scope: scope, walkId: key, requestedLocale: requestedLocale);
}

/// A failed save with a Russian message for the walker.
class OfflinePackError implements Exception {
  const OfflinePackError(this.message);
  final String message;

  static const tooLarge = OfflinePackError('Офлайн-комплект прогулки слишком большой.');
  static const storageFull = OfflinePackError('На устройстве не хватает места. Освободите память и повторите попытку.');
  static const failed = OfflinePackError('Не удалось сохранить офлайн-копию.');

  @override
  String toString() => 'OfflinePackError: $message';
}

final _sha256 = RegExp(r'^[a-f0-9]{64}$');
final _cellKey = RegExp(r'^-?\d{1,3}(?:\.\d{1,6})?:-?\d{1,3}(?:\.\d{1,6})?$');

@immutable
class OfflineAudio {
  const OfflineAudio({required this.chapterId, required this.url, required this.sha256, required this.bytes});
  final String chapterId;

  /// Site-relative URL of the recording, the key the player looks it up by.
  final String url;
  final String sha256;
  final int bytes;

  Map<String, Object?> toJson() => {'chapterId': chapterId, 'url': url, 'sha256': sha256, 'bytes': bytes};

  static OfflineAudio _fromJson(Object? json) {
    final map = readMap(json);
    final chapterId = map['chapterId'], url = map['url'], sha = map['sha256'], bytes = map['bytes'];
    if (chapterId is! String || url is! String || sha is! String || !_sha256.hasMatch(sha) || bytes is! int || bytes < 0) failFormat();
    return OfflineAudio(chapterId: chapterId, url: url, sha256: sha, bytes: bytes);
  }
}

@immutable
class OfflineFoodCellSummary {
  const OfflineFoodCellSummary({required this.key, required this.etag, required this.bytes});
  final String key;
  final String etag;
  final int bytes;

  Map<String, Object?> toJson() => {'key': key, 'etag': etag, 'bytes': bytes};
}

/// Site `OfflineFood`: what the copy holds of the food cells.
@immutable
class OfflineFoodSummary {
  const OfflineFoodSummary({required this.sourceEditedAt, required this.attribution, required this.cells});
  final String sourceEditedAt;
  final String attribution;
  final List<OfflineFoodCellSummary> cells;

  Map<String, Object?> toJson() =>
      {'sourceEditedAt': sourceEditedAt, 'attribution': attribution, 'cells': [for (final cell in cells) cell.toJson()]};

  static OfflineFoodSummary _fromJson(Object? json) {
    final map = readMap(json);
    final edited = map['sourceEditedAt'], attribution = map['attribution'];
    if (edited is! String || attribution is! String) failFormat();
    final cells = [
      for (final item in readList(map['cells']))
        () {
          final cell = readMap(item);
          final key = cell['key'], etag = cell['etag'], bytes = cell['bytes'];
          if (key is! String || !_cellKey.hasMatch(key) || etag is! String || bytes is! int || bytes < 0) failFormat();
          return OfflineFoodCellSummary(key: key, etag: etag, bytes: bytes);
        }(),
    ];
    return OfflineFoodSummary(sourceEditedAt: edited, attribution: attribution, cells: cells);
  }
}

/// Site `OfflineWalkManifest` version 2.
@immutable
class OfflineWalkManifest {
  const OfflineWalkManifest({
    required this.walkId,
    required this.scope,
    required this.requestedLocale,
    required this.revision,
    required this.contentVersion,
    required this.savedAt,
    required this.audio,
    this.food,
  });

  final String walkId;
  final String scope;
  final ContentLocale requestedLocale;
  final int revision;
  final String contentVersion;

  /// ISO time of the save, shown as «Офлайн-копия от …».
  final String savedAt;
  final List<OfflineAudio> audio;
  final OfflineFoodSummary? food;

  Map<String, Object?> toJson() => {
        'version': 2,
        'walkId': walkId,
        'scope': scope,
        'requestedLocale': requestedLocale.wire,
        'revision': revision,
        'contentVersion': contentVersion,
        'savedAt': savedAt,
        'audio': [for (final item in audio) item.toJson()],
        if (food != null) 'food': food!.toJson(),
      };

  /// Fails closed: anything unexpected is no copy at all.
  static OfflineWalkManifest? tryParse(Object? json) {
    try {
      final map = readMap(json);
      final walkId = map['walkId'], scope = map['scope'], revision = map['revision'];
      final contentVersion = map['contentVersion'], savedAt = map['savedAt'];
      final locale = ContentLocale.values.where((value) => value.wire == map['requestedLocale']).firstOrNull;
      if (map['version'] != 2 || walkId is! String || scope is! String || locale == null || revision is! int || revision < 0) return null;
      if (contentVersion is! String || savedAt is! String) return null;
      return OfflineWalkManifest(
        walkId: walkId,
        scope: scope,
        requestedLocale: locale,
        revision: revision,
        contentVersion: contentVersion,
        savedAt: savedAt,
        audio: [for (final item in readList(map['audio'])) OfflineAudio._fromJson(item)],
        food: map['food'] == null ? null : OfflineFoodSummary._fromJson(map['food']),
      );
    } on FormatException {
      return null;
    } on TypeError {
      return null;
    }
  }
}

@immutable
class OfflineSaveResult {
  const OfflineSaveResult({required this.manifest, required this.foodWarning});
  final OfflineWalkManifest manifest;

  /// Food could not be saved, the walk itself was («Заведения не сохранены»).
  final bool foodWarning;

  int get availableAudio => manifest.audio.length;
}

/// An opened offline copy.
@immutable
class OfflineWalk {
  const OfflineWalk({required this.view, required this.json, required this.manifest, required this.localAudio});
  final WalkView view;

  /// The view exactly as the server sent it.
  final Object? json;
  final OfflineWalkManifest manifest;

  /// Saved recordings by their site-relative URL; a recording missing on disk is simply absent.
  final Map<String, Uri> localAudio;
}

/// Downloads a site-relative [url] into [target]; throws [ApiError] (code `TOO_LARGE` above [maxBytes]).
typedef OfflineDownloader = Future<int> Function(String url, File target, int maxBytes);

@immutable
class _Pointer {
  const _Pointer(this.stage, this.manifest);
  final String stage;
  final OfflineWalkManifest manifest;
}

/// Offline copies of walks in the app files directory (site `walks/offline.ts`):
///
/// `<root>/packs/<scope>/<walkId>[/<locale>]/pointer.json` names the published stage;
/// `…/staging-<id>/` holds `view.json`, `manifest.json` and food cells;
/// `<root>/audio/<sha256>.mp3` keeps recordings shared by every copy.
///
/// A copy is written into a fresh stage and published by atomically replacing the pointer, so an
/// interrupted save never damages the previous copy. Recordings are verified by SHA-256, the whole
/// copy is limited to [maxBytes], and recordings no copy references are deleted.
class OfflinePackManager {
  OfflinePackManager({
    required Future<Directory> Function() root,
    required this._download,
    this._food,
    DateTime Function()? now,
    this.maxBytes = maxPackBytes,
  })  : _rootOf = root,
        _now = now ?? DateTime.now;

  final Future<Directory> Function() _rootOf;
  final OfflineDownloader _download;
  final OfflineFoodSource? _food;
  final DateTime Function() _now;
  final int maxBytes;

  Future<Directory>? _root;
  Future<void> _tail = Future.value();
  final _active = <String>{};
  final _scopeEpoch = <String, int>{};
  final _random = Random.secure();

  Future<Directory> _rootDir() => _root ??= _rootOf();

  /// Runs pointer, deletion and prune steps one at a time; downloads run outside.
  Future<T> _locked<T>(Future<T> Function() action) {
    final result = _tail.then((_) => action());
    _tail = result.then<void>((_) {}, onError: (Object _) {});
    return result;
  }

  /// Saves [viewJson] (a walk view as the server sent it) under [ref], replacing an older copy.
  Future<OfflineSaveResult> save(Object? viewJson, OfflineWalkRef ref) async {
    final WalkView view;
    try {
      view = WalkView.fromJson(viewJson);
    } on FormatException {
      throw OfflinePackError.failed;
    }
    if (view.locale != ref.requestedLocale) throw const OfflinePackError('Язык офлайн-копии не совпадает с открытой прогулкой.');
    if (ref.scope.trim().isEmpty || ref.walkId.trim().isEmpty) throw const OfflinePackError('Не удалось определить владельца офлайн-копии.');
    final root = await _rootDir();
    final epoch = _scopeEpoch[ref.scope] ?? 0;
    final stagePath = '${_packPath(ref)}/staging-${_randomId()}';
    final stage = Directory('${root.path}/$stagePath');
    _active.add(stagePath);
    try {
      final manifest = await _fill(root, stage, view, viewJson, ref);
      return await _locked(() async {
        if ((_scopeEpoch[ref.scope] ?? 0) != epoch) throw OfflinePackError.failed;
        final pointerFile = File('${root.path}/${_packPath(ref)}/pointer.json');
        final prior = await _readPointer(pointerFile, ref);
        await _writeAtomic(pointerFile, jsonEncode({'version': 2, 'stage': stagePath, 'manifest': manifest.$1.toJson()}));
        _active.remove(stagePath);
        if (prior != null && prior.stage != stagePath) await _deleteQuietly(Directory('${root.path}/${prior.stage}'));
        await _pruneQuietly(root);
        return OfflineSaveResult(manifest: manifest.$1, foodWarning: manifest.$2);
      });
    } on Object catch (error) {
      _active.remove(stagePath);
      await _locked(() async {
        await _deleteQuietly(stage);
        await _pruneQuietly(root);
      });
      if (error is FileSystemException) throw _storageError(error);
      rethrow;
    }
  }

  Future<(OfflineWalkManifest, bool)> _fill(Directory root, Directory stage, WalkView view, Object? viewJson, OfflineWalkRef ref) async {
    await stage.create(recursive: true);
    final audioDir = Directory('${root.path}/audio');
    await audioDir.create(recursive: true);
    final recordings = [for (final chapter in view.chapters) if (chapter.audio != null) (chapter.id, chapter.audio!)];
    // Recordings put before the pointer is published must survive a concurrent prune.
    await File('${stage.path}/pending.json').writeAsString(jsonEncode({'audio': [for (final item in recordings) item.$2.sha256]}), flush: true);
    final audio = <OfflineAudio>[];
    final seen = <String>{};
    var total = 0;
    for (final (chapterId, recording) in recordings) {
      if (!seen.add(recording.url)) continue;
      final target = File('${audioDir.path}/${recording.sha256}.mp3');
      // Another saved walk may already hold this recording.
      var bytes = await _verifiedLength(target, recording.sha256);
      if (bytes == null) {
        final remaining = maxBytes - total;
        if (remaining <= 0) throw OfflinePackError.tooLarge;
        final temp = File('${stage.path}/download.tmp');
        try {
          bytes = await _download(recording.url, temp, remaining);
        } on ApiError catch (error) {
          if (error.code == 'TOO_LARGE') throw OfflinePackError.tooLarge;
          // A lost connection keeps its own message; a refused file gets the site's one.
          if (error.status != null) throw const OfflinePackError('Не удалось скачать запись для офлайн-прогулки.');
          rethrow;
        }
        if (await _digest(temp) != recording.sha256) throw const OfflinePackError('Запись загрузилась с неверной контрольной суммой.');
        bytes = await temp.length();
        await temp.rename(target.path);
      }
      total += bytes;
      if (total > maxBytes) throw OfflinePackError.tooLarge;
      audio.add(OfflineAudio(chapterId: chapterId, url: recording.url, sha256: recording.sha256, bytes: bytes));
    }
    final (food, foodWarning) = await _saveFood(stage, view, maxBytes - total);
    final manifest = OfflineWalkManifest(
      walkId: ref.walkId,
      scope: ref.scope,
      requestedLocale: ref.requestedLocale,
      revision: view.revision,
      contentVersion: view.contentVersion,
      savedAt: _now().toUtc().toIso8601String(),
      audio: audio,
      food: food,
    );
    await File('${stage.path}/view.json').writeAsString(jsonEncode(viewJson), flush: true);
    await File('${stage.path}/manifest.json').writeAsString(jsonEncode(manifest.toJson()), flush: true);
    return (manifest, foodWarning);
  }

  /// Food is optional: a failure leaves the walk saved and only warns.
  Future<(OfflineFoodSummary?, bool)> _saveFood(Directory stage, WalkView view, int left) async {
    final source = _food;
    final geometry = view.document.route?.geometry ?? const [];
    if (source == null || geometry.length < 2) return (null, false);
    final budget = min(offlineFoodMaxBytes, left);
    if (budget <= 0) return (null, true);
    final download = await source.download(geometry, budget);
    final bundle = download.bundle;
    if (bundle == null) return (null, download.warning);
    final dir = Directory('${stage.path}/food');
    try {
      var bytes = utf8.encode(bundle.manifestBody).length;
      for (final cell in bundle.cells) {
        bytes += cell.bytes;
        if (!_cellKey.hasMatch(cell.key) || utf8.encode(cell.body).length != cell.bytes || bytes > budget) {
          throw const FormatException('food cell');
        }
      }
      await dir.create(recursive: true);
      await File('${dir.path}/manifest.json').writeAsString(bundle.manifestBody, flush: true);
      for (final cell in bundle.cells) {
        await File('${dir.path}/${_cellFile(cell.key)}').writeAsString(cell.body, flush: true);
      }
      return (
        OfflineFoodSummary(
          sourceEditedAt: bundle.sourceEditedAt,
          attribution: bundle.attribution,
          cells: [for (final cell in bundle.cells) OfflineFoodCellSummary(key: cell.key, etag: cell.etag, bytes: cell.bytes)],
        ),
        download.warning,
      );
    } on Exception {
      await _deleteQuietly(dir);
      return (null, true);
    }
  }

  /// The copy saved under [ref], or null when there is none or it is damaged. [seedFood] puts the
  /// saved food cells into the live store: only for a walk opened from this copy.
  Future<OfflineWalk?> load(OfflineWalkRef ref, {bool seedFood = false}) async {
    try {
      final root = await _rootDir();
      final pointer = await _readPointer(File('${root.path}/${_packPath(ref)}/pointer.json'), ref);
      if (pointer == null) return null;
      final manifest = pointer.manifest;
      if (manifest.scope != ref.scope || manifest.walkId != ref.walkId || manifest.requestedLocale != ref.requestedLocale) return null;
      final stage = '${root.path}/${pointer.stage}';
      final json = jsonDecode(await File('$stage/view.json').readAsString());
      final view = WalkView.fromJson(json);
      if (view.locale != ref.requestedLocale) return null;
      final localAudio = <String, Uri>{};
      for (final item in manifest.audio) {
        final file = File('${root.path}/audio/${item.sha256}.mp3');
        if (await file.exists() && await file.length() == item.bytes) localAudio[item.url] = file.uri;
      }
      final food = manifest.food, source = _food;
      if (seedFood && food != null && source != null) await _seedFood(source, stage, food);
      return OfflineWalk(view: view, json: json, manifest: manifest, localAudio: localAudio);
    } on Exception {
      return null;
    }
  }

  Future<void> _seedFood(OfflineFoodSource source, String stage, OfflineFoodSummary food) async {
    try {
      final manifestBody = await File('$stage/food/manifest.json').readAsString();
      final cells = <OfflineFoodCell>[];
      for (final cell in food.cells) {
        final body = await File('$stage/food/${_cellFile(cell.key)}').readAsString();
        if (utf8.encode(body).length != cell.bytes) return;
        cells.add(OfflineFoodCell(key: cell.key, etag: cell.etag, body: body, bytes: cell.bytes));
      }
      source.seed(OfflineFoodBundle(manifestBody: manifestBody, sourceEditedAt: food.sourceEditedAt, attribution: food.attribution, cells: cells));
    } on Exception {
      // A damaged optional food copy never prevents opening the saved walk.
    }
  }

  Future<OfflineWalkManifest?> status(OfflineWalkRef ref) async => (await load(ref))?.manifest;

  /// Recordings of [view] already on the device, by their site-relative URL. Files reach the
  /// recordings folder only after their SHA-256 was checked, so any saved copy can serve a walk
  /// opened online too.
  Future<Map<String, Uri>> localRecordings(WalkView view) async {
    final result = <String, Uri>{};
    try {
      final root = await _rootDir();
      for (final chapter in view.chapters) {
        final audio = chapter.audio;
        if (audio == null || result.containsKey(audio.url)) continue;
        final file = File('${root.path}/audio/${audio.sha256}.mp3');
        if (await file.exists()) result[audio.url] = file.uri;
      }
    } on FileSystemException {
      // Without the folder the walk streams its recordings.
    }
    return result;
  }

  /// Deletes the copy under [ref] and the recordings only it used.
  Future<void> remove(OfflineWalkRef ref) => _locked(() async {
        final root = await _rootDir();
        final pack = Directory('${root.path}/${_packPath(ref)}');
        final pointerFile = File('${pack.path}/pointer.json');
        final pointer = await _readPointer(pointerFile, ref);
        if (await pointerFile.exists()) await pointerFile.delete();
        if (pointer != null) await _deleteQuietly(Directory('${root.path}/${pointer.stage}'));
        await _pruneQuietly(root);
      });

  /// Removes every copy saved under [scope] (an account on sign-out); a save still running for it
  /// is not published.
  Future<void> clearScope(String scope) {
    _scopeEpoch[scope] = (_scopeEpoch[scope] ?? 0) + 1;
    return _locked(() async {
      final root = await _rootDir();
      final dir = Directory('${root.path}/packs/${_segment(scope)}');
      if (await dir.exists()) await dir.delete(recursive: true);
      await _pruneQuietly(root);
    });
  }

  /// Removes stages and recordings left by a save the app did not finish (killed process).
  Future<void> cleanUp() => _locked(() async => _pruneQuietly(await _rootDir()));

  Future<void> _pruneQuietly(Directory root) async {
    try {
      await _prune(root);
    } on Exception catch (error) {
      debugPrint('offline prune failed: ${error.runtimeType}');
    }
  }

  /// Deletes unpublished stages nobody is writing and recordings no copy or running save references.
  Future<void> _prune(Directory root) async {
    final packs = Directory('${root.path}/packs');
    final published = <String>{};
    final referenced = <String>{};
    final stages = <String>[];
    if (await packs.exists()) {
      await for (final entity in packs.list(recursive: true, followLinks: false)) {
        final relative = _relative(root, entity);
        final name = relative.substring(relative.lastIndexOf('/') + 1);
        if (entity is File && name == 'pointer.json') {
          final pointer = await _readPointer(entity, null);
          if (pointer != null) {
            published.add(pointer.stage);
            referenced.addAll(pointer.manifest.audio.map((item) => item.sha256));
          }
        } else if (entity is Directory && name.startsWith('staging-')) {
          stages.add(relative);
        }
      }
    }
    for (final stage in stages) {
      if (published.contains(stage)) continue;
      if (_active.contains(stage)) {
        referenced.addAll(await _pending(Directory('${root.path}/$stage')));
      } else {
        await _deleteQuietly(Directory('${root.path}/$stage'));
      }
    }
    final audio = Directory('${root.path}/audio');
    if (!await audio.exists()) return;
    await for (final entity in audio.list(followLinks: false)) {
      final name = _relative(root, entity).split('/').last;
      final sha = name.endsWith('.mp3') ? name.substring(0, name.length - 4) : '';
      if (!referenced.contains(sha)) await entity.delete(recursive: true);
    }
  }

  Future<Set<String>> _pending(Directory stage) async {
    try {
      final value = readMap(jsonDecode(await File('${stage.path}/pending.json').readAsString()));
      return {for (final item in readList(value['audio'])) if (item is String) item};
    } on Exception {
      return const {};
    }
  }

  /// A valid pointer, inside the pack of [ref] when it is given.
  Future<_Pointer?> _readPointer(File file, OfflineWalkRef? ref) async {
    try {
      if (!await file.exists()) return null;
      final value = readMap(jsonDecode(await file.readAsString()));
      final stage = value['stage'];
      final manifest = OfflineWalkManifest.tryParse(value['manifest']);
      if (value['version'] != 2 || stage is! String || manifest == null) return null;
      final pack = _packPath(OfflineWalkRef(scope: manifest.scope, walkId: manifest.walkId, requestedLocale: manifest.requestedLocale));
      if (!RegExp('^${RegExp.escape(pack)}/staging-[a-f0-9]{32}\$').hasMatch(stage)) return null;
      if (ref != null && pack != _packPath(ref)) return null;
      return _Pointer(stage, manifest);
    } on Exception {
      return null;
    }
  }

  Future<int?> _verifiedLength(File file, String sha) async {
    try {
      if (!await file.exists()) return null;
      return await _digest(file) == sha ? await file.length() : null;
    } on FileSystemException {
      return null;
    }
  }

  static Future<String> _digest(File file) async => (await sha256.bind(file.openRead()).first).toString();

  static Future<void> _writeAtomic(File file, String text) async {
    await file.parent.create(recursive: true);
    final temp = File('${file.path}.tmp');
    await temp.writeAsString(text, flush: true);
    await temp.rename(file.path);
  }

  static Future<void> _deleteQuietly(FileSystemEntity entity) async {
    try {
      if (await entity.exists()) await entity.delete(recursive: true);
    } on FileSystemException catch (error) {
      debugPrint('offline cleanup failed: ${error.osError?.errorCode}');
    }
  }

  String _randomId() => [for (var i = 0; i < 16; i++) _random.nextInt(256).toRadixString(16).padLeft(2, '0')].join();

  static String _relative(Directory root, FileSystemEntity entity) => entity.path.substring(root.path.length + 1).replaceAll(r'\', '/');

  static String _packPath(OfflineWalkRef ref) {
    final base = 'packs/${_segment(ref.scope)}/${_segment(ref.walkId)}';
    return ref.requestedLocale == ContentLocale.ru ? base : '$base/${ref.requestedLocale.wire}';
  }

  static String _cellFile(String key) => '${key.replaceFirst(':', '_')}.json';

  /// A file-name-safe, reversible encoding: only `[A-Za-z0-9_-]` stays, the rest is `%XX` of UTF-8
  /// (so `.`/`..` and reserved Windows characters never reach the file system).
  static String _segment(String value) {
    final out = StringBuffer();
    for (final byte in utf8.encode(value)) {
      final plain = (byte >= 0x30 && byte <= 0x39) || (byte >= 0x41 && byte <= 0x5a) || (byte >= 0x61 && byte <= 0x7a) || byte == 0x5f || byte == 0x2d;
      if (plain) {
        out.writeCharCode(byte);
      } else {
        out.write('%${byte.toRadixString(16).toUpperCase().padLeft(2, '0')}');
      }
    }
    return out.toString();
  }

  static OfflinePackError _storageError(FileSystemException error) {
    // ENOSPC on Android and iOS, ERROR_DISK_FULL / ERROR_HANDLE_DISK_FULL on Windows.
    final code = error.osError?.errorCode;
    return code == 28 || code == 112 || code == 39 ? OfflinePackError.storageFull : OfflinePackError.failed;
  }
}
