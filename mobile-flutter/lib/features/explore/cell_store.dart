/// Geographic cells loaded by area with an ETag cache (port of `src/lib/geo/cell-store.ts`).
///
/// Memory → disk → network: a cached cell is shown at once and revalidated against the manifest; the
/// manifest itself is rechecked after [revalidateAfter]. At most [maxConcurrentCells] cells load at a time.
/// A stale copy keeps serving while offline; only a cell without any copy reports an error.
library;

import 'dart:async';
import 'dart:collection';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';

import '../../core/api/api_client.dart';
import 'catalog_bounds.dart';

class ManifestCell {
  const ManifestCell({required this.count, required this.etag});

  final int count;
  final String etag;
}

enum CellStatus { ready, loading, error }

enum ManifestStatus { idle, loading, ready, error }

/// What the screen renders from the store.
class CellSnapshot<T> {
  const CellSnapshot({
    required this.points,
    required this.manifestKeys,
    required this.loadedKeys,
    required this.cellStatus,
    required this.manifestStatus,
    required this.maintenance,
  });

  final List<T> points;

  /// Cells listed by the manifest; null until any manifest (memory, disk or network) is known.
  final Set<String>? manifestKeys;

  /// Cells with data in memory, possibly older than the manifest while it is revalidated.
  final Set<String> loadedKeys;
  final Map<String, CellStatus> cellStatus;
  final ManifestStatus manifestStatus;
  final bool maintenance;
}

/// A response to a conditional `GET`: either a decoded body or `304 Not Modified`.
class CellResponse {
  const CellResponse(this.json, this.etag) : notModified = false;
  const CellResponse.notModified(this.etag)
      : json = null,
        notModified = true;

  final Object? json;
  final String? etag;
  final bool notModified;
}

/// `GET path` with `If-None-Match: etag`; throws on failure (the API client already retried).
typedef CellFetch = Future<CellResponse> Function(String path, {String? etag});

/// The conditional fetch through the app's API client; [noRetryStatuses] fail at once.
CellFetch apiCellFetch(ApiClient api, {Set<int> noRetryStatuses = const {}}) => (path, {etag}) async {
      final response = await api.getConditional<Object?>(path, (json) => json, etag: etag, noRetryStatuses: noRetryStatuses);
      return response.notModified ? CellResponse.notModified(response.etag) : CellResponse(response.value, response.etag);
    };

class StoredCell {
  const StoredCell(this.etag, this.body);

  final String etag;
  final String body;
}

/// Persistent copies of responses. Only an accelerator: every failure counts as an empty cache.
abstract interface class CellStorage {
  Future<StoredCell?> read(String path);
  Future<void> write(String path, String etag, String body);
}

/// Copies in memory only (tests, or when the files directory is unavailable).
class MemoryCellStorage implements CellStorage {
  final Map<String, StoredCell> entries = {};

  @override
  Future<StoredCell?> read(String path) async => entries[path];

  @override
  Future<void> write(String path, String etag, String body) async => entries[path] = StoredCell(etag, body);
}

/// One JSON file per response in [directory]; written to a temporary file and renamed, so a crash never
/// leaves half a file. Older schema directories next to it (`<prefix>v<N>`) are removed on first use.
class FileCellStorage implements CellStorage {
  FileCellStorage(this._directory);

  /// [_directory] resolves lazily so creating the store needs no I/O.
  final Future<Directory> Function() _directory;
  Future<Directory?>? _opened;

  static final _unsafe = RegExp(r'[^a-zA-Z0-9-]');
  static final _version = RegExp(r'v\d+$');

  Future<Directory?> _open() => _opened ??= () async {
        try {
          final directory = await _directory();
          await directory.create(recursive: true);
          final name = directory.uri.pathSegments.where((segment) => segment.isNotEmpty).last;
          final prefix = name.replaceFirst(_version, '');
          await for (final sibling in directory.parent.list()) {
            final siblingName = sibling.uri.pathSegments.where((segment) => segment.isNotEmpty).last;
            if (sibling is Directory && siblingName != name && siblingName.startsWith(prefix) && _version.hasMatch(siblingName)) {
              await sibling.delete(recursive: true);
            }
          }
          return directory;
        } catch (error) {
          // A stale schema only wastes space, and without a directory the memory copy still serves this session.
          debugPrint('map cell cache unavailable: $error');
          return null;
        }
      }();

