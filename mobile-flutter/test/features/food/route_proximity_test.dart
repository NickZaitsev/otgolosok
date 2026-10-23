import 'dart:math' as math;

import 'package:flutter_test/flutter_test.dart';
import 'package:otgolosok/features/food/food_model.dart';
import 'package:otgolosok/features/food/route_proximity.dart';
import 'package:otgolosok/walk_engine/distance.dart';
import 'package:otgolosok/walk_engine/nearby_stories.dart' show russianSource;
import 'package:otgolosok/walk_engine/walk_view.dart' show WalkMode;

const origin = GeoPoint(55.75, 37.6);

/// [x] metres east and [y] metres north of [origin] on the route's flat projection.
GeoPoint at(num x, num y) => GeoPoint(origin.lat + y / 111320, origin.lon + x / (111320 * math.cos(origin.lat * math.pi / 180)));

FoodPlace place(String id, GeoPoint point) => FoodPlace(id: id, kind: FoodKind.coffee, name: 'Кофейня', lat: point.lat, lon: point.lon);

void main() {
  group('distanceToRoute', () {
    const cases = [(500, 100, 100.0, 500.0), (-50, 0, 50.0, 0.0), (1100, 0, 100.0, 1000.0), (0, 0, 0.0, 0.0), (500, 0, 0.0, 500.0)];
    for (final (x, y, distance, along) in cases) {
      test('projects ($x,$y) onto a segment including its endpoints', () {
        final result = distanceToRoute(at(x, y), [at(0, 0), at(1000, 0)]);
        expect(result.distanceM, closeTo(distance, 0.05));
        expect(result.alongM, closeTo(along, 0.05));
        expect(result.vertex, 0);
      });
    }

    test('accumulates length and ignores zero-length segments', () {
      final result = distanceToRoute(at(1000, 300), [at(0, 0), at(1000, 0), at(1000, 0), at(1000, 500)]);
      expect(result.distanceM, closeTo(0, 0.005));
      expect(result.alongM, closeTo(1300, 0.05));
      expect(result.vertex, 2);
    });

    test('handles empty and one-point geometry', () {
      expect(distanceToRoute(origin, []).distanceM, double.infinity);
      final single = distanceToRoute(at(0, 50), [origin]);
      expect(single.distanceM, closeTo(50, 0.005));
      expect((single.alongM, single.vertex), (0, 0));
      expect(placesAlongRoute([place('osm:node:1', origin)], []), isEmpty);
    });

    test('takes the earliest loop passage within 15 m of the best, at its local minimum', () {
      final geometry = [at(0, 10), at(200, 10), at(300, 100), at(200, 0), at(0, 0)], point = at(100, 0);
      expect(distanceToRoute(point, geometry).distanceM, closeTo(0, 0.005));
      final loop = distanceToRoute(point, geometry, mode: WalkMode.loop);
      expect(loop.distanceM, closeTo(10, 0.005));
      expect(loop.alongM, closeTo(100, 0.05));
      expect(placesAlongRoute([place('osm:node:1', point)], geometry, mode: WalkMode.loop).single.alongM, closeTo(100, 0.05));
      // A passage farther than the search radius is not the earliest passage.
      expect(placesAlongRoute([place('osm:node:1', point)], geometry, mode: WalkMode.loop, maxDistanceM: 5).single.distanceM, closeTo(0, 0.005));
    });

    test('selects the same local minimum on a densely sampled first passage', () {
      final geometry = [for (var i = 0; i <= 200; i++) at(i, 10), at(200, 100), at(200, 0), at(0, 0)];
      expect(distanceToRoute(at(100, 0), geometry, mode: WalkMode.loop).alongM, closeTo(100, 0.05));
    });
  });

  group('placesAlongRoute', () {
    test('filters at the radius and sorts by route position', () {
      final places = [place('osm:node:1', at(900, 149)), place('osm:node:2', at(200, 150)), place('osm:node:3', at(100, 151))];
      final result = placesAlongRoute(places, [at(0, 0), at(1000, 0)], maxDistanceM: 150.000001);
      expect(result.map((p) => p.id), ['osm:node:2', 'osm:node:1']);
      expect(result.first.distanceM, closeTo(150, 0.00005));
      expect(result.first.place, same(places[1]));
      expect(placesAlongRoute(places, [at(0, 0), at(1000, 0)], maxDistanceM: -1), isEmpty);
      expect(placesAlongRoute(places, [at(0, 0), at(1000, 0)], maxDistanceM: double.infinity), isEmpty);
    });

    test('places at the same route position are ordered by id', () {
      final places = [place('osm:node:2', at(500, 20)), place('osm:node:1', at(500, 20))];
      expect(placesAlongRoute(places, [at(0, 0), at(1000, 0)]).map((p) => p.id), ['osm:node:1', 'osm:node:2']);
    });

    test('matches the exhaustive projection for dense, diagonal and corner-crossing routes', () {
      final geometry = [for (var i = 0; i < 400; i++) at(i * 10, 100 * math.sin(i / 20))];
      final places = [for (var i = 0; i < 70; i++) place('osm:node:$i', at(i * 60, (i % 7 - 3) * 80))];
      final expected = [
        for (final p in places) (id: p.id, match: distanceToRoute(p.location, geometry)),
      ].where((p) => p.match.distanceM <= 150).toList()
        ..sort((a, b) => a.match.alongM.compareTo(b.match.alongM));
      final actual = placesAlongRoute(places, geometry);
      expect(actual.map((p) => p.id), expected.map((p) => p.id));
      for (var i = 0; i < actual.length; i++) {
        expect(actual[i].distanceM, closeTo(expected[i].match.distanceM, 1e-8));
        expect(actual[i].alongM, closeTo(expected[i].match.alongM, 1e-8));
      }
    });

    test('bounds candidate checks for 2000 places × 12000 vertices', () {
      final geometry = [for (var i = 0; i < 12000; i++) at(i * 8100 / 11999, 0)];
      final places = [for (var i = 0; i < 2000; i++) place('osm:node:$i', at(i * 4, i.isOdd ? 60 : 600))];
      final stats = ProximityStats();
      final result = placesAlongRoute(places, geometry, stats: stats);
      expect(result, hasLength(1000));
      expect(stats.bboxRejected, 1000);
      expect(stats.checkedPairs, greaterThan(0));
      expect(stats.checkedPairs, lessThan(2000 * 12000 / 10));
    });
  });

  group('cellsForRoute', () {
    final zeroBuffer = <(List<GeoPoint>, List<String>)>[
      ([], []),
      ([const GeoPoint(55.751, 37.601)], ['1115:752']),
      ([const GeoPoint(-0.025, -0.025)], ['-1:-1']),
      ([const GeoPoint(90, 180)], ['1799:3599']),
      ([const GeoPoint(-90, -180)], ['-1800:-3600']),
    ];
    for (final (geometry, keys) in zeroBuffer) {
      test('route cells with zero buffer: $geometry', () => expect(cellsForRoute(geometry, bufferM: 0), keys));
    }

    test('includes both sides of grid lines and the whole segment rather than just its vertices', () {
      const geometry = [GeoPoint(55.75, 37.6), GeoPoint(55.75, 37.75)];
      final cells = cellsForRoute(geometry);
      expect(cells, contains('1114:751'));
      for (var i = 0; i <= 100; i++) {
        expect(cells, contains(foodCellKey(55.75, 37.6 + i * 0.0015)));
      }
      expect(cells.toSet(), hasLength(cells.length));
      expect(cellsForRoute(geometry, cellSize: 0), isEmpty);
      expect(cellsForRoute(geometry, bufferM: -1), isEmpty);
    });

    test('sorts keys numerically rather than as strings', () {
      final cells = cellsForRoute([const GeoPoint(-0.025, 0.025), const GeoPoint(0.525, 0.025)], bufferM: 0);
      expect(cells, [for (var lat = -1; lat <= 10; lat++) '$lat:0']);
    });
  });

  group('stops and route points', () {
    test('formats straight-line distance and nearest stop, with ties going to the earlier stop', () {
      expect(formatRouteDistance(79.8).resolve(russianSource), '≈ 80 м от маршрута');
      expect(formatNearbyStop(150, [100, 200])?.resolve(russianSource), 'рядом с остановкой 1');
      expect(formatNearbyStop(180, [100, 200])?.resolve(russianSource), 'рядом с остановкой 2');
      expect(formatNearbyStop(0, []), isNull);
      expect(nearestStop(0, []), isNull);
    });

    test('vertex distances accumulate segment lengths', () {
      expect(routeVertexDistances([]), isEmpty);
      final distances = routeVertexDistances([at(0, 0), at(300, 0), at(300, 400)]);
      expect(distances.first, 0);
      expect(distances[1], closeTo(300, 0.05));
      expect(distances[2], closeTo(700, 0.05));
    });

    test('the camera gets the projection onto the segment rather than the nearest vertex', () {
      const geometry = [GeoPoint(55.75, 37.6), GeoPoint(55.752, 37.6)];
      final match = distanceToRoute(const GeoPoint(55.751, 37.601), geometry);
      final point = matchedRoutePoint(match, geometry)!;
      expect(point.lat, closeTo(55.751, 1e-12));
      expect(point.lon, 37.6);
      expect(matchedRoutePoint(match, []), isNull);
      expect(matchedRoutePoint(match, geometry.sublist(0, 1)), geometry.first);
      expect(matchedRoutePoint(const RouteMatch(distanceM: 0, alongM: 0, vertex: 5), geometry), isNull);
    });
  });
}
