// Port of src/lib/geo/distance.ts and the point types of src/lib/geo/types.ts.
import 'dart:math' as math;

const double _earthRadiusM = 6371000;
const double _toRadians = math.pi / 180;

/// A WGS84 point (`GeoPoint`/`Coordinates` on the site).
class GeoPoint {
  const GeoPoint(this.lat, this.lon);

  final double lat;
  final double lon;

  Map<String, Object?> toJson() => {'lat': lat, 'lon': lon};

  @override
  bool operator ==(Object other) =>
      other is GeoPoint &&
      other.runtimeType == runtimeType &&
      other.lat == lat &&
      other.lon == lon;

  @override
  int get hashCode => Object.hash(lat, lon);

  @override
  String toString() => 'GeoPoint($lat, $lon)';
}

/// Great-circle distance by the haversine formula, Earth radius 6 371 000 m.
double distanceMeters(GeoPoint from, GeoPoint to) {
  final fromLat = from.lat * _toRadians;
  final toLat = to.lat * _toRadians;
  final deltaLat = (to.lat - from.lat) * _toRadians;
  final deltaLon = (to.lon - from.lon) * _toRadians;

  final sinLat = math.sin(deltaLat / 2);
  final sinLon = math.sin(deltaLon / 2);
  // Same evaluation order as `Math.sin(x) ** 2` in the TypeScript: the squares
  // are taken first, so the result matches the site to the last bit.
  final haversine =
      (sinLat * sinLat) + math.cos(fromLat) * math.cos(toLat) * (sinLon * sinLon);

  return 2 * _earthRadiusM * math.asin(math.sqrt(haversine));
}