  File _file(Directory directory, String path) => File('${directory.path}${Platform.pathSeparator}${path.replaceAll(_unsafe, '_')}.json');

  @override
  Future<StoredCell?> read(String path) async {
    final directory = await _open();
    if (directory == null) return null;
    try {
      final file = _file(directory, path);
      if (!await file.exists()) return null;
      final json = jsonDecode(await file.readAsString());
      if (json is! Map<String, Object?> || json['etag'] is! String || json['body'] is! String) return null;
      return StoredCell(json['etag']! as String, json['body']! as String);
    } catch (_) {
      return null;
    }
  }

  @override
  Future<void> write(String path, String etag, String body) async {
    final directory = await _open();
    if (directory == null) return;
    final file = _file(directory, path);
    final temporary = File('${file.path}.tmp');
    try {
      await temporary.writeAsString(jsonEncode({'etag': etag, 'body': body}), flush: true);
      await temporary.rename(file.path);
    } catch (error) {
      // Disk full or removed: the memory copy still serves this session.
      debugPrint('map cell cache write failed: $error');
    }
  }
}

/// `W/"abc"` and `"abc"` → `abc`.
String? bareEtag(String? value) {
  if (value == null) return null;
  final trimmed = value.trim().replaceFirst(RegExp('^W/'), '');
  final match = RegExp(r'^"(.*)"$').firstMatch(trimmed);
  final bare = match == null ? trimmed : match[1]!;
  return bare.isEmpty ? null : bare;
}

class CellStore<T> extends ChangeNotifier {
  CellStore({
    required this._fetch,
    required this._storage,
    required this.manifestPath,
    required this.cellPath,
    required this.parseManifest,
    required this.parseCell,
    required this.cellsFor,
    required this.pointId,
    required this.isUnavailable,
    DateTime Function()? now,
  }) : _now = now ?? DateTime.now;

  static const revalidateAfter = Duration(minutes: 5);
  static const failedRevalidateAfter = Duration(seconds: 30);
  static const maxConcurrentCells = 4;
  static const recentAreas = 8;

  final CellFetch _fetch;
  final CellStorage _storage;
  final DateTime Function() _now;
  final String manifestPath;
  final String Function(String key) cellPath;
  final Map<String, ManifestCell> Function(Object? json) parseManifest;
  final List<T> Function(Object? json, String key) parseCell;
  final List<String> Function(Iterable<String> keys, CatalogBounds bounds) cellsFor;
  final String Function(T point) pointId;
  final bool Function(Object error) isUnavailable;

  _Manifest? _manifest;
  ManifestStatus _manifestStatus = ManifestStatus.idle;
  bool _maintenance = false;
  Future<void>? _storedManifest;
  Future<void>? _revalidating;
  final _memory = <String, _MemoryCell<T>>{};
  int _fetches = 0;
  final _status = <String, CellStatus>{};
  final _inflight = <String, Future<void>>{};
  final _areas = <CatalogBounds>[];
  final _requestedKeys = <String>{};
  int _active = 0;
  final _waiting = Queue<Completer<void>>();
  bool _pointsDirty = false;
  bool _disposed = false;
  late CellSnapshot<T> _snapshot = CellSnapshot<T>(
    points: const [],
    manifestKeys: null,
    loadedKeys: const {},
    cellStatus: const {},
    manifestStatus: _manifestStatus,
    maintenance: false,
  );

  CellSnapshot<T> get snapshot => _snapshot;

  /// The number of cell requests running now; never above [maxConcurrentCells].
  @visibleForTesting
  int get activeCellRequests => _active;

  void _emit() {
    final points = _pointsDirty ? _union() : _snapshot.points;
    _pointsDirty = false;
    _snapshot = CellSnapshot<T>(
      points: points,
      manifestKeys: _manifest == null ? null : Set.unmodifiable(_manifest!.cells.keys),
      loadedKeys: Set.unmodifiable(_memory.keys),
      cellStatus: Map.unmodifiable(_status),
      manifestStatus: _manifestStatus,
      maintenance: _maintenance,
    );
    if (!_disposed) notifyListeners();
  }

  void _setCell(String key, String etag, List<T> points) {
    _memory[key] = _MemoryCell(etag, points, _fetches += 1);
    _pointsDirty = true;
  }

