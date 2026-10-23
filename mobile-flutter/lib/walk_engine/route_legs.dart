// Port of src/features/tour/route-legs.ts: the legs of a walking route between its stops and what the
// map frames before and during the walk.
import 'dart:math' as math;

import 'distance.dart';

// A loop walk can pass the same spot twice. A pass this close to the best match
// that comes earlier along the line is where the walker reaches the stop first.
const double _sameSpotSlackM = 15;

// Farther than this from the leg, the walker's position would zoom the map out of the street.
const double _nearLegM = 1500;

double _distanceM(GeoPoint a, GeoPoint b) {
  final scaleX = 111320 * math.cos(((a.lat + b.lat) / 2) * math.pi / 180);
  final dx = (b.lon - a.lon) * scaleX, dy = (b.lat - a.lat) * 111320;
  return math.sqrt(dx * dx + dy * dy);
}

/// For each stop, the geometry vertex where the leg into that stop ends. Cuts never
/// go back along the line; a stop at the start building cuts at vertex 0.
List<int> routeLegCuts(List<GeoPoint> geometry, List<GeoPoint> stops) {
  final cuts = <int>[];
  var from = 0;
  for (final stop in stops) {
    if (geometry.isEmpty) {
      cuts.add(0);
      continue;
    }
    final distances = [for (var i = from; i < geometry.length; i++) _distanceM(geometry[i], stop)];
    final best = distances.reduce(math.min);
    // The earliest pass near enough, then down to its own closest vertex.
    var found = distances.indexWhere((value) => value <= best + _sameSpotSlackM);
    while (found + 1 < distances.length && distances[found + 1] < distances[found]) {
      found += 1;
    }
    final cut = from + found;
    cuts.add(cut);
    from = cut;
  }
  return cuts;
}

/// Vertex range of a leg: leg i ends at stop i, the leg after the last stop ends at the
/// finish. Null when the leg has no length (a stop at the start, a finish at the last stop).
(int, int)? legRange(List<int> cuts, int geometryLength, int leg) {
  if (leg < 0 || leg > cuts.length || geometryLength < 2) return null;
  final from = leg == 0 ? 0 : cuts[leg - 1];
  final to = leg == cuts.length ? geometryLength - 1 : cuts[leg];
  return to > from ? (from, to) : null;
}

/// What the map shows for a leg: its line, or the point it leads to when the leg has
/// no length, plus the walker's position when they are near it.
({List<GeoPoint> points, bool withUser}) legFitPoints(List<GeoPoint> geometry, (int, int)? range, GeoPoint target, GeoPoint? user) {
  final points = range == null ? [target] : geometry.sublist(range.$1, range.$2 + 1);
  if (user == null) return (points: points, withUser: false);
  final lats = points.map((point) => point.lat), lons = points.map((point) => point.lon);
  final nearest = GeoPoint(
    user.lat.clamp(lats.reduce(math.min), lats.reduce(math.max)),
    user.lon.clamp(lons.reduce(math.min), lons.reduce(math.max)),
  );
  return _distanceM(nearest, user) <= _nearLegM
      ? (points: [...points, GeoPoint(user.lat, user.lon)], withUser: true)
      : (points: points, withUser: false);
}

/// What the map shows before the walk starts: the start, the first stop and the line
/// between them, so the walker sees where to go first rather than all the stops at once.
List<GeoPoint> openingFitPoints(List<GeoPoint> geometry, List<int> cuts, GeoPoint start, GeoPoint first) {
  final range = legRange(cuts, geometry.length, 0);
  final points = [start, if (range != null) ...geometry.sublist(range.$1, range.$2 + 1), first];
  return points.every((point) => point == start) ? [start] : points;
}
