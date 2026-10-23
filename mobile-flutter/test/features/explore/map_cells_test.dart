import 'package:flutter_test/flutter_test.dart';
import 'package:otgolosok/features/explore/catalog_bounds.dart';
import 'package:otgolosok/features/explore/cell_store.dart';
import 'package:otgolosok/features/explore/map_cells.dart';
import 'package:otgolosok/walk_engine/distance.dart';

final _etagA = 'a' * 32;

Map<String, Object?> _cell(Map<String, Object?> overrides) => {'lat': 55, 'lon': 37, 'count': 3, 'etag': _etagA, ...overrides};

Map<String, Object?> _manifest(List<Object?> cells, [Map<String, Object?> overrides = const {}]) =>
    {'version': 1, 'cellSize': 1, 'cells': cells, ...overrides};

Map<String, Object?> _point(Map<String, Object?> overrides) => {
      'id': 'osm:way:1',
      'lat': 55.75,
      'lon': 37.59,
      'title': 'Дом с башней',
      'address': 'Москва, Арбат, 10',
      'durationSec': 61.5,
      'facts': 4,
      'sources': 2,
      ...overrides,
    };

CellSnapshot<Object?> _snapshot({
  Set<String>? manifestKeys,
  Set<String> loadedKeys = const {},
  Map<String, CellStatus> cellStatus = const {},
  ManifestStatus manifestStatus = ManifestStatus.ready,
}) =>
    CellSnapshot<Object?>(
      points: const [],
      manifestKeys: manifestKeys,
      loadedKeys: loadedKeys,
      cellStatus: cellStatus,
      manifestStatus: manifestStatus,
      maintenance: false,
    );

void main() {
  group('parseMapManifest', () {
    test('keys cells by their south-west corner', () {
      final cells = parseMapManifest(_manifest([_cell({}), _cell({'lat': -1, 'lon': -180, 'count': 0})]));
      expect(cells.keys, ['55:37', '-1:-180']);
      expect(cells['55:37']!.count, 3);
      expect(cells['55:37']!.etag, _etagA);
    });

    final invalid = <String, Object?>{
      'another version': _manifest([], {'version': 2}),
      'another cell size': _manifest([], {'cellSize': 2}),
      'cells not a list': _manifest([], {'cells': {}}),
      'latitude 90': _manifest([_cell({'lat': 90})]),
      'longitude 180': _manifest([_cell({'lon': 180})]),
      'fractional latitude': _manifest([_cell({'lat': 55.5})]),
      'negative count': _manifest([_cell({'count': -1})]),
      'short etag': _manifest([_cell({'etag': 'abc'})]),
      'upper-case etag': _manifest([_cell({'etag': 'A' * 32})]),
      'not an object': null,
    };
    invalid.forEach((name, value) => test(name, () => expect(() => parseMapManifest(value), throwsFormatException)));
  });

  group('parseMapCell', () {
    test('reads the slim points', () {
      final points = parseMapCell({'lat': 55, 'lon': 37, 'points': [_point({}), _point({'id': 'osm:node:2', 'durationSec': null, 'photo': true})]}, '55:37');
      expect(points.first.location, const GeoPoint(55.75, 37.59));
      expect(points.first.durationSec, 61.5);
      expect(points.first.photo, isFalse);
      expect(points.last.durationSec, isNull);
      expect(points.last.photo, isTrue);
    });

    test('a cell answering for another key is refused', () {
      expect(() => parseMapCell({'lat': 55, 'lon': 38, 'points': <Object?>[]}, '55:37'), throwsFormatException);
    });

    final invalid = <String, Map<String, Object?>>{
      'empty id': _point({'id': ''}),
      'zero duration': _point({'durationSec': 0}),
      'photo false': _point({'photo': false}),
      'photo null': _point({'photo': null}),
      'fractional facts': _point({'facts': 1.5}),
      'negative sources': _point({'sources': -1}),
      'title missing': _point({'title': null}),
    };
    invalid.forEach((name, point) => test(name, () {
          expect(() => parseMapCell({'lat': 55, 'lon': 37, 'points': [point]}, '55:37'), throwsFormatException);
        }));
  });

  group('cellsFor', () {
    const keys = ['55:37', '55:38', '56:37', '54:37', '55:36'];

    test('picks the cells under the rectangle', () {
      expect(cellsFor(keys, const CatalogBounds(west: 37.5, south: 55.7, east: 37.7, north: 55.8)), ['55:37']);
    });

    test('touching edges count', () {
      expect(cellsFor(keys, const CatalogBounds(west: 37.5, south: 55.7, east: 38, north: 56)), ['55:37', '55:38', '56:37']);
    });
  });

  test('cell paths use the server layout', () {
    expect(mapCellPath('55:37'), '/api/content/map-cells/55/37');
    expect(mapCellPath('-1:-74'), '/api/content/map-cells/-1/-74');
  });

  group('bareEtag', () {
    const cases = {'"abc"': 'abc', 'W/"abc"': 'abc', 'abc': 'abc', ' "abc" ': 'abc', '""': null, '': null};
    cases.forEach((input, expected) => test(input.isEmpty ? '(empty)' : input, () => expect(bareEtag(input), expected)));
    test('null', () => expect(bareEtag(null), isNull));
  });

  group('areaStatus', () {
    const area = CatalogBounds(west: 37.9, south: 55.7, east: 38.1, north: 55.8);

    test('without a manifest it follows the manifest request', () {
      expect(areaStatus(_snapshot(manifestStatus: ManifestStatus.loading), area), CellStatus.loading);
      expect(areaStatus(_snapshot(manifestStatus: ManifestStatus.error), area), CellStatus.error);
    });

    test('an area across a cell line is ready only with both cells', () {
      const keys = {'55:37', '55:38'};
      expect(areaStatus(_snapshot(manifestKeys: keys, loadedKeys: {'55:37'}), area), CellStatus.loading);
      expect(areaStatus(_snapshot(manifestKeys: keys, loadedKeys: keys), area), CellStatus.ready);
    });

    test('a cell without any copy that failed makes the area fail', () {
      expect(
        areaStatus(_snapshot(manifestKeys: {'55:37', '55:38'}, loadedKeys: {'55:37'}, cellStatus: {'55:38': CellStatus.error}), area),
        CellStatus.error,
      );
    });

    test('an area with no catalog cells is ready', () {
      expect(areaStatus(_snapshot(manifestKeys: {'59:30'}), area), CellStatus.ready);
    });
  });
}