  /// One set of points, deduplicated by id: a place moved across a cell line may sit in a fresh cell and a
  /// stale one for a moment, and the most recently fetched cell wins.
  List<T> _union() {
    final cells = _memory.values.toList()..sort((a, b) => a.fetched - b.fetched);
    final points = <String, T>{};
    for (final cell in cells) {
      for (final point in cell.points) {
        points[pointId(point)] = point;
      }
    }
    return List.unmodifiable(points.values);
  }

  void _replaceManifest(String? etag, Map<String, ManifestCell> cells, DateTime nextCheckAt) {
    _manifest = _Manifest(etag, cells, nextCheckAt);
    for (final key in _memory.keys.toList()) {
      if (!cells.containsKey(key)) {
        _memory.remove(key);
        _status.remove(key);
        _pointsDirty = true;
      }
    }
  }

  Future<StoredCell?> _read(String path) async {
    try {
      return await _storage.read(path);
    } catch (_) {
      return null;
    }
  }

  Future<void> _write(String path, String etag, String body) async {
    try {
      await _storage.write(path, etag, body);
    } catch (_) {
      // Storage is only an accelerator.
    }
  }

  Future<void> _loadStoredManifest() async {
    final stored = await _read(manifestPath);
    if (stored == null || _manifest != null) return;
    try {
      _replaceManifest(stored.etag, parseManifest(jsonDecode(stored.body)), DateTime.fromMillisecondsSinceEpoch(0));
      _manifestStatus = ManifestStatus.ready;
      _emit();
    } catch (_) {
      // A broken stored copy is ignored; the network copy replaces it.
    }
  }

  Future<void> _revalidateManifest() async {
    if (_manifest == null) {
      _manifestStatus = ManifestStatus.loading;
      _emit();
    }
    try {
      final previous = _manifest;
      final response = await _fetch(manifestPath, etag: previous?.etag);
      if (response.notModified) {
        if (previous == null || !identical(_manifest, previous)) throw const FormatException('Некорректный ответ списка областей карты.');
        previous.nextCheckAt = _now().add(revalidateAfter);
      } else {
        final body = jsonEncode(response.json);
        _replaceManifest(response.etag, parseManifest(response.json), _now().add(revalidateAfter));
        if (response.etag != null) await _write(manifestPath, response.etag!, body);
        // Cells changed by this manifest are refreshed for the areas asked for recently.
        unawaited(_ensureAreas(List.of(_areas)));
        unawaited(ensureKeys(List.of(_requestedKeys)));
      }
      _manifestStatus = ManifestStatus.ready;
      _maintenance = false;
    } catch (error) {
      _maintenance = isUnavailable(error);
      final manifest = _manifest;
      if (manifest != null) {
        manifest.nextCheckAt = _now().add(failedRevalidateAfter);
      } else {
        _manifestStatus = ManifestStatus.error;
      }
    } finally {
      _emit();
    }
  }

  bool _fresh() {
    final manifest = _manifest;
    return manifest != null && _now().isBefore(manifest.nextCheckAt);
  }

  /// Resolves once some manifest is available; a stale one is revalidated in the background.
  Future<void> ensureManifest({bool force = false}) async {
    if (!force && _fresh()) return;
    await (_storedManifest ??= _loadStoredManifest());
    if (!force && _fresh()) return;
    final network = _revalidating ??= _revalidateManifest().whenComplete(() {
      _revalidating = null;
    });
    if (_manifest == null) await network;
  }

  Future<R> _limited<R>(Future<R> Function() task) async {
    if (_active >= maxConcurrentCells) {
      final slot = Completer<void>();
      _waiting.add(slot);
      await slot.future;
    }
    _active += 1;
    try {
      return await task();
    } finally {
      _active -= 1;
      if (_waiting.isNotEmpty) _waiting.removeFirst().complete();
    }
  }

