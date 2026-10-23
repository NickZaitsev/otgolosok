import 'dart:async';
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:otgolosok/core/api/api_error.dart';
import 'package:otgolosok/features/explore/catalog_bounds.dart';
import 'package:otgolosok/features/explore/cell_store.dart';
import 'package:otgolosok/features/explore/map_cells.dart';

String _etag(String letter) => letter * 32;

Map<String, Object?> _manifest(Map<String, String> cells) => {
      'version': 1,
      'cellSize': 1,
      'cells': [
        for (final MapEntry(:key, :value) in cells.entries)
          {'lat': int.parse(key.split(':')[0]), 'lon': int.parse(key.split(':')[1]), 'count': 1, 'etag': value},
      ],
    };

Map<String, Object?> _cell(String key, List<String> ids) => {
      'lat': int.parse(key.split(':')[0]),
      'lon': int.parse(key.split(':')[1]),
      'points': [
        for (final id in ids)
          {
            'id': id,
            'lat': int.parse(key.split(':')[0]) + 0.5,
            'lon': int.parse(key.split(':')[1]) + 0.5,
            'title': 'Место $id',
            'address': 'Адрес $id',
            'durationSec': 60,
            'facts': 1,
            'sources': 1,
          },
      ],
    };

/// The rectangle inside one cell.
CatalogBounds _inside(String key) {
  final lat = int.parse(key.split(':')[0]).toDouble(), lon = int.parse(key.split(':')[1]).toDouble();
  return CatalogBounds(west: lon + 0.2, south: lat + 0.2, east: lon + 0.8, north: lat + 0.8);
}

typedef _Call = ({String path, String? etag});

/// A server whose answers are set per path; an answer may be a [Completer] to hold the request.
class _Server {
  final calls = <_Call>[];
  final answers = <String, Object>{};

  List<_Call> to(String path) => calls.where((call) => call.path == path).toList();

  Future<CellResponse> fetch(String path, {String? etag}) async {
    calls.add((path: path, etag: etag));
    var answer = answers[path];
    if (answer is Completer<Object>) answer = await answer.future;
    if (answer is CellResponse) return answer;
    // Anything else is the failure to throw.
    throw answer ?? StateError('no answer for $path');
  }
}

