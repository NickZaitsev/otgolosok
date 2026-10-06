const EARTH_RADIUS_M = 6_371_000;
const TO_RADIANS = Math.PI / 180;
// A GPS fix and a routed vertex can differ by a fraction of a metre after encoding.
const STOP_PROGRESS_TOLERANCE_M = 1;

/** @typedef {{lat:number, lon:number}} Coordinates */
/** @typedef {{id:string, place?:{location?:Coordinates}, triggerLocation?:Coordinates}} WalkEntryStop */
/** @typedef {{geometry:Coordinates[], distanceM:number, walkingMinutes:number}} WalkEntryRoute */
/** @typedef {{route?:WalkEntryRoute|null, stops?:WalkEntryStop[]}} WalkEntryDocument */
/**
 * @typedef {object} WalkEntry
 * @property {number} distanceM Remaining declared route distance.
 * @property {number} walkingMinutes Remaining declared walking time.
 * @property {number} stopCount Number of stops at or after the entry point.
 * @property {number} startDistanceM Distance from the origin to the route, rounded to 50 m.
 * @property {string} entryStopId ID of the first remaining stop.
 * @property {number} entryIndex Index of the first remaining stop in the document.
 * @property {Coordinates[]} geometry Route geometry from the projected entry point.
 * @property {Coordinates} location Projected entry point on the route.
 * @property {number} routeOffsetM Distance along the route geometry to the entry point.
 */

/** @param {unknown} value @returns {value is Coordinates} */
function validPoint(value) {
  if (!value || typeof value !== "object") return false;
  const point = /** @type {{lat?:unknown, lon?:unknown}} */ (value);
  return typeof point.lat === "number" && typeof point.lon === "number"
    && Number.isFinite(point.lat) && Number.isFinite(point.lon)
    && point.lat >= -90 && point.lat <= 90 && point.lon >= -180 && point.lon <= 180;
}

/** Great-circle distance used for distances along the stored route. */
function haversine(a, b) {
  const deltaLat = (b.lat - a.lat) * TO_RADIANS;
  const deltaLon = (b.lon - a.lon) * TO_RADIANS;
  const value = Math.sin(deltaLat / 2) ** 2
    + Math.cos(a.lat * TO_RADIANS) * Math.cos(b.lat * TO_RADIANS) * Math.sin(deltaLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(Math.min(1, value)));
}

/**
 * Project a point onto a route, optionally considering only positions after an offset.
 * Equirectangular metres make projection stable on short city segments; cumulative route
 * distances use haversine so the returned progress agrees with the full polyline length.
 * @param {Coordinates} point
 * @param {Coordinates[]} geometry
 * @param {number[]} cumulativeM
 * @param {number} [minimumOffsetM]
 */
function projectToRoute(point, geometry, cumulativeM, minimumOffsetM = 0) {
  const cosLat = Math.cos(point.lat * TO_RADIANS);
  let best = null;

  for (let index = 0; index < geometry.length - 1; index++) {
    const segmentStartM = cumulativeM[index];
    const segmentLengthM = cumulativeM[index + 1] - segmentStartM;
    if (segmentStartM + segmentLengthM < minimumOffsetM) continue;

    const a = geometry[index];
    const b = geometry[index + 1];
    const ax = (a.lon - point.lon) * TO_RADIANS * EARTH_RADIUS_M * cosLat;
    const ay = (a.lat - point.lat) * TO_RADIANS * EARTH_RADIUS_M;
    const bx = (b.lon - point.lon) * TO_RADIANS * EARTH_RADIUS_M * cosLat;
    const by = (b.lat - point.lat) * TO_RADIANS * EARTH_RADIUS_M;
    const dx = bx - ax;
    const dy = by - ay;
    const lengthSquared = dx * dx + dy * dy;
    const minimumT = segmentLengthM > 0 ? Math.max(0, Math.min(1, (minimumOffsetM - segmentStartM) / segmentLengthM)) : 0;
    const projectedT = lengthSquared > 0 ? -(ax * dx + ay * dy) / lengthSquared : 0;
    const t = Math.max(minimumT, Math.min(1, projectedT));
    const location = { lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t };
    const distanceM = Math.hypot(ax + dx * t, ay + dy * t);
    const offsetM = segmentStartM + segmentLengthM * t;

    // Strict comparison deliberately resolves equal-distance crossings to their first occurrence.
    if (!best || distanceM < best.distanceM - 1e-6) best = { distanceM, offsetM, location, segmentIndex: index, t };
  }
  return best;
}

/**
 * Find where a walk can be joined from `origin` and describe only its remaining part.
 * Stops are projected in document order and never move backwards along the route, which
 * disambiguates loops, repeated vertices and self-crossings.
 *
 * @param {WalkEntryDocument | null | undefined} document
 * @param {Coordinates} origin
 * @param {number} [radiusM=500]
 * @returns {WalkEntry | null}
 */
export function computeWalkEntry(document, origin, radiusM = 500) {
  const route = document?.route;
  const geometry = route?.geometry;
  if (!validPoint(origin) || !Number.isFinite(radiusM) || radiusM < 0
    || !route || !Array.isArray(geometry) || geometry.length < 2 || !geometry.every(validPoint)
    || !Number.isFinite(route.distanceM) || route.distanceM <= 0
    || !Number.isFinite(route.walkingMinutes) || route.walkingMinutes <= 0
    || !Array.isArray(document?.stops) || document.stops.length === 0) return null;

  const cumulativeM = [0];
  for (let index = 1; index < geometry.length; index++) {
    cumulativeM.push(cumulativeM[index - 1] + haversine(geometry[index - 1], geometry[index]));
  }
  const totalGeometryM = cumulativeM.at(-1);
  if (!(totalGeometryM > 0)) return null;

  const entry = projectToRoute(origin, geometry, cumulativeM);
  if (!entry || entry.distanceM > radiusM) return null;

  let previousStopOffsetM = 0;
  const stopOffsets = [];
  for (const stop of document.stops) {
    const stopLocation = stop?.triggerLocation ?? stop?.place?.location;
    if (!validPoint(stopLocation)) return null;
    const projection = projectToRoute(stopLocation, geometry, cumulativeM, previousStopOffsetM);
    if (!projection) return null;
    previousStopOffsetM = projection.offsetM;
    stopOffsets.push(projection.offsetM);
  }

  const entryIndex = stopOffsets.findIndex(offsetM => offsetM + STOP_PROGRESS_TOLERANCE_M >= entry.offsetM);
  if (entryIndex < 0) return null;

  const remainingGeometryM = Math.max(0, totalGeometryM - entry.offsetM);
  if (remainingGeometryM <= Number.EPSILON * totalGeometryM) return null;
  const remainingRatio = remainingGeometryM / totalGeometryM;
  const nextVertices = geometry.slice(entry.segmentIndex + 1);
  if (nextVertices.length && haversine(entry.location, nextVertices[0]) < 0.001) nextVertices.shift();

  return {
    distanceM: route.distanceM * remainingRatio,
    walkingMinutes: route.walkingMinutes * remainingRatio,
    stopCount: document.stops.length - entryIndex,
    startDistanceM: Math.round(entry.distanceM / 50) * 50,
    entryStopId: document.stops[entryIndex].id,
    entryIndex,
    geometry: [entry.location, ...nextVertices],
    location: entry.location,
    routeOffsetM: entry.offsetM,
  };
}