  Future<void> _loadCell(String key) async {
    final path = cellPath(key);
    if (!_memory.containsKey(key)) {
      final stored = await _read(path);
      if (stored != null && !_memory.containsKey(key)) {
        try {
          _setCell(key, bareEtag(stored.etag) ?? '', parseCell(jsonDecode(stored.body), key));
          _status[key] = CellStatus.ready;
          _emit();
        } catch (_) {
          // A broken stored copy is refetched below.
        }
      }
    }
    final expected = _manifest?.cells[key]?.etag;
    final current = _memory[key];
    if (expected == null || current?.etag == expected) return;
    if (current == null) {
      _status[key] = CellStatus.loading;
      _emit();
    }
    try {
      final response = await _limited(() => _fetch(path, etag: current == null ? null : '"${current.etag}"'));
      String etag;
      if (response.notModified) {
        if (current == null) throw const FormatException('Некорректный ответ области карты.');
        etag = current.etag;
      } else {
        final points = parseCell(response.json, key);
        etag = bareEtag(response.etag) ?? expected;
        _setCell(key, etag, points);
        await _write(path, '"$etag"', jsonEncode(response.json));
      }
      // The cell was published after the manifest was read: keep the newer cell and recheck the manifest.
      final manifest = _manifest;
      if (manifest != null && etag != manifest.cells[key]?.etag) manifest.nextCheckAt = DateTime.fromMillisecondsSinceEpoch(0);
      _status[key] = CellStatus.ready;
      _maintenance = false;
    } catch (error) {
      _maintenance = isUnavailable(error);
      // A stale copy keeps serving (offline included); only a cell without any copy is an error.
      _status[key] = _memory.containsKey(key) ? CellStatus.ready : CellStatus.error;
    } finally {
      _emit();
    }
  }

  Future<void> _ensureCell(String key) {
    final running = _inflight[key];
    if (running != null) return running;
    // A block body: returning the removed future from whenComplete would make the task wait for itself.
    final task = _loadCell(key).whenComplete(() {
      _inflight.remove(key);
    });
    _inflight[key] = task;
    return task;
  }

  Future<void> _ensureAreas(List<CatalogBounds> bounds) async {
    await ensureManifest();
    final cells = _manifest?.cells;
    if (cells == null) return;
    // Only manifest cells are requested: everything else is empty.
    final keys = {for (final area in bounds) ...cellsFor(cells.keys, area)};
    await Future.wait(keys.map(_ensureCell));
  }

  Future<void> ensureKeys(Iterable<String> keys) async {
    final selected = keys.toList();
    _requestedKeys.addAll(selected);
    await ensureManifest();
    await Future.wait(selected.where((key) => _manifest?.cells.containsKey(key) ?? false).map(_ensureCell));
  }

  void _remember(List<CatalogBounds> bounds) {
    for (final area in bounds) {
      _areas
        ..remove(area)
        ..add(area);
    }
    if (_areas.length > recentAreas) _areas.removeRange(0, _areas.length - recentAreas);
  }

  /// Loads the cells of the areas and keeps them fresh on later manifest updates.
  Future<void> ensureArea(List<CatalogBounds> bounds) {
    _remember(bounds);
    return _ensureAreas(bounds);
  }

  /// Puts cells saved with an offline copy into the store. Everything is validated first, so a damaged
  /// package never half-replaces the store; the manifest is due for revalidation once online again.
  void seedOffline(Object? manifest, List<({String key, String etag, Object? body})> cells) {
    final parsed = [for (final cell in cells) (cell: cell, points: parseCell(cell.body, cell.key))];
    final next = parseManifest(manifest);
    for (final (:cell, points: _) in parsed) {
      if (next[cell.key]?.etag != bareEtag(cell.etag)) throw const FormatException('Некорректная офлайн-область карты.');
    }
    _replaceManifest(null, next, DateTime.fromMillisecondsSinceEpoch(0));
    for (final (:cell, :points) in parsed) {
      _setCell(cell.key, bareEtag(cell.etag) ?? '', points);
      _status[cell.key] = CellStatus.ready;
    }
    _manifestStatus = ManifestStatus.ready;
    _maintenance = false;
    _emit();
  }

  /// Forces a manifest revalidation, e.g. after a published story turned out to be gone.
  Future<void> revalidate() => ensureManifest(force: true);

  Future<void> retry(List<CatalogBounds> bounds) async {
    _remember(bounds);
    await ensureManifest(force: true);
    await _ensureAreas(bounds);
  }

  @override
  void dispose() {
    _disposed = true;
    super.dispose();
  }
}

class _Manifest {
  _Manifest(this.etag, this.cells, this.nextCheckAt);

  final String? etag;
  final Map<String, ManifestCell> cells;
  DateTime nextCheckAt;
}

class _MemoryCell<T> {
  const _MemoryCell(this.etag, this.points, this.fetched);

  final String etag;
  final List<T> points;
  final int fetched;
}
