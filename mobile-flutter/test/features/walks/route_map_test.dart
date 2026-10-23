import 'package:flutter_test/flutter_test.dart';
import 'package:otgolosok/features/walks/route_map.dart';
import 'package:otgolosok/walk_engine/distance.dart';

RouteRun run(int from, int to, [bool covered = false, bool active = false]) => (from: from, to: to, covered: covered, active: active);

void main() {
  group('routeRuns matches the site', () {
    final cases = <String, (List<(int, int)>, (int, int)?, List<RouteRun>)>{
      'a plain route is one run': ([], null, [run(0, 9)]),
      'a tunnel splits the line': ([(3, 5)], null, [run(0, 3), run(3, 5, true), run(5, 9)]),
      'a tunnel at both ends': ([(0, 2), (7, 9)], null, [run(0, 2, true), run(2, 7), run(7, 9, true)]),
      'the highlighted leg is cut out of the rest': ([], (2, 6), [run(0, 2), run(2, 6, false, true), run(6, 9)]),
      'a highlighted last leg': ([], (6, 9), [run(0, 6), run(6, 9, false, true)]),
      'the whole route highlighted': ([], (0, 9), [run(0, 9, false, true)]),
      'a tunnel crossing the start of the leg': ([(1, 4)], (3, 6), [run(0, 1), run(1, 3, true), run(3, 4, true, true), run(4, 6, false, true), run(6, 9)]),
      'a tunnel crossing the end of the leg': ([(5, 8)], (3, 6), [run(0, 3), run(3, 5, false, true), run(5, 6, true, true), run(6, 8, true), run(8, 9)]),
      'a tunnel inside the leg': ([(4, 5)], (3, 6), [run(0, 3), run(3, 4, false, true), run(4, 5, true, true), run(5, 6, false, true), run(6, 9)]),
      'a range past the end is clipped': ([(8, 20)], null, [run(0, 8), run(8, 9, true)]),
    };
    for (final MapEntry(key: name, value: (tunnels, active, runs)) in cases.entries) {
      test(name, () {
        final result = routeRuns(10, tunnels, active);
        expect(result, runs);
        // Every segment exactly once, in order.
        expect(result.first.from, 0);
        expect(result.last.to, 9);
        for (var i = 1; i < result.length; i++) {
          expect(result[i].from, result[i - 1].to);
        }
      });
    }

    test('draws nothing for a route without a line', () {
      expect(routeRuns(1), isEmpty);
      expect(routeRuns(0, [(0, 1)], (0, 1)), isEmpty);
    });
  });

  test('the highlighted leg and covered stretches reach the map as separate lines', () {
    final geometry = [for (var i = 0; i < 6; i++) GeoPoint(55.75, 37.6 + i * 0.001)];
    final features = (routeLineFeatures(geometry: geometry, tunnels: const [(1, 2)], activeLeg: (2, 4))['features']! as List).cast<Map<String, Object?>>();
    final lines = [
      for (final feature in features)
        (
          (feature['properties']! as Map)['kind'],
          (feature['properties']! as Map)['active'],
          ((feature['geometry']! as Map)['coordinates']! as List).length,
        ),
    ];
    expect(lines, [('walk', false, 2), ('tunnel', false, 2), ('walk', true, 3), ('walk', false, 2)]);
  });

  test('a car walk draws its drives and its walks on foot', () {
    final features = (routeLineFeatures(segments: [
      (driving: true, geometry: const [GeoPoint(55.7, 37.6), GeoPoint(55.71, 37.61)]),
      (driving: false, geometry: const [GeoPoint(55.71, 37.61), GeoPoint(55.712, 37.612)]),
      (driving: true, geometry: const [GeoPoint(55.7, 37.6)]),
    ])['features']! as List).cast<Map<String, Object?>>();
    expect(features.map((feature) => (feature['properties']! as Map)['kind']), ['drive', 'foot']);
  });

  group('line layers', () {
    for (final dimmed in [false, true]) {
      test('an update ${dimmed ? 'with' : 'without'} a highlighted leg keeps the line visible', () {
        for (final properties in routeLineLayers(dimmed: dimmed).values) {
          // The plugin sends unset properties too, and the map resets them to a black 1 px line.
          final json = properties.toJson(skipNulls: false);
          expect(json['line-color'], isNotNull);
          expect(json['line-width'], 5);
          expect(json['line-opacity'], ['case', ['==', ['get', 'active'], true], 1, dimmed ? 0.4 : 1]);
        }
      });
    }

    test('one layer per drawn kind of walking line', () {
      expect(routeLineLayers(dimmed: false).keys, ['walk', 'tunnel']);
    });
  });
}
