/// Groups of nearby story places on the map, the same rule as Leaflet.markercluster on the site
/// (`src/features/explore/map-clusters.ts`): at each zoom a place joins the nearest group seed within the
/// cluster radius, otherwise it forms a group with the nearest lone place within the radius, otherwise it
/// stays a single pin. Groups are shown at the average position of their places.
library;

import 'dart:math' as math;

import '../../walk_engine/distance.dart';
import 'catalog_bounds.dart';

/// Leaflet zooms are one above MapLibre's (512 px tiles): the site's radii are keyed by Leaflet zoom.
int leafletZoom(double mapLibreZoom) => (mapLibreZoom + 1).round();

/// Cluster radius in pixels by Leaflet zoom: wider on overview zooms, the original 52 px from street level.
int clusterRadius(int leafletZoom) {
  if (leafletZoom <= 11) return 120;
  if (leafletZoom == 12) return 100;
  if (leafletZoom == 13) return 90;
  if (leafletZoom == 14) return 80;
  if (leafletZoom == 15) return 64;
  return 52;
}

class ClusterInput {
  const ClusterInput(this.id, this.location);

  final String id;
  final GeoPoint location;
}

/// A single place ([ids] has one entry) or a group of places.
class MapCluster {
  const MapCluster({required this.ids, required this.center, required this.bounds});

  final List<String> ids;
  final GeoPoint center;
  final CatalogBounds bounds;

  bool get isGroup => ids.length > 1;

  /// A stable id for the map feature: the first place of the group.
  String get key => isGroup ? 'cluster:${ids.first}' : ids.first;
}

/// Clusters [points] (in insertion order) for a MapLibre [zoom].
List<MapCluster> clusterPoints(List<ClusterInput> points, double zoom) {
  final level = leafletZoom(zoom);
  final radius = clusterRadius(level).toDouble();
  // Pixels at Leaflet zoom `level` with 256 px tiles equal MapLibre pixels at `level - 1` with 512 px tiles.
  final pixelZoom = level - 1.0;
  final groups = <_Group>[];
  final groupGrid = _Grid<_Group>(radius);
  final loneGrid = _Grid<_Lone>(radius);
  for (final point in points) {
    final pixel = project(point.location, pixelZoom);
    final group = groupGrid.nearest(pixel);
    if (group != null) {
      group.members.add(point);
      continue;
    }
    final lone = loneGrid.nearest(pixel);
    if (lone != null) {
      loneGrid.remove(lone);
      lone.joined = true;
      // The seed is the place already on the map, as markercluster seeds a new group with `closest`.
      final created = _Group(lone.pixel, [lone.point, point]);
      groups.add(created);
      groupGrid.add(created, created.seed);
      continue;
    }
    final created = _Lone(point, pixel);
    loneGrid.add(created, pixel);
    groups.add(_Group.single(created));
  }
  return [
    for (final group in groups)
      if (group.lone == null || !group.lone!.joined) group.toCluster(),
  ];
}

class _Lone {
  _Lone(this.point, this.pixel);

  final ClusterInput point;
  final math.Point<double> pixel;
  bool joined = false;
}

class _Group {
  _Group(this.seed, this.members) : lone = null;
  _Group.single(_Lone this.lone)
      : seed = lone.pixel,
        members = [lone.point];

  final math.Point<double> seed;
  final List<ClusterInput> members;
  final _Lone? lone;

  MapCluster toCluster() {
    var lat = 0.0, lon = 0.0;
    var south = 90.0, north = -90.0, west = 180.0, east = -180.0;
    for (final member in members) {
      final location = member.location;
      lat += location.lat;
      lon += location.lon;
      south = math.min(south, location.lat);
      north = math.max(north, location.lat);
      west = math.min(west, location.lon);
      east = math.max(east, location.lon);
    }
    return MapCluster(
      ids: [for (final member in members) member.id],
      center: GeoPoint(lat / members.length, lon / members.length),
      bounds: CatalogBounds(west: west, south: south, east: east, north: north),
    );
  }
}

/// The DistanceGrid of markercluster: cells of the radius size, nearest object within the radius.
class _Grid<T extends Object> {
  _Grid(this.size);

  final double size;
  final _cells = <(int, int), List<(T, math.Point<double>)>>{};
  final _positions = <T, math.Point<double>>{};

  (int, int) _cell(math.Point<double> point) => ((point.x / size).floor(), (point.y / size).floor());

  void add(T object, math.Point<double> point) {
    _cells.putIfAbsent(_cell(point), () => []).add((object, point));
    _positions[object] = point;
  }

  void remove(T object) {
    final point = _positions.remove(object);
    if (point == null) return;
    _cells[_cell(point)]?.removeWhere((entry) => identical(entry.$1, object));
  }

  T? nearest(math.Point<double> point) {
    final (cx, cy) = _cell(point);
    T? best;
    var bestDistance = size * size;
    for (var x = cx - 1; x <= cx + 1; x++) {
      for (var y = cy - 1; y <= cy + 1; y++) {
        final cell = _cells[(x, y)];
        if (cell == null) continue;
        for (final (object, position) in cell) {
          final dx = position.x - point.x, dy = position.y - point.y;
          final distance = dx * dx + dy * dy;
          if (distance <= bestDistance) {
            bestDistance = distance;
            best = object;
          }
        }
      }
    }
    return best;
  }
}
