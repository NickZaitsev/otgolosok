import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:otgolosok/core/api/api_error.dart';
import 'package:otgolosok/features/explore/cell_store.dart';
import 'package:otgolosok/features/food/food_model.dart';
import 'package:otgolosok/features/food/food_store.dart';
import 'package:otgolosok/features/offline/offline_food.dart';
import 'package:otgolosok/walk_engine/distance.dart';

const _centre = '1115:752';
const _far = '1200:700';
final _etagA = 'a' * 32, _etagB = 'b' * 32;

Map<String, Object?> _manifest(Map<String, String> cells, {String edited = '2026-10-01T00:00:00Z', int count = 1}) => {
      'version': 1,
      'cellSize': 0.05,
      'sourceEditedAt': edited,
      'attribution': '© OpenStreetMap contributors',
      'cells': [
        for (final MapEntry(:key, :value) in cells.entries)
          {'lat': int.parse(key.split(':')[0]), 'lon': int.parse(key.split(':')[1]), 'count': count, 'etag': value},
      ],
    };

Map<String, Object?> _cell(String key, List<String> ids) {
  final lat = int.parse(key.split(':')[0]), lon = int.parse(key.split(':')[1]);
  return {
    'lat': lat,
    'lon': lon,
    'places': [
      for (final id in ids)
        {
          'id': id,
          'kind': 'coffee',
          'name': 'Кофейня $id',
          'lat': (lat + 0.5) / 20,
          'lon': (lon + 0.5) / 20,
          'address': null,
          'openingHours': null,
          'cuisine': null,
          'website': null,
          'phone': null,
        },
    ],
  };
}

/// A walk inside the centre cell of Moscow.
const _route = [GeoPoint(55.7760, 37.6120), GeoPoint(55.7770, 37.6140)];

class _Server {
  final answers = <String, Object>{};
  final paths = <String>[];

  Future<CellResponse> fetch(String path, {String? etag}) async {
    paths.add(path);
    final answer = answers[path];
    if (answer is CellResponse) return answer;
    // Anything else is the failure to throw.
    throw answer ?? StateError('no answer for $path');
  }
}

void main() {
  late _Server server;
  late FoodCells cells;
  late CellStore<FoodPlace> store;
  late FoodOfflineSource source;

  setUp(() {
    server = _Server();
    cells = FoodCells();
    store = cells.store(fetch: server.fetch, storage: MemoryCellStorage());
    addTearDown(store.dispose);
    source = FoodOfflineSource(fetch: server.fetch, cells: cells, store: store);
  });

  void answer(Map<String, String> manifest, {String edited = '2026-10-01T00:00:00Z'}) {
    server.answers[foodManifestPath] = CellResponse(_manifest(manifest, edited: edited), '"m"');
    for (final MapEntry(:key, :value) in manifest.entries) {
      server.answers[foodCellPath(key)] = CellResponse(_cell(key, ['osm:node:${key.replaceFirst(':', '')}']), '"$value"');
    }
  }

  test('only the cells the route passes are saved, and they open into the store', () async {
    answer({_centre: _etagA, _far: _etagB});
    final download = await source.download(_route, offlineFoodMaxBytes);

    expect(download.warning, isFalse);
    final bundle = download.bundle!;
    expect(bundle.cells.map((cell) => cell.key), [_centre]);
    expect(bundle.cells.single.bytes, utf8.encode(bundle.cells.single.body).length);
    expect(server.paths, [foodManifestPath, foodCellPath(_centre)]);

    source.seed(bundle);
    expect(store.snapshot.points.map((place) => place.id), ['osm:node:1115752']);
    expect(cells.manifest!.attribution, '© OpenStreetMap contributors');
  });

  test('a copy older than the food already known does not roll the store back', () async {
    answer({_centre: _etagA}, edited: '2026-10-20T00:00:00Z');
    await store.ensureKeys([_centre]);
    final old = OfflineFoodBundle(
      manifestBody: jsonEncode(_manifest({_centre: _etagB})),
      sourceEditedAt: '2026-10-01T00:00:00Z',
      attribution: 'old',
      cells: [OfflineFoodCell(key: _centre, etag: _etagB, body: jsonEncode(_cell(_centre, ['osm:node:9'])), bytes: 0)],
    );
    source.seed(old);
    expect(store.snapshot.points.map((place) => place.id), ['osm:node:1115752']);
  });

  test('a saved cell whose places do not match the manifest count is refused', () {
    final bundle = OfflineFoodBundle(
      manifestBody: jsonEncode(_manifest({_centre: _etagA}, count: 2)),
      sourceEditedAt: '2026-10-01T00:00:00Z',
      attribution: 'a',
      cells: [OfflineFoodCell(key: _centre, etag: _etagA, body: jsonEncode(_cell(_centre, ['osm:node:1'])), bytes: 0)],
    );
    expect(() => source.seed(bundle), throwsFormatException);
    expect(store.snapshot.points, isEmpty);
  });

  group('food is skipped, the walk is not:', () {
    final cases = <String, (void Function(_Server), bool)>{
      'the server has no food index, no warning': ((s) => s.answers[foodManifestPath] = const ApiError(message: 'Нет', status: 503), false),
      'the network fails before any food was seen, no warning': (
        (s) => s.answers[foodManifestPath] = const ApiError(message: 'Нет связи', code: 'NETWORK'),
        false,
      ),
      'a cell changed while saving, a warning': (
        (s) => s.answers[foodCellPath(_centre)] = CellResponse(_cell(_centre, ['osm:node:1']), '"${'c' * 32}"'),
        true,
      ),
    };
    for (final MapEntry(key: name, value: (breakIt, warning)) in cases.entries) {
      test(name, () async {
        answer({_centre: _etagA});
        breakIt(server);
        final download = await source.download(_route, offlineFoodMaxBytes);
        expect(download.bundle, isNull);
        expect(download.warning, warning);
      });
    }

    test('the network fails after the food layer worked, a warning', () async {
      answer({_centre: _etagA});
      await store.ensureKeys([_centre]);
      server.answers[foodManifestPath] = const ApiError(message: 'Нет связи', code: 'NETWORK');
      final download = await source.download(_route, offlineFoodMaxBytes);
      expect(download.bundle, isNull);
      expect(download.warning, isTrue);
    });

    test('the budget is too small, a warning', () async {
      answer({_centre: _etagA});
      final download = await source.download(_route, 300);
      expect(download.bundle, isNull);
      expect(download.warning, isTrue);
    });

    test('a route without a line, nothing to save', () async {
      final download = await source.download(const [GeoPoint(55.77, 37.61)], offlineFoodMaxBytes);
      expect(download.bundle, isNull);
      expect(download.warning, isFalse);
      expect(server.paths, isEmpty);
    });
  });
}
