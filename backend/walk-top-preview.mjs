/** A compact diagram of the full route; coordinates are normalized to a 100 × 100 square. */
export function routePreview(geometry) {
  if (!Array.isArray(geometry) || geometry.length < 2 || geometry.some(point => !Number.isFinite(point?.lat) || !Number.isFinite(point?.lon))) return null;
  const centerLat = geometry.reduce((sum, point) => sum + point.lat, 0) / geometry.length;
  const cosine = Math.cos(centerLat * Math.PI / 180);
  const xs = geometry.map(point => point.lon * cosine);
  const ys = geometry.map(point => point.lat);
  const left = Math.min(...xs), right = Math.max(...xs), bottom = Math.min(...ys), top = Math.max(...ys);
  const span = Math.max(right - left, top - bottom);
  if (span <= 0) return null;
  const points = geometry.map((_, index) => [
    Math.round((50 + (xs[index] - (left + right) / 2) / span * 84) * 10) / 10,
    Math.round((50 - (ys[index] - (bottom + top) / 2) / span * 84) * 10) / 10,
  ]);
  return simplify(points, 1);
}

/** Keep the route silhouette without sending every routing vertex to each card. */
function simplify(points, tolerance) {
  const retain = threshold => {
    const retained = new Set([0, points.length - 1]);
    const stack = [[0, points.length - 1]];
    while (stack.length) {
      const [first, last] = stack.pop();
      const [ax, ay] = points[first], [bx, by] = points[last];
      const lengthSquared = (bx - ax) ** 2 + (by - ay) ** 2;
      let largest = 0, chosen = -1;
      for (let index = first + 1; index < last; index += 1) {
        const [x, y] = points[index];
        const ratio = lengthSquared ? Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / lengthSquared)) : 0;
        const distance = Math.hypot(x - ax - ratio * (bx - ax), y - ay - ratio * (by - ay));
        if (distance > largest) { largest = distance; chosen = index; }
      }
      if (largest > threshold && chosen >= 0) { retained.add(chosen); stack.push([first, chosen], [chosen, last]); }
    }
    return [...retained].sort((a, b) => a - b).map(index => points[index]);
  };
  let simplified = retain(tolerance);
  if (simplified.length <= 80) return simplified;
  let low = tolerance, high = 362;
  for (let iteration = 0; iteration < 12; iteration += 1) {
    const middle = (low + high) / 2, candidate = retain(middle);
    if (candidate.length > 80) low = middle;
    else { high = middle; simplified = candidate; }
  }
  return simplified;
}

const mercator = (point, zoom) => {
  const size = 256 * 2 ** zoom;
  const latitude = Math.max(-85, Math.min(85, point.lat)) * Math.PI / 180;
  return [(point.lon + 180) / 360 * size, (1 - Math.asinh(Math.tan(latitude)) / Math.PI) / 2 * size];
};

/** Tile positions and route vertices share a 256 × 256 viewBox for a static map thumbnail. */
export function routeMapPreview(geometry) {
  if (!Array.isArray(geometry) || geometry.length < 2 || geometry.some(point => !Number.isFinite(point?.lat) || !Number.isFinite(point?.lon))) return null;
  let zoom = 16, projected, left, right, top, bottom;
  do {
    projected = geometry.map(point => mercator(point, zoom));
    const xs = projected.map(point => point[0]), ys = projected.map(point => point[1]);
    left = Math.min(...xs); right = Math.max(...xs); top = Math.min(...ys); bottom = Math.max(...ys);
    if (Math.max(right - left, bottom - top) <= 180 || zoom === 0) break;
    zoom -= 1;
  } while (true);
  const originX = (left + right) / 2 - 128, originY = (top + bottom) / 2 - 128;
  const points = simplify(projected.map(([x, y]) => [Math.round((x - originX) * 10) / 10, Math.round((y - originY) * 10) / 10]), 2);
  const tiles = [];
  for (let y = Math.floor(originY / 256); y <= Math.floor((originY + 255.999) / 256); y += 1)
    for (let x = Math.floor(originX / 256); x <= Math.floor((originX + 255.999) / 256); x += 1)
      tiles.push({ x, y, left: Math.round((x * 256 - originX) * 10) / 10, top: Math.round((y * 256 - originY) * 10) / 10 });
  return { zoom, tiles, points };
}

const radians = degrees => degrees * Math.PI / 180;
const distanceM = (a, b) => {
  const latitude = radians(b.lat - a.lat), longitude = radians(b.lon - a.lon);
  const haversine = Math.sin(latitude / 2) ** 2 + Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(longitude / 2) ** 2;
  return Math.round(12_742_000 * Math.asin(Math.sqrt(haversine)));
};
const stationKey = name => name.toLocaleLowerCase("ru").replaceAll("ё", "е").trim();

/** A named metro entrance wins over a nearby interchange platform; otherwise use the nearest station. */
export function nearestMetro(point, stations, address = "", maximumM = 1500) {
  if (!point || !Number.isFinite(point.lat) || !Number.isFinite(point.lon)) return null;
  const possible = stations.map(station => ({ ...station, distanceM: distanceM(point, station) }))
    .filter(station => Number.isFinite(station.distanceM)).sort((a, b) => a.distanceM - b.distanceM);
  const named = /метро\s*[«"]([^»"]+)[»"]/iu.exec(address)?.[1] ?? /^метро\s+([^,]+)/iu.exec(address)?.[1];
  const explicit = named && possible.find(station => stationKey(station.name) === stationKey(named));
  const nearest = explicit && explicit.distanceM <= 700 ? explicit : possible[0];
  if (!nearest || nearest.distanceM > maximumM) return null;
  const lines = [...new Map(possible
    .filter(station => stationKey(station.name) === stationKey(nearest.name) && distanceM(nearest, station) <= 200 && station.line)
    .map(station => [station.line.id, station.line])).values()]
    .sort((a, b) => Number(a.id) - Number(b.id));
  return { name: nearest.name, distanceM: nearest.distanceM, lines };
}

export const CIRCLE_LINE_ID = "5";

/**
 * Names of stations on the Circle line, inside the ring it draws, or a short transfer away from it
 * (Марксистская at Таганская, Менделеевская at Новослободская). The ring is the polygon of Circle line
 * stations ordered by angle around their centre; a name counts when any of its platforms qualifies.
 */
export function insideCircleStations(stations, transferM = 400) {
  const ring = stations.filter(station => station.line?.id === CIRCLE_LINE_ID);
  if (ring.length < 3) return new Set();
  const centre = { lat: ring.reduce((sum, station) => sum + station.lat, 0) / ring.length, lon: ring.reduce((sum, station) => sum + station.lon, 0) / ring.length };
  const polygon = ring.map(station => [station.lon, station.lat])
    .sort((a, b) => Math.atan2(a[1] - centre.lat, a[0] - centre.lon) - Math.atan2(b[1] - centre.lat, b[0] - centre.lon));
  const inside = ({ lat, lon }) => {
    let result = false;
    for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
      const [x1, y1] = polygon[index], [x2, y2] = polygon[previous];
      if ((y1 > lat) !== (y2 > lat) && lon < (x2 - x1) * (lat - y1) / (y2 - y1) + x1) result = !result;
    }
    return result;
  };
  return new Set(stations.filter(station => station.line?.id === CIRCLE_LINE_ID || inside(station)
    || ring.some(platform => distanceM(platform, station) <= transferM)).map(station => station.name));
}
