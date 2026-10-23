// Port of src/features/food/route-proximity.ts: which food places lie along a walking route, where along it, and
// which map cells cover the route.
import 'dart:math' as math;

import 'package:flutter/foundation.dart';

import '../../walk_engine/distance.dart';
import '../../walk_engine/walk_view.dart' show WalkMode;
import 'food_model.dart';
import 'opening_hours.dart' show FoodText;

const double _mPerDeg = 111320;

double _scaleX(double lat) => _mPerDeg * math.cos(lat * math.pi / 180);

double _distance(GeoPoint a, GeoPoint b) {
  final dx = (a.lon - b.lon) * _scaleX((a.lat + b.lat) / 2), dy = (a.lat - b.lat) * _mPerDeg;
  return math.sqrt(dx * dx + dy * dy);
}

/// Where a point meets the route: [distanceM] straight to the line, [alongM] from the start along it, and the
/// index of the first [vertex] of the matched segment.
@immutable
class RouteMatch {
  const RouteMatch({required this.distanceM, required this.alongM, required this.vertex});

  final double distanceM;
  final double alongM;
  final int vertex;

  @override
  bool operator ==(Object other) => other is RouteMatch && other.distanceM == distanceM && other.alongM == alongM && other.vertex == vertex;

  @override
  int get hashCode => Object.hash(distanceM, alongM, vertex);

  @override
  String toString() => 'RouteMatch($distanceM m, along $alongM m, vertex $vertex)';
}

/// A food place near the route with its [match].
@immutable
class RouteFoodPlace {
  const RouteFoodPlace(this.place, this.match);

  final FoodPlace place;
  final RouteMatch match;

  String get id => place.id;
  double get distanceM => match.distanceM;
  double get alongM => match.alongM;
}

/// How much work [placesAlongRoute] did; filled in when passed.
class ProximityStats {
  int checkedPairs = 0;
  int bboxRejected = 0;
}

class _Segment {
  const _Segment(this.a, this.b, this.length, this.along, this.vertex);

  final GeoPoint a;
  final GeoPoint b;
  final double length;
  final double along;
  final int vertex;
}

/// Equirectangular projection centred on the place, with the projection clamped to the segment.
RouteMatch _project(GeoPoint point, _Segment segment) {
  final sx = _scaleX(point.lat);
  final ax = (segment.a.lon - point.lon) * sx, ay = (segment.a.lat - point.lat) * _mPerDeg;
  final dx = (segment.b.lon - segment.a.lon) * sx, dy = (segment.b.lat - segment.a.lat) * _mPerDeg;
  final length2 = dx * dx + dy * dy;
  final t = length2 != 0 ? math.max(0.0, math.min(1.0, -(ax * dx + ay * dy) / length2)) : 0.0;
  final x = ax + t * dx, y = ay + t * dy;
  return RouteMatch(distanceM: math.sqrt(x * x + y * y), alongM: segment.along + t * segment.length, vertex: segment.vertex);
}

List<_Segment> _segmentsFor(List<GeoPoint> geometry) {
  final segments = <_Segment>[];
  var along = 0.0;
  for (var vertex = 0; vertex + 1 < geometry.length; vertex++) {
    final a = geometry[vertex], b = geometry[vertex + 1], length = _distance(a, b);
    segments.add(_Segment(a, b, length, along, vertex));
    along += length;
  }
  return segments;
}

RouteMatch _bestMatch(List<RouteMatch> matches, WalkMode mode, [double limit = double.infinity]) {
  if (matches.isEmpty) return const RouteMatch(distanceM: double.infinity, alongM: 0, vertex: 0);
  final best = matches.reduce((a, b) => b.distanceM < a.distanceM ? b : a);
  if (mode != WalkMode.loop) return best;
  final threshold = math.min(limit, best.distanceM + 15);
  // Descend to the local minimum of the earliest passage, as routeLegCuts does for vertices. Every segment
  // appears once, so the vertex order is total.
  final ordered = [...matches]..sort((a, b) => a.vertex - b.vertex);
  var index = ordered.indexWhere((match) => match.distanceM <= threshold);
  if (index < 0) return best;
  while (index + 1 < ordered.length && ordered[index + 1].vertex == ordered[index].vertex + 1 && ordered[index + 1].distanceM < ordered[index].distanceM) {
    index += 1;
  }
  return ordered[index];
}

