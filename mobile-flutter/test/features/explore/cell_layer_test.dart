import 'package:flutter_test/flutter_test.dart';
import 'package:otgolosok/core/api/api_error.dart';
import 'package:otgolosok/core/settings/settings_store.dart';
import 'package:otgolosok/features/explore/catalog_bounds.dart';
import 'package:otgolosok/features/explore/cell_layer.dart';
import 'package:otgolosok/features/explore/cell_store.dart';
import 'package:otgolosok/features/explore/map_cells.dart';
import 'package:otgolosok/walk_engine/distance.dart';
import 'package:shared_preferences/shared_preferences.dart';

const _key = 'test-layer';
const _cellKey = '55:37';
const _maintenance = ApiError(message: 'Обновляемся', status: 503, code: 'SERVICE_MAINTENANCE');

final _etag = 'a' * 32;
final _manifest = {
  'version': 1,
  'cellSize': 1,
  'cells': [
    {'lat': 55, 'lon': 37, 'count': 1, 'etag': _etag},
  ],
};
final _cell = {
  'lat': 55,
  'lon': 37,
  'points': [
    {'id': 'osm:node:1', 'lat': 55.751, 'lon': 37.601, 'title': 'Дом', 'address': 'Арбат, 1', 'durationSec': 60, 'facts': 1, 'sources': 1},
    {'id': 'osm:node:2', 'lat': 55.9, 'lon': 37.9, 'title': 'Далеко', 'address': 'Окраина', 'durationSec': 60, 'facts': 1, 'sources': 1},
  ],
};

MapViewport _view(double zoom) => MapViewport(
      required: const CatalogBounds(west: 37.59, south: 55.74, east: 37.61, north: 55.76),
      buffered: const CatalogBounds(west: 37.58, south: 55.73, east: 37.62, north: 55.77),
      zoom: zoom,
      center: const GeoPoint(55.75, 37.6),
    );

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
  late MapCellStore store;

  setUp(() {
    server = _Server()
      ..answers[mapCellsManifestPath] = CellResponse(_manifest, '"m"')
      ..answers[mapCellPath(_cellKey)] = CellResponse(_cell, '"$_etag"');
    store = createMapCellStore(fetch: server.fetch, storage: MemoryCellStorage());
    addTearDown(store.dispose);
  });

  Future<CellLayer<CatalogPoint>> layer({Map<String, Object> stored = const {}, bool byDefault = false, bool eager = false}) async {
    SharedPreferences.setMockInitialValues(stored);
    final result = CellLayer<CatalogPoint>(
      store: store,
      settings: SettingsStore(await SharedPreferences.getInstance()),
      toggleKey: _key,
      minZoom: 14,
      enabledByDefault: byDefault,
      eagerManifest: eager,
    );
    addTearDown(result.dispose);
    return result;
  }

  group('the toggle starts from', () {
    const cases = [
      ('no choice, off by default', <String, Object>{}, false, false),
      ('no choice, on by default (driving)', <String, Object>{}, true, true),
      ('a remembered «off» over the default', {_key: '0'}, true, false),
      ('a remembered «on»', {_key: '1'}, false, true),
    ];
    for (final (name, stored, byDefault, enabled) in cases) {
      test(name, () async => expect((await layer(stored: stored, byDefault: byDefault)).enabled, enabled));
    }
  });

  test('a layer that is off asks nothing of the server unless its toggle waits for the manifest', () async {
    final quiet = await layer();
    quiet.onViewport(_view(15));
    await pumpEventQueue();
    expect(server.paths, isEmpty);
    expect(quiet.notice, isNull);

    final eager = await layer(eager: true);
    await pumpEventQueue();
    expect(server.paths, [mapCellsManifestPath]);
    expect(eager.available, isTrue);
    expect(eager.visible((point) => point.location), isEmpty);
  });

  test('below the zoom the walker is asked to zoom in and no cell is loaded', () async {
    final subject = await layer(stored: {_key: '1'});
    subject.onViewport(_view(13.9));
    await pumpEventQueue();
    expect(subject.notice, CellLayerNotice.zoomIn);
    expect(subject.showing, isFalse);
    expect(server.paths, [mapCellsManifestPath]);
  });

  test('from the zoom on the cells load and only the points in view are shown', () async {
    final subject = await layer(stored: {_key: '1'});
    subject.onViewport(_view(14));
    expect(subject.notice, CellLayerNotice.loading);
    await pumpEventQueue();
    expect(subject.notice, isNull);
    expect(subject.visible((point) => point.location).map((point) => point.id), ['osm:node:1']);
  });

  test('a failed cell is an error until the retry succeeds', () async {
    server.answers[mapCellPath(_cellKey)] = const ApiError(message: 'Нет связи', status: 400);
    final subject = await layer(stored: {_key: '1'});
    subject.onViewport(_view(15));
    await pumpEventQueue();
    expect(subject.notice, CellLayerNotice.error);

    server.answers[mapCellPath(_cellKey)] = CellResponse(_cell, '"$_etag"');
    subject.retry();
    await pumpEventQueue();
    expect(subject.notice, isNull);
    expect(subject.showing, isTrue);
  });

  test('a server without the layer says so and shows nothing', () async {
    server.answers[mapCellsManifestPath] = _maintenance;
    final subject = await layer(stored: {_key: '1'});
    subject.onViewport(_view(15));
    await pumpEventQueue();
    expect(subject.notice, CellLayerNotice.unavailable);
    expect(subject.available, isFalse);
    expect(subject.visible((point) => point.location), isEmpty);
  });

  test('the toggle is remembered both ways and switching on loads the view', () async {
    final subject = await layer();
    subject.onViewport(_view(15));
    await subject.toggle();
    await pumpEventQueue();
    expect((await SharedPreferences.getInstance()).getString(_key), '1');
    expect(subject.showing, isTrue);

    await subject.toggle();
    expect((await SharedPreferences.getInstance()).getString(_key), '0');
    expect(subject.notice, isNull);
    expect(subject.visible((point) => point.location), isEmpty);
  });
}
