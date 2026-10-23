import 'dart:async';
import 'dart:math' as math;

import 'package:dio/dio.dart' show CancelToken;
import 'package:flutter_test/flutter_test.dart';
import 'package:otgolosok/core/api/api_error.dart';
import 'package:otgolosok/features/explore/catalog_bounds.dart';
import 'package:otgolosok/features/explore/walk_overview.dart';
import 'package:otgolosok/features/walks/top_model.dart';

import 'walk_fixtures.dart';

/// A view of central Moscow.
const _view = CatalogBounds(west: 37.58, south: 55.74, east: 37.62, north: 55.76);

typedef _Request = ({CatalogBounds area, CancelToken cancel, Completer<({List<MapWalk> walks, bool complete})> answer});

void main() {
  group('validateMapWalks', () {
    test('reads lines, bounds and the completeness flag', () {
      final shared = walkJson({'kind': 'shared', 'id': '11111111-1111-4111-8111-111111111111'});
      final result = validateMapWalks({'walks': [walkJson({}), shared], 'complete': false});
      expect(result.complete, isFalse);
      final walk = result.walks.first;
      expect(walk.key, 'catalog:arbat');
      expect(walk.kind, TopWalkKind.catalog);
      expect(walk.line, [(55.75, 37.59), (55.752, 37.6)]);
      expect(walk.bounds, const CatalogBounds(west: 37.59, south: 55.75, east: 37.6, north: 55.752));
      expect(walk.location, '/walk?catalog=arbat');
      expect(result.walks.last.location, '/walk?share=11111111-1111-4111-8111-111111111111');
    });

    test('an older server without the flag is complete', () {
      expect(validateMapWalks({'walks': <Object?>[]}).complete, isTrue);
    });

    final invalid = <String, Object?>{
      'walks not a list': {'walks': <String, Object?>{}},
      'flag not boolean': {'walks': <Object?>[], 'complete': 'no'},
      'unknown kind': {'walks': [walkJson({'kind': 'own'})]},
      'shared walk with a slug': {'walks': [walkJson({'kind': 'shared'})]},
      'line of one point': {
        'walks': [
          walkJson({
            'line': [
              [55.75, 37.59],
            ],
          }),
        ],
      },
      'latitude out of range': {
        'walks': [
          walkJson({
            'line': [
              [95, 37.59],
              [55.75, 37.6],
            ],
          }),
        ],
      },
      'point of three numbers': {
        'walks': [
          walkJson({
            'line': [
              [55.75, 37.59, 1],
              [55.75, 37.6],
            ],
          }),
        ],
      },
    };
    invalid.forEach((name, value) => test(name, () => expect(() => validateMapWalks(value), throwsFormatException)));
  });

  test('a walk keeps its colour, and colours spread over the palette', () {
    final colours = {for (var index = 0; index < 60; index++) walkColorIndex('catalog:walk-$index')};
    expect(colours, {1, 2, 3, 4, 5, 6});
    expect(walkColorIndex('catalog:arbat'), walkColorIndex('catalog:arbat'));
  });

  group('overviewArea', () {
    test('doubles the view, snapped outward to 0.01°', () {
      final area = overviewArea(_view)!;
      expect(area.west, lessThan(_view.west));
      expect(area.east, greaterThan(_view.east));
      expect(area.south, lessThan(_view.south));
      expect(area.north, greaterThan(_view.north));
      // √2 on each side of the required bounds (which already carry √2): about twice the width.
      expect(area.east - area.west, closeTo((_view.east - _view.west) * math.sqrt2, 0.02));
      for (final edge in [area.west, area.south, area.east, area.north]) {
        expect((edge * 100).roundToDouble(), closeTo(edge * 100, 1e-9));
      }
      expect(overviewQuery(area), {
        'west': area.west.toStringAsFixed(2),
        'south': area.south.toStringAsFixed(2),
        'east': area.east.toStringAsFixed(2),
        'north': area.north.toStringAsFixed(2),
      });
    });

    test('is clipped to the city region', () {
      final area = overviewArea(const CatalogBounds(west: 36, south: 55, east: 39, north: 56.5))!;
      expect(area, const CatalogBounds(west: 36.75, south: 55.05, east: 38.25, north: 56.05));
    });

    test('is null outside every city', () {
      expect(overviewArea(const CatalogBounds(west: 10, south: 10, east: 10.1, north: 10.1)), isNull);
    });
  });

  group('walksAtPoint', () {
    final lines = [
      (key: 'far', pixels: const [math.Point(0.0, 20.0), math.Point(100.0, 20.0)]),
      (key: 'near', pixels: const [math.Point(0.0, 5.0), math.Point(100.0, 5.0)]),
      (key: 'dot', pixels: const [math.Point(50.0, 0.0), math.Point(50.0, 0.0)]),
      (key: 'off', pixels: const [math.Point(0.0, 60.0), math.Point(100.0, 60.0)]),
    ];

    test('offers every line within reach, nearest first', () {
      expect(walksAtPoint(const math.Point(50, 0), lines), ['dot', 'near']);
      expect(walksAtPoint(const math.Point(50, 12), lines), ['near', 'far', 'dot']);
    });

    test('the reach is measured to the segment, not past its ends', () {
      expect(walksAtPoint(const math.Point(130, 5), lines), isEmpty);
      expect(walksAtPoint(const math.Point(110, 5), lines), ['near']);
    });
  });

  group('WalkOverviewStore', () {
    late List<_Request> requests;
    late DateTime now;
    late WalkOverviewStore store;

    setUp(() {
      requests = [];
      now = DateTime(2026, 10, 23, 12);
      store = WalkOverviewStore(
        fetch: (area, cancel) {
          final answer = Completer<({List<MapWalk> walks, bool complete})>();
          requests.add((area: area, cancel: cancel, answer: answer));
          return answer.future;
        },
        now: () => now,
      );
      addTearDown(store.dispose);
    });

    Future<void> answer(List<MapWalk> walks, {bool complete = true}) async {
      requests.last.answer.complete((walks: walks, complete: complete));
      await pumpEventQueue();
    }

    test('a view loads its doubled area once while it is fresh', () async {
      unawaited(store.ensure(_view));
      expect(store.snapshot.status, WalkOverviewStatus.loading);
      expect(requests.single.area, overviewArea(_view));
      await answer([mapWalk('arbat')]);
      expect(store.snapshot.status, WalkOverviewStatus.ready);
      expect(store.snapshot.walks.map((walk) => walk.key), ['catalog:arbat']);

      // A smaller view inside the loaded area asks nothing.
      await store.ensure(const CatalogBounds(west: 37.59, south: 55.745, east: 37.61, north: 55.755));
      expect(requests, hasLength(1));

      now = now.add(walkOverviewTtl);
      unawaited(store.ensure(_view));
      expect(requests, hasLength(2));
    });

    test('a complete answer drops walks that left the area, a cut one keeps them', () async {
      unawaited(store.ensure(_view));
      await answer([mapWalk('arbat'), mapWalk('far', south: 55.9, west: 37.9, north: 55.91, east: 37.91)]);

      now = now.add(walkOverviewTtl);
      unawaited(store.ensure(_view));
      await answer([mapWalk('other')], complete: false);
      expect(store.snapshot.walks.map((walk) => walk.id), {'arbat', 'far', 'other'});

      unawaited(store.retry());
      await answer([mapWalk('other')]);
      // «far» lies outside the requested area: not proven gone.
      expect(store.snapshot.walks.map((walk) => walk.id), {'far', 'other'});
    });

    test('a new view cancels the request for the view it left', () async {
      unawaited(store.ensure(_view));
      final first = requests.single;
      unawaited(store.ensure(const CatalogBounds(west: 37.9, south: 55.9, east: 37.94, north: 55.92)));
      expect(first.cancel.isCancelled, isTrue);
      first.answer.complete((walks: [mapWalk('late')], complete: true));
      await answer([mapWalk('fresh')]);
      expect(store.snapshot.walks.map((walk) => walk.id), ['fresh']);
    });

    test('a failure can be retried for the same area', () async {
      unawaited(store.ensure(_view));
      requests.last.answer.completeError(const ApiError(message: 'Сбой', status: 500));
      await pumpEventQueue();
      expect(store.snapshot.status, WalkOverviewStatus.error);
      expect(store.snapshot.unavailable, isFalse);

      unawaited(store.retry());
      expect(requests.last.area, requests.first.area);
      await answer([mapWalk('arbat')]);
      expect(store.snapshot.status, WalkOverviewStatus.ready);
    });

    test('a server without the walk store switches the layer off', () async {
      unawaited(store.ensure(_view));
      requests.last.answer.completeError(const ApiError(message: 'Нет', status: 503, code: 'UNAVAILABLE'));
      await pumpEventQueue();
      expect(store.snapshot.unavailable, isTrue);

      now = now.add(walkOverviewTtl);
      await store.ensure(const CatalogBounds(west: 37.9, south: 55.9, east: 37.94, north: 55.92));
      expect(requests, hasLength(1));
    });

    test('maintenance is an ordinary, retryable error', () async {
      unawaited(store.ensure(_view));
      requests.last.answer.completeError(const ApiError(message: 'Обновление', status: 503, code: 'SERVICE_MAINTENANCE'));
      await pumpEventQueue();
      expect(store.snapshot.status, WalkOverviewStatus.error);
      expect(store.snapshot.unavailable, isFalse);
    });

    test('switching the layer off stops the request', () async {
      unawaited(store.ensure(_view));
      store.cancel();
      expect(requests.single.cancel.isCancelled, isTrue);
      expect(store.snapshot.status, WalkOverviewStatus.idle);
      await answer([mapWalk('late')]);
      expect(store.snapshot.walks, isEmpty);
    });
  });
}