/// The closest point of the route to [point]. On a loop walk it is the earliest passage within 15 m of the best.
RouteMatch distanceToRoute(GeoPoint point, List<GeoPoint> geometry, {WalkMode mode = WalkMode.open}) {
  if (geometry.length == 1) return RouteMatch(distanceM: _distance(point, geometry[0]), alongM: 0, vertex: 0);
  return _bestMatch([for (final segment in _segmentsFor(geometry)) _project(point, segment)], mode);
}

/// The places within [maxDistanceM] of the route, ordered along it (then by id). Build once per batch: segment
/// buckets avoid a full route scan for every place.
List<RouteFoodPlace> placesAlongRoute(
  List<FoodPlace> places,
  List<GeoPoint> geometry, {
  double maxDistanceM = 150,
  WalkMode mode = WalkMode.open,
  ProximityStats? stats,
}) {
  if (stats != null) {
    stats.checkedPairs = 0;
    stats.bboxRejected = 0;
  }
  if (geometry.isEmpty || !maxDistanceM.isFinite || maxDistanceM < 0) return [];
  final lats = geometry.map((point) => point.lat), lons = geometry.map((point) => point.lon);
  final south = lats.reduce(math.min), north = lats.reduce(math.max), west = lons.reduce(math.min), east = lons.reduce(math.max);
  final origin = geometry[0], sx = _scaleX((south + north) / 2);
  final size = math.max(50.0, maxDistanceM);
  double x(GeoPoint point) => (point.lon - origin.lon) * sx;
  double y(GeoPoint point) => (point.lat - origin.lat) * _mPerDeg;
  final segments = _segmentsFor(geometry), buckets = <(int, int), Set<int>>{};
  for (final segment in segments) {
    final ax = x(segment.a), ay = y(segment.a), bx = x(segment.b), by = y(segment.b);
    final steps = math.max(1, (math.sqrt((bx - ax) * (bx - ax) + (by - ay) * (by - ay)) / (size / 2)).ceil());
    // Sampling plus one extra query bucket conservatively covers even a corner crossing.
    for (var i = 0; i <= steps; i++) {
      final key = (((ax + (bx - ax) * i / steps) / size).floor(), ((ay + (by - ay) * i / steps) / size).floor());
      buckets.putIfAbsent(key, () => <int>{}).add(segment.vertex);
    }
  }
  final result = <RouteFoodPlace>[];
  for (final place in places) {
    final dx = maxDistanceM / math.max(1e-9, _scaleX(place.lat).abs()), dy = maxDistanceM / _mPerDeg;
    if (place.lat < south - dy || place.lat > north + dy || place.lon < west - dx || place.lon > east + dx) {
      if (stats != null) stats.bboxRejected += 1;
      continue;
    }
    final RouteMatch match;
    if (geometry.length == 1) {
      match = distanceToRoute(place.location, geometry);
    } else {
      final px = x(place.location), py = y(place.location), rx = maxDistanceM * (sx / math.max(1e-9, _scaleX(place.lat))).abs();
      final candidates = <int>{};
      for (var cx = ((px - rx) / size).floor() - 1; cx <= ((px + rx) / size).floor() + 1; cx++) {
        for (var cy = ((py - maxDistanceM) / size).floor() - 1; cy <= ((py + maxDistanceM) / size).floor() + 1; cy++) {
          candidates.addAll(buckets[(cx, cy)] ?? const <int>{});
        }
      }
      if (stats != null) stats.checkedPairs += candidates.length;
      match = _bestMatch([for (final index in candidates) _project(place.location, segments[index])], mode, maxDistanceM);
    }
    if (match.distanceM <= maxDistanceM) result.add(RouteFoodPlace(place, match));
  }
  // OSM ids (`osm:node:123`) are ASCII, where code unit order equals the site's `localeCompare`.
  return result..sort((a, b) {
      final along = a.alongM.compareTo(b.alongM);
      return along != 0 ? along : a.id.compareTo(b.id);
    });
}

