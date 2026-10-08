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
  // Reduce network payload while retaining bends that define the walk's silhouette.
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
    if (largest > 1 && chosen >= 0) { retained.add(chosen); stack.push([first, chosen], [chosen, last]); }
  }
  const simplified = [...retained].sort((a, b) => a - b).map(index => points[index]);
  if (simplified.length <= 80) return simplified;
  return Array.from({ length: 80 }, (_, index) => simplified[Math.round(index * (simplified.length - 1) / 79)]);
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
  const possible = stations.map(station => ({ name: station.name, distanceM: distanceM(point, station) }))
    .filter(station => Number.isFinite(station.distanceM)).sort((a, b) => a.distanceM - b.distanceM);
  const named = /метро\s*[«"]([^»"]+)[»"]/iu.exec(address)?.[1] ?? /^метро\s+([^,]+)/iu.exec(address)?.[1];
  const explicit = named && possible.find(station => stationKey(station.name) === stationKey(named));
  const nearest = explicit && explicit.distanceM <= 700 ? explicit : possible[0];
  return nearest && nearest.distanceM <= maximumM ? nearest : null;
}
