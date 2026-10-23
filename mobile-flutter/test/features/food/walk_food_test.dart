import 'package:flutter_test/flutter_test.dart';
import 'package:otgolosok/core/api/api_error.dart';
import 'package:otgolosok/features/explore/cell_store.dart';
import 'package:otgolosok/features/food/food_model.dart';
import 'package:otgolosok/features/food/walk_food.dart';
import 'package:otgolosok/walk_engine/distance.dart';
import 'package:otgolosok/walk_engine/walk_view.dart' show WalkMode;

const _centre = '1115:752';
final _etag = 'a' * 32;

/// A straight walk of about 220 m inside the centre cell, with one stop half way (legs are cut at vertices).
const _route = [GeoPoint(55.7760, 37.6120), GeoPoint(55.7760, 37.61375), GeoPoint(55.7760, 37.6155)];
const _stops = [GeoPoint(55.7760, 37.61375)];

Map<String, Object?> _place(String id, double lat, double lon) => {
      'id': id,
      'kind': 'cafe',
      'name': 'Кафе $id',
      'lat': lat,
      'lon': lon,
      'address': null,
      'openingHours': null,
      'cuisine': null,
      'website': null,
      'phone': null,
    };

final _manifest = {
  'version': 1,
  'cellSize': 0.05,
  'sourceEditedAt': '2026-10-01T00:00:00Z',
  'attribution': '© OpenStreetMap contributors',
  'cells': [
    {'lat': 1115, 'lon': 752, 'count': 3, 'etag': _etag},
  ],
};

final _cell = {
  'lat': 1115,
  'lon': 752,
  'places': [
    // Near the start, near the end, and 300 m off the route.
    _place('osm:node:1', 55.7761, 37.6125),
    _place('osm:node:2', 55.7761, 37.6150),
    _place('osm:node:3', 55.7790, 37.6130),
  ],
};

class _Server {
  final answers = <String, Object>{};
  final paths = <String>[];

  Future<CellResponse> fetch(String path, {String? etag}) async {
    paths.add(path);
    final answer = answers[path];
    if (answer is CellResponse) return answer;
    throw answer ?? StateError('no answer for $path');
  }
}

void main() {
  late _Server server;
  late WalkFood food;

  setUp(() {
    server = _Server()
      ..answers[foodManifestPath] = CellResponse(_manifest, '"m"')
      ..answers[foodCellPath(_centre)] = CellResponse(_cell, '"$_etag"');
    final cells = FoodCells();
    final store = cells.store(fetch: server.fetch, storage: MemoryCellStorage());
    food = WalkFood(store: store, cells: cells);
    addTearDown(() {
      food.dispose();
      store.dispose();
    });
  });

  test('a walk without a line asks nothing and offers no button', () async {
    food.setRoute(const [GeoPoint(55.776, 37.612)], const [], WalkMode.open);
    await pumpEventQueue();
    expect(server.paths, isEmpty);
    expect(food.available, isFalse);
  });

  test('the manifest loads with the route; the cells only once the list opens', () async {
    food.setRoute(_route, _stops, WalkMode.open);
    await pumpEventQueue();
    expect(server.paths, [foodManifestPath]);
    expect(food.available, isTrue);
    expect(food.loading, isTrue);

    food.setVisible(true);
    await pumpEventQueue();
    expect(server.paths, [foodManifestPath, foodCellPath(_centre)]);
    expect(food.loading, isFalse);
    expect(food.places.map((place) => place.id), ['osm:node:1', 'osm:node:2']);
  });

  test('the leg start splits the places and the stops are measured along the route', () async {
    food.setRoute(_route, _stops, WalkMode.open);
    food.setVisible(true);
    await pumpEventQueue();
    expect(food.fromM(0), 0);
    expect(food.stopsAlongM.single, closeTo(110, 2));
    // The second leg starts at the stop: the first place is behind it, the second ahead.
    final from = food.fromM(1);
    expect(food.places.first.alongM, lessThan(from));
    expect(food.places.last.alongM, greaterThanOrEqualTo(from));
  });

  test('a failed cell is shown as an error once, without asking again, until retried', () async {
    server.answers[foodCellPath(_centre)] = const ApiError(message: 'Ошибка', status: 400);
    food.setRoute(_route, _stops, WalkMode.open);
    food.setVisible(true);
    await pumpEventQueue();
    expect(food.error, isTrue);
    final asked = server.paths.where((path) => path == foodCellPath(_centre)).length;
    // Rebuilds and further store updates do not loop on the failing cell.
    food.setRoute(_route, _stops, WalkMode.open);
    await pumpEventQueue();
    expect(server.paths.where((path) => path == foodCellPath(_centre)).length, asked);

    server.answers[foodCellPath(_centre)] = CellResponse(_cell, '"$_etag"');
    await food.retry();
    await pumpEventQueue();
    expect(food.error, isFalse);
    expect(food.places, hasLength(2));
  });

  test('a failed manifest is reported for the walk, as no button can show', () async {
    server.answers[foodManifestPath] = const ApiError(message: 'Нет связи', code: 'NETWORK');
    food.setRoute(_route, _stops, WalkMode.open);
    await pumpEventQueue();
    expect(food.available, isFalse);
    expect(food.manifestError, isTrue);
  });

  test('a server without food data hides everything quietly', () async {
    server.answers[foodManifestPath] = const ApiError(message: 'Нет', status: 503);
    food.setRoute(_route, _stops, WalkMode.open);
    await pumpEventQueue();
    expect(food.available, isFalse);
    expect(food.manifestError, isFalse);
  });
}