/// Keys (`"lat:lon"`, numerically sorted) of the [cellSize] cells within [bufferM] of the route. Conservative
/// segment envelopes include neighbouring cells at exact grid lines.
List<String> cellsForRoute(List<GeoPoint> geometry, {double cellSize = 0.05, double bufferM = 150}) {
  if (!cellSize.isFinite || cellSize <= 0 || !bufferM.isFinite || bufferM < 0) return [];
  final factor = 1 / cellSize, keys = <(int, int)>{};
  final minLat = (-90 * factor).floor(), maxLat = (90 * factor).ceil() - 1, minLon = (-180 * factor).floor(), maxLon = (180 * factor).ceil() - 1;
  for (var i = 0; i < geometry.length; i++) {
    final a = geometry[i], b = geometry[math.min(i + 1, geometry.length - 1)];
    final dy = bufferM / _mPerDeg, dx = bufferM / math.max(1e-9, math.min(_scaleX(a.lat).abs(), _scaleX(b.lat).abs()));
    final loLat = math.max(-90.0, math.min(a.lat, b.lat) - dy), hiLat = math.min(90.0, math.max(a.lat, b.lat) + dy);
    final loLon = math.max(-180.0, math.min(a.lon, b.lon) - dx), hiLon = math.min(180.0, math.max(a.lon, b.lon) + dx);
    for (var lat = math.max(minLat, (loLat * factor).ceil() - 1); lat <= math.min(maxLat, (hiLat * factor).floor()); lat++) {
      for (var lon = math.max(minLon, (loLon * factor).ceil() - 1); lon <= math.min(maxLon, (hiLon * factor).floor()); lon++) {
        keys.add((lat, lon));
      }
    }
  }
  final sorted = keys.toList()..sort((a, b) => a.$1 != b.$1 ? a.$1 - b.$1 : a.$2 - b.$2);
  return [for (final (lat, lon) in sorted) '$lat:$lon'];
}

/// «≈ 80 м от маршрута» for a finite straight-line distance.
FoodText formatRouteDistance(double distanceM) => FoodText('≈ {distance} м от маршрута', {'distance': distanceM.round()});

/// Index of the stop closest along the route to [alongM]; ties go to the earlier stop. [stops] are the stops'
/// distances along the route.
int? nearestStop(double alongM, List<double> stops) {
  if (stops.isEmpty) return null;
  var best = 0;
  for (var i = 1; i < stops.length; i++) {
    if ((stops[i] - alongM).abs() < (stops[best] - alongM).abs()) best = i;
  }
  return best;
}

/// «рядом с остановкой N» (numbered from 1), or null without stops.
FoodText? formatNearbyStop(double alongM, List<double> stops) {
  final index = nearestStop(alongM, stops);
  return index == null ? null : FoodText('рядом с остановкой {number}', {'number': index + 1});
}

/// Cumulative vertex distances use the same segment lengths as place projections.
List<double> routeVertexDistances(List<GeoPoint> geometry) {
  var along = 0.0;
  return [
    for (var i = 0; i < geometry.length; i++) i == 0 ? along : along += _distance(geometry[i - 1], geometry[i]),
  ];
}

/// The point of the route where [match] lies (what the camera frames), or null when its vertex is not on [geometry].
GeoPoint? matchedRoutePoint(RouteMatch match, List<GeoPoint> geometry, [List<double>? distances]) {
  if (match.vertex < 0 || match.vertex >= geometry.length) return null;
  final a = geometry[match.vertex];
  if (match.vertex + 1 >= geometry.length) return a;
  final b = geometry[match.vertex + 1], along = distances ?? routeVertexDistances(geometry);
  final length = along[match.vertex + 1] - along[match.vertex];
  final t = length != 0 ? math.max(0.0, math.min(1.0, (match.alongM - along[match.vertex]) / length)) : 0.0;
  return GeoPoint(a.lat + t * (b.lat - a.lat), a.lon + t * (b.lon - a.lon));
}
