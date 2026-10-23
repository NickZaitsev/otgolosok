import 'package:flutter_test/flutter_test.dart';
import 'package:otgolosok/features/explore/catalog_bounds.dart';
import 'package:otgolosok/features/food/food_model.dart';
import 'package:otgolosok/features/food/food_viewport.dart';
import 'package:otgolosok/walk_engine/distance.dart';

const bounds = CatalogBounds(south: 55.75, north: 55.76, west: 37.6, east: 37.62);
const center = GeoPoint(55.755, 37.61);

FoodPlace place([String id = 'osm:node:1', double lat = 55.751, double lon = 37.601]) => FoodPlace(id: id, kind: FoodKind.coffee, name: 'Кофейня', lat: lat, lon: lon);
List<String> visible(List<FoodPlace> places, [double zoom = 14]) => [for (final p in visibleFoodPlaces(places, bounds: bounds, center: center, zoom: zoom)) p.id];

void main() {
  for (final zoom in [13.0, 13.99, 14.0, 14.01, 18.0]) {
    test('zoom threshold $zoom', () => expect(visible([place()], zoom), hasLength(zoom < foodMinZoom ? 0 : 1)));
  }

  const edges = [
    (55.75, 37.6, true), (55.76, 37.62, true), (55.755, 37.61, true), //
    (55.74999, 37.61, false), (55.76001, 37.61, false), (55.755, 37.59999, false), (55.755, 37.62001, false),
    (55.79, 37.61, false),
  ];
  for (final (lat, lon, included) in edges) {
    test('area edge $lat, $lon', () => expect(visible([place('osm:node:1', lat, lon)]), hasLength(included ? 1 : 0)));
  }

  for (final count in [0, 1, 299, 300, 301, 1600]) {
    test('the nearest $foodMarkerLimit of $count without mutating the input', () {
      final places = [for (var i = 0; i < count; i++) place('osm:node:${i + 1}', center.lat + i * .000001, center.lon)].reversed.toList();
      final original = [...places];
      expect(visible(places), [for (var i = 0; i < (count < foodMarkerLimit ? count : foodMarkerLimit); i++) 'osm:node:${i + 1}']);
      expect(places, original);
    });
  }

  test('scales longitude and breaks equal distances deterministically', () {
    final places = [place('osm:node:3', 55.756, 37.61), place('osm:node:2', 55.755, 37.611), place('osm:node:1', 55.755, 37.611)];
    expect(visible(places), ['osm:node:1', 'osm:node:2', 'osm:node:3']);
  });
}
