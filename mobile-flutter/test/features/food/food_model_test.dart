import 'package:flutter_test/flutter_test.dart';
import 'package:otgolosok/features/explore/catalog_bounds.dart';
import 'package:otgolosok/features/food/food_model.dart';

Map<String, Object?> _place([Map<String, Object?> change = const {}]) => {
      'id': 'osm:node:1',
      'kind': 'fast_food',
      'name': 'Пекарня',
      'lat': 55.7525,
      'lon': 37.6025,
      'address': 'Москва, Арбат, 1',
      'openingHours': 'Mo-Su 08:00-22:00',
      'cuisine': 'pizza',
      'website': 'https://example.ru',
      'phone': '+7 495 000-00-00',
      ...change,
    };

Map<String, Object?> _cell(List<Object?> places) => {'lat': 1115, 'lon': 752, 'places': places};

void main() {
  test('cell keys follow the server grid, Moscow centre included', () {
    expect(foodCellKey(55.7558, 37.6176), '1115:752');
    expect(foodCellKey(-0.01, -0.01), '-1:-1');
    expect(foodCellKey(90, 180), '1799:3599');
  });

  test('a valid cell is read with every field', () {
    final place = parseFoodCell(_cell([_place()]), '1115:752').single;
    expect(place.kind, FoodKind.fastFood);
    expect(place.website, 'https://example.ru');
    expect(place.location.lat, 55.7525);
  });

  group('a damaged cell is refused:', () {
    final cases = <String, Object?>{
      'another key': {'lat': 1115, 'lon': 753, 'places': <Object?>[]},
      'an unknown kind': _cell([_place({'kind': 'pub'})]),
      'a place outside its cell': _cell([_place({'lat': 55.9})]),
      'a duplicate id': _cell([_place(), _place()]),
      'a blank name': _cell([_place({'name': '  '})]),
      'a non-web site': _cell([_place({'website': 'javascript:alert(1)'})]),
      'a numeric phone': _cell([_place({'phone': 74950000000})]),
      'a bad id': _cell([_place({'id': 'node:1'})]),
    };
    for (final MapEntry(key: name, value: json) in cases.entries) {
      test(name, () => expect(() => parseFoodCell(json, '1115:752'), throwsFormatException));
    }
  });

  group('a damaged manifest is refused:', () {
    Map<String, Object?> manifest([Map<String, Object?> change = const {}, Map<String, Object?> cell = const {}]) => {
          'version': 1,
          'cellSize': 0.05,
          'sourceEditedAt': '2026-10-01T00:00:00Z',
          'attribution': '© OpenStreetMap contributors',
          'cells': [
            {'lat': 1115, 'lon': 752, 'count': 3, 'etag': 'a' * 32, ...cell},
          ],
          ...change,
        };

    test('a valid one is read', () => expect(parseFoodManifest(manifest()).cells['1115:752']!.count, 3));

    final cases = <String, Map<String, Object?>>{
      'another version': manifest({'version': 2}),
      'another cell size': manifest({'cellSize': 0.1}),
      'no attribution': manifest({'attribution': ' '}),
      'a bad date': manifest({'sourceEditedAt': 'вчера'}),
      'a fractional key': manifest(const {}, {'lat': 1115.5}),
      'a key out of the grid': manifest(const {}, {'lon': 3600}),
      'a short etag': manifest(const {}, {'etag': 'abc'}),
    };
    for (final MapEntry(key: name, value: json) in cases.entries) {
      test(name, () => expect(() => parseFoodManifest(json), throwsFormatException));
    }
  });

  test('only cells under the area are asked for', () {
    const area = CatalogBounds(west: 37.60, south: 55.75, east: 37.62, north: 55.76);
    expect(foodCellsFor(['1115:752', '1115:760', '1100:752'], area), ['1115:752']);
  });
}
