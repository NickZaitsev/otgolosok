import 'dart:math' as math;

import 'package:flutter_test/flutter_test.dart';
import 'package:otgolosok/features/explore/catalog_bounds.dart';
import 'package:otgolosok/features/explore/map_clusters.dart';
import 'package:otgolosok/features/explore/map_layers.dart';
import 'package:otgolosok/walk_engine/distance.dart';

import 'walk_fixtures.dart';

const _base = GeoPoint(55.75, 37.6);
const _zoom = 15.0;

GeoPoint _offset(double dx, double dy) {
  final origin = project(_base, _zoom);
  return unproject(math.Point(origin.x + dx, origin.y + dy), _zoom);
}

MapCluster _single(String id, GeoPoint at) =>
    MapCluster(ids: [id], center: at, bounds: CatalogBounds(west: at.lon, south: at.lat, east: at.lon, north: at.lat));

void main() {
  group('clusterAt', () {
    final clusters = [_single('a', _base), _single('b', _offset(30, 0))];

    test('picks the nearest pin within a finger', () {
      expect(clusterAt(_offset(10, 0), clusters, _zoom)?.key, 'a');
      expect(clusterAt(_offset(20, 0), clusters, _zoom)?.key, 'b');
    });

    test('a tap beyond the touch target hits nothing', () {
      expect(clusterAt(_offset(0, 30), clusters, _zoom), isNull);
    });
  });

  group('walksAt', () {
    // A horizontal line from the base to 200 px east.
    final walk = mapWalk('arbat', south: _base.lat, west: _base.lon, north: _offset(200, 0).lat, east: _offset(200, 0).lon);

    test('a tap near the line selects it', () {
      expect(walksAt(_offset(100, 10), [walk], _zoom), ['catalog:arbat']);
      expect(walksAt(_offset(100, 30), [walk], _zoom), isEmpty);
    });

    test('walks outside the view are not considered', () {
      const elsewhere = CatalogBounds(west: 30, south: 59, east: 30.5, north: 59.5);
      expect(walksAt(_offset(100, 0), [walk], _zoom, view: elsewhere), isEmpty);
    });
  });

  group('GeoJSON', () {
    test('pins mark the selected place; groups never are', () {
      final group = MapCluster(ids: const ['a', 'b'], center: _base, bounds: const CatalogBounds(west: 37.6, south: 55.75, east: 37.6, north: 55.75));
      final json = placesGeoJson([_single('a', _base), group], selectedId: 'a');
      final features = (json['features']! as List<Object?>).cast<Map<String, Object?>>();
      expect(features.map((feature) => feature['id']), ['a', 'cluster:a']);
      expect(features.map((feature) => feature['properties']), [
        {'kind': 'pin', 'count': 1, 'selected': true},
        {'kind': 'cluster', 'count': 2, 'selected': false},
      ]);
      expect((features.first['geometry']! as Map<String, Object?>)['coordinates'], [37.6, 55.75]);
    });

    test('lines are drawn as lon/lat with their colour and selection', () {
      final walk = mapWalk('arbat');
      final feature = ((walksGeoJson([walk], selected: {'catalog:arbat'})['features']! as List<Object?>).single! as Map<String, Object?>);
      expect((feature['geometry']! as Map<String, Object?>)['coordinates'], [
        [37.6, 55.75],
        [37.601, 55.751],
      ]);
      expect(feature['properties'], {'key': 'catalog:arbat', 'color': isA<int>(), 'selected': true});
    });

    test('the position shows its accuracy circle only when the accuracy is known', () {
      List<Object?> kinds(Map<String, Object?> json) =>
          [for (final feature in (json['features']! as List<Object?>).cast<Map<String, Object?>>()) (feature['properties']! as Map)['kind']];
      expect(kinds(userGeoJson(_base, 40)), ['accuracy', 'position']);
      expect(kinds(userGeoJson(_base, double.infinity)), ['position']);
      expect(kinds(userGeoJson(null, 40)), isEmpty);
    });

    test('the accuracy ring is closed and lies at the radius', () {
      final ring = accuracyRing(_base, 100, steps: 12);
      expect(ring, hasLength(13));
      expect(ring.first, ring.last);
      for (final [lon, lat] in ring) {
        expect(distanceMeters(_base, GeoPoint(lat, lon)), closeTo(100, 0.5));
      }
    });
  });

  test('boundsOf encloses every point', () {
    expect(boundsOf(const []), isNull);
    expect(
      boundsOf(const [GeoPoint(55.7, 37.7), GeoPoint(55.8, 37.5), GeoPoint(55.75, 37.6)]),
      const CatalogBounds(west: 37.5, south: 55.7, east: 37.7, north: 55.8),
    );
  });
}
