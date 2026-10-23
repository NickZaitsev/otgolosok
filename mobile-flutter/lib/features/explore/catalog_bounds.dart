/// Map areas in degrees (port of `src/features/explore/catalog-bounds.ts`).
library;

import 'dart:math' as math;

import '../../walk_engine/distance.dart';

class CatalogBounds {
  const CatalogBounds({required this.west, required this.south, required this.east, required this.north});

  final double west;
  final double south;
  final double east;
  final double north;

  bool intersects(CatalogBounds other) => west <= other.east && east >= other.west && south <= other.north && north >= other.south;

  bool contains(CatalogBounds inner) => west <= inner.west && east >= inner.east && south <= inner.south && north >= inner.north;

  bool containsPoint(GeoPoint point) => point.lat >= south && point.lat <= north && point.lon >= west && point.lon <= east;

  @override
  bool operator ==(Object other) =>
      other is CatalogBounds && other.west == west && other.south == south && other.east == east && other.north == north;

  @override
  int get hashCode => Object.hash(west, south, east, north);

  @override
  String toString() => 'CatalogBounds($west, $south, $east, $north)';
}

/// What the map shows now: [required] is the visible view plus half a zoom step, [buffered] two zoom steps
/// out (cells prefetched before a pan crosses their line).
class MapViewport {
  const MapViewport({required this.required, required this.buffered, required this.zoom, required this.center});

  final CatalogBounds required;
  final CatalogBounds buffered;

  /// MapLibre zoom (512 px tiles).
  final double zoom;
  final GeoPoint center;
}

/// The lowest MapLibre zoom of the explore map: the site's Leaflet z10 is MapLibre z9 (512 px tiles).
const double mapMinZoom = 9;

/// MapLibre tile size: the world is `512 · 2^zoom` logical pixels wide.
const double _tileSize = 512;

double _worldSize(double zoom) => _tileSize * math.pow(2, zoom);

/// Web Mercator x/y in logical pixels at [zoom].
math.Point<double> project(GeoPoint point, double zoom) {
  final size = _worldSize(zoom);
  final lat = point.lat.clamp(-85.05112878, 85.05112878);
  final sin = math.sin(lat * math.pi / 180);
  final x = (point.lon + 180) / 360 * size;
  final y = (0.5 - math.log((1 + sin) / (1 - sin)) / (4 * math.pi)) * size;
  return math.Point(x, y);
}

GeoPoint unproject(math.Point<double> pixel, double zoom) {
  final size = _worldSize(zoom);
  final lon = pixel.x / size * 360 - 180;
  final n = math.pi - 2 * math.pi * pixel.y / size;
  final lat = 180 / math.pi * math.atan(0.5 * (math.exp(n) - math.exp(-n)));
  return GeoPoint(lat, lon);
}

/// The catalog areas of a map view of [width]×[height] logical pixels (site `catalogArea`): pixels are
/// projected at the reduced zoom, since padding latitude directly is not Mercator-correct.
MapViewport viewportFor({required GeoPoint center, required double zoom, required double width, required double height}) {
  CatalogBounds bounds(double steps) {
    final at = math.max(mapMinZoom, zoom - steps);
    final middle = project(center, at);
    final southWest = unproject(math.Point(middle.x - width / 2, middle.y + height / 2), at);
    final northEast = unproject(math.Point(middle.x + width / 2, middle.y - height / 2), at);
    // The public catalog uses non-wrapping rectangles; a wrapped world view loads the world once.
    final wraps = southWest.lon < -180 || northEast.lon > 180;
    return CatalogBounds(
      west: wraps ? -180 : southWest.lon,
      south: math.max(-90, southWest.lat),
      east: wraps ? 180 : northEast.lon,
      north: math.min(90, northEast.lat),
    );
  }

  return MapViewport(required: bounds(0.5), buffered: bounds(2), zoom: zoom, center: center);
}

/// Bounding rectangle of a spherical cap, enclosing the entire nearby search radius.
CatalogBounds nearbyBounds(GeoPoint center, num radiusM) {
  const rad = math.pi / 180;
  final angular = radiusM / 6371000;
  final dy = angular / rad;
  final dx = math.asin(math.sin(angular) / math.cos(center.lat * rad)) / rad;
  return CatalogBounds(west: center.lon - dx, south: center.lat - dy, east: center.lon + dx, north: center.lat + dy);
}