void main() {
  const moscow = '55:37';
  late _Server server;
  late MemoryCellStorage storage;
  late DateTime now;
  late MapCellStore store;

  setUp(() {
    server = _Server();
    storage = MemoryCellStorage();
    now = DateTime(2026, 10, 23, 12);
    store = createMapCellStore(fetch: server.fetch, storage: storage, now: () => now);
    addTearDown(store.dispose);
  });

  void answerManifest(Map<String, String> cells, {String etag = '"m1"'}) =>
      server.answers[mapCellsManifestPath] = CellResponse(_manifest(cells), etag);

  void answerCell(String key, List<String> ids, String etag) => server.answers[mapCellPath(key)] = CellResponse(_cell(key, ids), '"$etag"');

  test('an area loads the manifest and its cells, and keeps copies on disk', () async {
    answerManifest({moscow: _etag('a'), '59:30': _etag('b')});
    answerCell(moscow, ['p1', 'p2'], _etag('a'));
    await store.ensureArea([_inside(moscow)]);

    expect(store.snapshot.points.map((point) => point.id), ['p1', 'p2']);
    expect(store.snapshot.manifestStatus, ManifestStatus.ready);
    expect(areaStatus(store.snapshot, _inside(moscow)), CellStatus.ready);
    // Only cells under the area are requested.
    expect(server.calls.map((call) => call.path), [mapCellsManifestPath, mapCellPath(moscow)]);
    expect(storage.entries[mapCellPath(moscow)]!.etag, '"${_etag('a')}"');
    expect(storage.entries[mapCellsManifestPath]!.etag, '"m1"');
  });

  test('a fresh manifest is not asked again; a stale one is revalidated by ETag', () async {
    answerManifest({moscow: _etag('a')});
    answerCell(moscow, ['p1'], _etag('a'));
    await store.ensureArea([_inside(moscow)]);

    now = now.add(const Duration(minutes: 4));
    await store.ensureArea([_inside(moscow)]);
    expect(server.calls, hasLength(2));

    now = now.add(const Duration(minutes: 2));
    server.answers[mapCellsManifestPath] = const CellResponse.notModified('"m1"');
    await store.ensureArea([_inside(moscow)]);
    await pumpEventQueue();
    expect(server.calls.last, (path: mapCellsManifestPath, etag: '"m1"'));
    // The unchanged cell is not asked again.
    expect(server.to(mapCellPath(moscow)), hasLength(1));
    expect(store.snapshot.points.map((point) => point.id), ['p1']);
  });

  test('a changed cell is revalidated with its ETag and replaced', () async {
    answerManifest({moscow: _etag('a')});
    answerCell(moscow, ['p1'], _etag('a'));
    await store.ensureArea([_inside(moscow)]);

    now = now.add(const Duration(minutes: 6));
    answerManifest({moscow: _etag('c')}, etag: '"m2"');
    answerCell(moscow, ['p3'], _etag('c'));
    await store.ensureArea([_inside(moscow)]);
    await pumpEventQueue();

    expect(server.to(mapCellPath(moscow)).last.etag, '"${_etag('a')}"');
    expect(store.snapshot.points.map((point) => point.id), ['p3']);
  });

  test('a cell dropped from the manifest leaves the map', () async {
    answerManifest({moscow: _etag('a')});
    answerCell(moscow, ['p1'], _etag('a'));
    await store.ensureArea([_inside(moscow)]);

    now = now.add(const Duration(minutes: 6));
    answerManifest({}, etag: '"m2"');
    await store.ensureArea([_inside(moscow)]);
    await pumpEventQueue();
    expect(store.snapshot.points, isEmpty);
    expect(store.snapshot.loadedKeys, isEmpty);
  });

  test('offline, the copies on disk keep serving the map', () async {
    storage.entries[mapCellsManifestPath] = StoredCell('"m1"', jsonEncode(_manifest({moscow: _etag('a')})));
    storage.entries[mapCellPath(moscow)] = StoredCell('"${_etag('a')}"', jsonEncode(_cell(moscow, ['p1'])));
    server.answers[mapCellsManifestPath] = const ApiError(message: 'Нет сети', code: 'NETWORK');

    await store.ensureArea([_inside(moscow)]);
    await pumpEventQueue();

    expect(store.snapshot.points.map((point) => point.id), ['p1']);
    expect(areaStatus(store.snapshot, _inside(moscow)), CellStatus.ready);
    expect(store.snapshot.manifestStatus, ManifestStatus.ready);
    // The stored cell matches the stored manifest: no cell request while the manifest is unreachable.
    expect(server.to(mapCellPath(moscow)), isEmpty);
  });

  test('a cell without any copy fails, and a retry recovers it', () async {
    answerManifest({moscow: _etag('a')});
    server.answers[mapCellPath(moscow)] = const ApiError(message: 'Сбой', status: 500);
    await store.ensureArea([_inside(moscow)]);
    expect(areaStatus(store.snapshot, _inside(moscow)), CellStatus.error);

    answerCell(moscow, ['p1'], _etag('a'));
    await store.retry([_inside(moscow)]);
    expect(areaStatus(store.snapshot, _inside(moscow)), CellStatus.ready);
    expect(store.snapshot.points.map((point) => point.id), ['p1']);
  });

  test('without a manifest anywhere the area fails', () async {
    server.answers[mapCellsManifestPath] = const ApiError(message: 'Нет сети', code: 'NETWORK');
    await store.ensureArea([_inside(moscow)]);
    expect(store.snapshot.manifestStatus, ManifestStatus.error);
    expect(areaStatus(store.snapshot, _inside(moscow)), CellStatus.error);
  });

  test('maintenance answers are reported, other failures are not', () async {
    server.answers[mapCellsManifestPath] = const ApiError(message: 'Обновление', status: 503, code: 'SERVICE_MAINTENANCE');
    await store.ensureArea([_inside(moscow)]);
    expect(store.snapshot.maintenance, isTrue);

    answerManifest({moscow: _etag('a')});
    answerCell(moscow, ['p1'], _etag('a'));
    await store.retry([_inside(moscow)]);
    expect(store.snapshot.maintenance, isFalse);
  });

  test('at most four cells load at a time', () async {
    final keys = ['55:30', '55:31', '55:32', '55:33', '55:34', '55:35'];
    answerManifest({for (final key in keys) key: _etag('a')});
    final held = {for (final key in keys) key: Completer<Object>()};
    for (final key in keys) {
      server.answers[mapCellPath(key)] = held[key]!;
    }
    final done = store.ensureArea([const CatalogBounds(west: 30.2, south: 55.2, east: 35.8, north: 55.8)]);
    await pumpEventQueue();
    expect(store.activeCellRequests, CellStore.maxConcurrentCells);
    expect(server.calls.where((call) => call.path != mapCellsManifestPath), hasLength(4));
    expect(areaStatus(store.snapshot, _inside('55:30')), CellStatus.loading);

    held['55:30']!.complete(CellResponse(_cell('55:30', ['p0']), '"${_etag('a')}"'));
    await pumpEventQueue();
    expect(server.calls.where((call) => call.path != mapCellsManifestPath), hasLength(5));
    expect(store.activeCellRequests, CellStore.maxConcurrentCells);

    for (final (index, key) in keys.indexed.skip(1)) {
      held[key]!.complete(CellResponse(_cell(key, ['p$index']), '"${_etag('a')}"'));
    }
    await done;
    expect(store.activeCellRequests, 0);
    expect(store.snapshot.points, hasLength(6));
  });

  test('a cell asked twice at once is fetched once', () async {
    answerManifest({moscow: _etag('a')});
    final held = Completer<Object>();
    server.answers[mapCellPath(moscow)] = held;
    final first = store.ensureArea([_inside(moscow)]);
    final second = store.ensureKeys([moscow]);
    await pumpEventQueue();
    held.complete(CellResponse(_cell(moscow, ['p1']), '"${_etag('a')}"'));
    await Future.wait([first, second]);
    expect(server.to(mapCellPath(moscow)), hasLength(1));
  });
}
