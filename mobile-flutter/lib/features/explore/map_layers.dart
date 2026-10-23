/// What the explore map draws over the base style, as GeoJSON, and which drawn object a tap hits.
///
/// Hit testing is done here rather than by MapLibre feature taps: a 24 px pin and a 4 px line are too small
/// for a finger, so taps get the site's tolerances (a 48 dp pin target, 16 px around walk lines).
library;

import 'dart:math' as math;

import 'package:flutter/foundation.dart';

import '../../walk_engine/distance.dart';
import 'catalog_bounds.dart';
import 'map_clusters.dart';
import 'walk_overview.dart';

const placesSourceId = 'otg-places';
const walksSourceId = 'otg-walks';
const userSourceId = 'otg-user';
const markersSourceId = 'otg-markers';

/// Half of the 48 dp touch target around a pin or a group.
const double pinHitTolerancePx = 24;

Map<String, Object?> _collection(List<Map<String, Object?>> features) => {'type': 'FeatureCollection', 'features': features};

Map<String, Object?> _point(GeoPoint point) => {
      'type': 'Point',
      'coordinates': [point.lon, point.lat],
    };

/// Pins and groups; the selected place is drawn larger. Android needs a top-level feature `id`.
Map<String, Object?> placesGeoJson(List<MapCluster> clusters, {String? selectedId}) => _collection([
      for (final cluster in clusters)
        {
          'type': 'Feature',
          'id': cluster.key,
          'geometry': _point(cluster.center),
          'properties': {
            'kind': cluster.isGroup ? 'cluster' : 'pin',
            'count': cluster.ids.length,
            'selected': !cluster.isGroup && cluster.ids.single == selectedId,
          },
        },
    ]);

enum MapMarkerKind { food, parking, picked }

/// A point of an optional layer: a food place, a parking or the house picked on the map.
@immutable
class MapMarker {
  const MapMarker({required this.id, required this.kind, required this.location, this.icon});

  final String id;
  final MapMarkerKind kind;
  final GeoPoint location;

  /// The image a food marker is drawn with (`poi-foodCoffee`…).
  final String? icon;

  /// Unique across the layers: a food place and a parking may share an OSM id.
  String get key => '${kind.name}:$id';
}

/// Food icons, parking squares and the picked house; the one whose [MapMarker.key] is [selectedKey] is drawn larger.
Map<String, Object?> markersGeoJson(List<MapMarker> markers, {String? selectedKey}) => _collection([
      for (final marker in markers)
        {
          'type': 'Feature',
          'id': marker.key,
          'geometry': _point(marker.location),
          'properties': {'kind': marker.kind.name, 'icon': marker.icon, 'selected': marker.key == selectedKey},
        },
    ]);

/// The tappable marker nearest to [tap] within [tolerance] logical pixels; the picked house is not tappable.
MapMarker? markerAt(GeoPoint tap, List<MapMarker> markers, double zoom, {double tolerance = pinHitTolerancePx}) {
  final origin = project(tap, zoom);
  MapMarker? best;
  var bestDistance = tolerance;
  for (final marker in markers) {
    if (marker.kind == MapMarkerKind.picked) continue;
    final distance = project(marker.location, zoom).distanceTo(origin);
    // Food is drawn over parking, so it wins a tie.
    if (distance < bestDistance || (distance == bestDistance && marker.kind == MapMarkerKind.food)) {
      bestDistance = distance;
      best = marker;
    }
  }
  return best;
}

/// Overview lines with their stable colour (1..6) and whether they are among the selected walks.
Map<String, Object?> walksGeoJson(List<MapWalk> walks, {Set<String> selected = const {}}) => _collection([
      for (final walk in walks)
        {
          'type': 'Feature',
          'id': walk.key,
          'geometry': {
            'type': 'LineString',
            'coordinates': [for (final (lat, lon) in walk.line) [lon, lat]],
          },
          'properties': {'key': walk.key, 'color': walkColorIndex(walk.key), 'selected': selected.contains(walk.key)},
        },
    ]);

/// The user's position and, for a known accuracy, the circle of uncertainty around it.
Map<String, Object?> userGeoJson(GeoPoint? position, double? accuracyM) {
  if (position == null) return _collection(const []);
  return _collection([
    if (accuracyM != null && accuracyM.isFinite && accuracyM > 0)
      {
        'type': 'Feature',
        'id': 'accuracy',
        'geometry': {
          'type': 'Polygon',
          'coordinates': [accuracyRing(position, accuracyM)],
        },
        'properties': {'kind': 'accuracy'},
      },
    {
      'type': 'Feature',
      'id': 'position',
      'geometry': _point(position),
      'properties': {'kind': 'position'},
    },
  ]);
}

/// A closed ring of [steps] points [radiusM] metres around [center], as `[lon, lat]` pairs.
List<List<double>> accuracyRing(GeoPoint center, double radiusM, {int steps = 48}) {
  const earth = 6371000.0;
  final lat = center.lat * math.pi / 180, lon = center.lon * math.pi / 180, angular = radiusM / earth;
  final ring = <List<double>>[];
  for (var index = 0; index <= steps; index++) {
    final bearing = 2 * math.pi * (index % steps) / steps;
    final pointLat = math.asin(math.sin(lat) * math.cos(angular) + math.cos(lat) * math.sin(angular) * math.cos(bearing));
    final pointLon = lon + math.atan2(math.sin(bearing) * math.sin(angular) * math.cos(lat), math.cos(angular) - math.sin(lat) * math.sin(pointLat));
    ring.add([pointLon * 180 / math.pi, pointLat * 180 / math.pi]);
  }
  return ring;
}

/// The pin or group under a tap at [tap] for MapLibre [zoom]: the nearest within [tolerance] logical pixels.
MapCluster? clusterAt(GeoPoint tap, List<MapCluster> clusters, double zoom, {double tolerance = pinHitTolerancePx}) {
  final origin = project(tap, zoom);
  MapCluster? best;
  var bestDistance = tolerance;
  for (final cluster in clusters) {
    final pixel = project(cluster.center, zoom);
    final distance = pixel.distanceTo(origin);
    if (distance <= bestDistance) {
      bestDistance = distance;
      best = cluster;
    }
  }
  return best;
}

/// Overview walks under a tap, nearest first (site `walksAtPoint` over the walks in view).
List<String> walksAt(GeoPoint tap, List<MapWalk> walks, double zoom, {CatalogBounds? view, double tolerance = walkHitTolerancePx}) {
  final candidates = view == null ? walks : walks.where((walk) => walk.bounds.intersects(view));
  return walksAtPoint(project(tap, zoom), [
    for (final walk in candidates) (key: walk.key, pixels: [for (final (lat, lon) in walk.line) project(GeoPoint(lat, lon), zoom)]),
  ], tolerance: tolerance);
}

/// The camera bounds that show all of [points]; null for an empty list.
CatalogBounds? boundsOf(Iterable<GeoPoint> points) {
  CatalogBounds? bounds;
  for (final point in points) {
    bounds = bounds == null
        ? CatalogBounds(west: point.lon, south: point.lat, east: point.lon, north: point.lat)
        : CatalogBounds(
            west: math.min(bounds.west, point.lon),
            south: math.min(bounds.south, point.lat),
            east: math.max(bounds.east, point.lon),
            north: math.max(bounds.north, point.lat),
          );
  }
  return bounds;
}
