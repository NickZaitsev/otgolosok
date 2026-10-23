import 'package:flutter_test/flutter_test.dart';
import 'package:otgolosok/features/food/food_model.dart';
import 'package:otgolosok/features/food/food_walk_model.dart';
import 'package:otgolosok/features/food/route_proximity.dart';
import 'package:otgolosok/walk_engine/distance.dart';
import 'package:otgolosok/walk_engine/walk_view.dart' show WalkMode;

RouteFoodPlace place(String id, double alongM) => RouteFoodPlace(
      FoodPlace(id: id, kind: FoodKind.coffee, name: id, lat: 55.75, lon: 37.6),
      RouteMatch(distanceM: 30, alongM: alongM, vertex: 0),
    );
List<String> ids(List<RouteFoodPlace> places) => [for (final place in places) place.id];

void main() {
  group('places along the walk', () {
    const splits = [
      (0.0, ['a', 'b', 'c'], <String>[]),
      (100.0, ['b', 'c'], ['a']),
      (200.0, ['c'], ['a', 'b']),
      (201.0, <String>[], ['a', 'b', 'c']),
    ];
    for (final (from, ahead, behind) in splits) {
      test('the section boundary $from includes its start', () {
        final input = [place('c', 200), place('a', 0), place('b', 100)];
        final result = splitRouteFood(input, from);
        expect(ids(result.ahead), ahead);
        expect(ids(result.behind), behind);
        expect(ids(input), ['c', 'a', 'b']);
      });
    }

    const groupings = [
      (<double>[], [null, null, null]),
      ([0.0, 200.0], [0, 0, 1]),
      ([200.0, 0.0], [1, 0, 0]),
      ([100.0], [0, 0, 0]),
    ];
    for (final (stops, expected) in groupings) {
      test('groups by the nearest stop $stops, a tie goes to the first', () {
        final result = groupRouteFood([place('c', 200), place('b', 100), place('a', 0)], stops);
        expect([for (final group in result) for (final _ in group.places) group.stop], expected);
        expect([for (final group in result) ...ids(group.places)], ['a', 'b', 'c']);
      });
    }

    test('consecutive places at the same stop share one group', () {
      final result = groupRouteFood([place('a', 0), place('b', 10), place('c', 400)], [0, 400]);
      expect([for (final group in result) group.stop], [0, 1]);
      expect([for (final group in result) ids(group.places)], [['a', 'b'], ['c']]);
    });

    test('empty data makes no empty groups', () {
      expect(groupRouteFood([], [0]), isEmpty);
      final split = splitRouteFood([], 0);
      expect(split.ahead, isEmpty);
      expect(split.behind, isEmpty);
    });

    test('the vertex length on a loop does not become the earliest passage', () {
      const a = GeoPoint(55.75, 37.6), b = GeoPoint(55.751, 37.6), geometry = [a, b, a];
      final distances = routeVertexDistances(geometry);
      expect(distances[2], closeTo(222.64, 0.005));
      expect(distanceToRoute(a, geometry, mode: WalkMode.loop).alongM, 0);
      expect(ids(splitRouteFood([place('first', 0), place('return', 200)], distances[1]).ahead), ['return']);
    });
  });

  group('foodPhone', () {
    const cases = [
      (null, null),
      ('+7 (999) 123-45-67', 'tel:+79991234567'),
      ('123.45', 'tel:12345'),
      ('123 ext 45', null),
      ('++123', null),
      ('12+34', null),
      ('javascript:123', null),
      ('', null),
      ('+', null),
      ('+7 495 111-22-33; +7 495 444-55-66', 'tel:+74951112233'),
      ('+7 495 111-22-33, доб. 5', 'tel:+74951112233'),
    ];
    for (final (input, expected) in cases) {
      test('safe phone $input', () => expect(foodPhone(input)?.toString(), expected));
    }
  });

  group('foodWebsite', () {
    const cases = [
      (null, null),
      ('', null),
      ('https://example.com', 'https://example.com'),
      ('http://example.com/menu', 'http://example.com/menu'),
      (' HTTPS://example.com/menu ', 'https://example.com/menu'),
      ('javascript:alert(1)', null),
      ('//example.com', null),
      ('tel:+123', null),
      ('https://', null),
      ('ftp://example.com', null),
      ('not a url', null),
    ];
    for (final (input, expected) in cases) {
      test('safe website $input', () => expect(foodWebsite(input)?.toString(), expected));
    }
  });
}
