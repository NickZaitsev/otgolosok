import type { GeoPoint } from "./types";

const EARTH_RADIUS_M = 6_371_000;
const TO_RADIANS = Math.PI / 180;

export function distanceMeters(from: GeoPoint, to: GeoPoint): number {
  const fromLat = from.lat * TO_RADIANS;
  const toLat = to.lat * TO_RADIANS;
  const deltaLat = (to.lat - from.lat) * TO_RADIANS;
  const deltaLon = (to.lon - from.lon) * TO_RADIANS;

  const haversine =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(fromLat) * Math.cos(toLat) * Math.sin(deltaLon / 2) ** 2;

  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(haversine));
}
