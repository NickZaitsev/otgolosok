import 'package:flutter_test/flutter_test.dart';
import 'package:otgolosok/walk_engine/distance.dart';
import 'package:otgolosok/walk_engine/route_legs.dart';

// About 31 m per step east along a parallel in Moscow; north steps are 11 m.
GeoPoint at(num step, [num north = 0]) => GeoPoint(55.75 + north * 0.0001, 37.6 + step * 0.0005);
List<GeoPoint> line(int count) => [for (var step = 0; step < count; step++) at(step)];

void main() {
  group('routeLegCuts', () {
    final cases = <String, (List<GeoPoint>, List<GeoPoint>, List<int>)>{
      "a straight route cuts at each stop's vertex": (line(10), [at(3), at(7)], [3, 7]),
      'a stop at the start building cuts at vertex 0': (line(10), [at(0), at(5)], [0, 5]),
      'a stop at the finish cuts at the last vertex': (line(10), [at(4), at(9)], [4, 9]),
      'a stop 100 m off the line still cuts at the nearest vertex': (line(10), [at(6, 9)], [6]),
      'no stops, no cuts': (line(10), [], []),
    };
    for (final MapEntry(key: name, value: (geometry, stops, cuts)) in cases.entries) {
      test(name, () => expect(routeLegCuts(geometry, stops), cuts));
    }

    test('a loop walk that passes a stop twice cuts at the first pass', () {
      // Out along the street to step 6 and back on the same street, 5 m to the side.
      final geometry = [...line(7), for (final step in [5, 4, 3, 2, 1, 0]) at(step, 0.45)];
      expect(routeLegCuts(geometry, [at(3, 0.45)]), [3]);
      // The next stop is searched after the previous one, so the way back counts for it.
      expect(routeLegCuts(geometry, [at(6), at(2, 0.45)]), [6, 10]);
    });
  });

  group('legRange', () {
    final cases = <String, (List<int>, int, (int, int)?)>{
      'the first leg from the start': ([3, 7], 0, (0, 3)),
      'a leg between stops': ([3, 7], 1, (3, 7)),
      'the leg to the finish': ([3, 7], 2, (7, 9)),
      'a stop at the start has no leg into it': ([0, 5], 0, null),
      'a finish at the last stop has no final leg': ([4, 9], 2, null),
      'without stops the only leg is the whole route': ([], 0, (0, 9)),
      'a leg past the finish': ([3], 2, null),
      'a negative leg': ([3], -1, null),
    };
    for (final MapEntry(key: name, value: (cuts, leg, range)) in cases.entries) {
      test(name, () => expect(legRange(cuts, 10, leg), range));
    }

    test('a route without a line has no legs', () => expect(legRange([], 1, 0), isNull));
  });

  group('legFitPoints', () {
    final geometry = line(10);
    final cases = <String, ((int, int)?, GeoPoint?, List<GeoPoint>, bool)>{
      'a leg without a position': ((2, 4), null, [at(2), at(3), at(4)], false),
      'a leg with the walker beside it': ((2, 4), at(1, 3), [at(2), at(3), at(4), at(1, 3)], true),
      'a leg with the walker 1.4 km north': ((2, 4), at(3, 126), [at(2), at(3), at(4), at(3, 126)], true),
      'a leg with the walker 1.6 km north': ((2, 4), at(3, 144), [at(2), at(3), at(4)], false),
      'a leg without length shows its stop': (null, null, [at(7)], false),
    };
    for (final MapEntry(key: name, value: (range, user, points, withUser)) in cases.entries) {
      test(name, () {
        final fit = legFitPoints(geometry, range, at(7), user);
        expect(fit.points, points);
        expect(fit.withUser, withUser);
      });
    }
  });

  group('openingFitPoints', () {
    final route = line(9);
    final start = at(0), first = at(4), later = at(8);

    test('shows the start, the line to the first stop and the stop, not the rest of the route', () {
      final points = openingFitPoints(route, routeLegCuts(route, [first, later]), start, first);
      expect(points, [start, at(0), at(1), at(2), at(3), at(4), first]);
      expect(points, isNot(contains(later)));
    });

    test('keeps a first stop off the line, where its marker stands', () {
      final off = at(4, 9);
      final points = openingFitPoints(route, routeLegCuts(route, [off]), start, off);
      expect(points.last, off);
      expect(points, contains(at(3)));
    });

    test("keeps a start away from the line's first vertex", () {
      final away = at(-1, 5);
      expect(openingFitPoints(route, routeLegCuts(route, [first]), away, first).first, away);
    });

    for (final (name, geometry) in [('no route line', <GeoPoint>[]), ('a one-point line', [at(0)])]) {
      test('shows just the start and the first stop with $name', () {
        expect(openingFitPoints(geometry, routeLegCuts(geometry, [first]), start, first), [start, first]);
      });
    }

    test('focuses one point when the first stop is at the start', () {
      expect(openingFitPoints(route, routeLegCuts(route, [start]), start, GeoPoint(start.lat, start.lon)), [start]);
    });
  });
}
