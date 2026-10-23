import 'dart:math' as math;

import 'package:flutter_test/flutter_test.dart';
import 'package:otgolosok/features/explore/catalog_bounds.dart';
import 'package:otgolosok/features/explore/map_clusters.dart';
import 'package:otgolosok/walk_engine/distance.dart';

const _base = GeoPoint(55.75, 37.6);

/// A point [dx], [dy] logical pixels from [_base] at MapLibre [zoom].
GeoPoint _offset(double dx, double dy, {double zoom = 15}) {
  final origin = project(_base, zoom);
  return unproject(math.Point(origin.x + dx, origin.y + dy), zoom);
}

void main() {
  group('cluster radius by Leaflet zoom', () {
    const cases = {10: 120, 11: 120, 12: 100, 13: 90, 14: 80, 15: 64, 16: 52, 19: 52};
    cases.forEach((zoom, radius) => test('z$zoom', () => expect(clusterRadius(zoom), radius)));

    test('Leaflet zoom is one above MapLibre zoom', () {
      expect(leafletZoom(14), 15);
      expect(leafletZoom(14.4), 15);
      expect(leafletZoom(14.6), 16);
    });
  });

  group('clusterPoints', () {
    test('places within the radius form a group at their average position', () {
      final clusters = clusterPoints([ClusterInput('a', _base), ClusterInput('b', _offset(40, 0))], 15);
      final group = clusters.single;
      expect(group.ids, ['a', 'b']);
      expect(group.isGroup, isTrue);
      expect(group.key, 'cluster:a');
      expect(group.center.lat, closeTo(_base.lat, 1e-9));
      expect(group.center.lon, closeTo((_base.lon + _offset(40, 0).lon) / 2, 1e-9));
      expect(group.bounds.west, _base.lon);
      expect(group.bounds.east, _offset(40, 0).lon);
    });

    test('places beyond the radius stay single pins', () {
      final clusters = clusterPoints([ClusterInput('a', _base), ClusterInput('b', _offset(60, 0))], 15);
      expect(clusters.map((cluster) => cluster.key), ['a', 'b']);
      expect(clusters.any((cluster) => cluster.isGroup), isFalse);
    });

    test('a wider radius on overview zooms merges them', () {
      final clusters = clusterPoints([ClusterInput('a', _base), ClusterInput('b', _offset(60, 0))], 10);
      expect(clusters.single.ids, ['a', 'b']);
    });

    test('a group is seeded by the place already on the map', () {
      // c is 50 px from a (the seed) but 90 px from b: it still joins.
      final clusters = clusterPoints(
        [ClusterInput('a', _base), ClusterInput('b', _offset(40, 0)), ClusterInput('c', _offset(-50, 0))],
        15,
      );
      expect(clusters.single.ids, ['a', 'b', 'c']);
    });

    test('a place joins the nearest group rather than a lone place', () {
      // Group {a, b} sits at x≈0; d at x=300 is lone; e at x=45 is near the group seed only.
      final clusters = clusterPoints(
        [ClusterInput('a', _base), ClusterInput('b', _offset(30, 0)), ClusterInput('d', _offset(300, 0)), ClusterInput('e', _offset(45, 0))],
        15,
      );
      expect(clusters.map((cluster) => cluster.ids), [
        ['a', 'b', 'e'],
        ['d'],
      ]);
    });

    test('places at the same position are grouped at any zoom', () {
      final clusters = clusterPoints([ClusterInput('a', _base), ClusterInput('b', _base)], 17);
      expect(clusters.single.ids, ['a', 'b']);
      expect(clusters.single.bounds.west, clusters.single.bounds.east);
    });

    test('no places, no clusters', () => expect(clusterPoints(const [], 12), isEmpty));
  });
}
