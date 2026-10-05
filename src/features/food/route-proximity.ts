import type { Coordinates } from "../tour/types";
import type { FoodPlace } from "./types";

const M_PER_DEG = 111320;
const scaleX = (lat: number) => M_PER_DEG * Math.cos(lat * Math.PI / 180);
export type RouteMatch = { distanceM: number; alongM: number; vertex: number };
export type ProximityStats = { checkedPairs: number; bboxRejected: number };
type Segment = { a: Coordinates; b: Coordinates; length: number; along: number; vertex: number };
const distance = (a: Coordinates, b: Coordinates) => Math.hypot((a.lon - b.lon) * scaleX((a.lat + b.lat) / 2), (a.lat - b.lat) * M_PER_DEG);

/** Equirectangular projection centred on the place, with the projection clamped to the segment. */
function project(point: Coordinates, segment: Segment): RouteMatch {
  const sx = scaleX(point.lat);
  const ax = (segment.a.lon - point.lon) * sx, ay = (segment.a.lat - point.lat) * M_PER_DEG;
  const dx = (segment.b.lon - segment.a.lon) * sx, dy = (segment.b.lat - segment.a.lat) * M_PER_DEG;
  const length2 = dx * dx + dy * dy;
  const t = length2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / length2)) : 0;
  return { distanceM: Math.hypot(ax + t * dx, ay + t * dy), alongM: segment.along + t * segment.length, vertex: segment.vertex };
}
function segmentsFor(geometry: Coordinates[]): Segment[] {
  let along = 0;
  return geometry.slice(1).map((b, vertex) => {
    const a = geometry[vertex], length = distance(a, b), segment = { a, b, length, along, vertex };
    along += length;
    return segment;
  });
}
function bestMatch(matches: RouteMatch[], mode: "open" | "loop", limit = Infinity): RouteMatch {
  if (!matches.length) return { distanceM: Infinity, alongM: 0, vertex: 0 };
  const best = matches.reduce((a, b) => b.distanceM < a.distanceM ? b : a);
  if (mode !== "loop") return best;
  const threshold = Math.min(limit, best.distanceM + 15);
  // Descend to the local minimum of the earliest passage, as routeLegCuts does for vertices.
  const ordered = matches.sort((a, b) => a.vertex - b.vertex);
  let index = ordered.findIndex(m => m.distanceM <= threshold);
  if (index < 0) return best;
  while (index + 1 < ordered.length && ordered[index + 1].vertex === ordered[index].vertex + 1 && ordered[index + 1].distanceM < ordered[index].distanceM) index += 1;
  return ordered[index];
}
export function distanceToRoute(point: Coordinates, geometry: Coordinates[], { mode = "open" }: { mode?: "open" | "loop" } = {}): RouteMatch {
  if (geometry.length === 1) return { distanceM: distance(point, geometry[0]), alongM: 0, vertex: 0 };
  return bestMatch(segmentsFor(geometry).map(s => project(point, s)), mode);
}

/** Build once per batch. Segment buckets avoid a full route scan for every place. */
export function placesAlongRoute(places: FoodPlace[], geometry: Coordinates[], { maxDistanceM = 150, mode = "open", stats }: {
  maxDistanceM?: number; mode?: "open" | "loop"; stats?: ProximityStats;
} = {}): Array<FoodPlace & RouteMatch> {
  if (stats) { stats.checkedPairs = 0; stats.bboxRejected = 0; }
  if (!geometry.length || !Number.isFinite(maxDistanceM) || maxDistanceM < 0) return [];
  const south = Math.min(...geometry.map(p => p.lat)), north = Math.max(...geometry.map(p => p.lat));
  const west = Math.min(...geometry.map(p => p.lon)), east = Math.max(...geometry.map(p => p.lon));
  const origin = geometry[0], sx = scaleX((south + north) / 2);
  const size = Math.max(50, maxDistanceM);
  const xy = (p: Coordinates) => ({ x: (p.lon - origin.lon) * sx, y: (p.lat - origin.lat) * M_PER_DEG });
  const segments = segmentsFor(geometry), buckets = new Map<string, Set<number>>();
  for (const s of segments) {
    const a = xy(s.a), b = xy(s.b), steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / (size / 2)));
    // Sampling plus one extra query bucket conservatively covers even a corner crossing.
    for (let i = 0; i <= steps; i += 1) {
      const key = `${Math.floor((a.x + (b.x - a.x) * i / steps) / size)}:${Math.floor((a.y + (b.y - a.y) * i / steps) / size)}`;
      if (!buckets.has(key)) buckets.set(key, new Set());
      buckets.get(key)!.add(s.vertex);
    }
  }
  const result: Array<FoodPlace & RouteMatch> = [];
  for (const p of places) {
    const dx = maxDistanceM / Math.max(1e-9, Math.abs(scaleX(p.lat))), dy = maxDistanceM / M_PER_DEG;
    if (p.lat < south - dy || p.lat > north + dy || p.lon < west - dx || p.lon > east + dx) { if (stats) stats.bboxRejected += 1; continue; }
    let match: RouteMatch;
    if (geometry.length === 1) match = distanceToRoute(p, geometry);
    else {
      const pos = xy(p), rx = maxDistanceM * Math.abs(sx / Math.max(1e-9, scaleX(p.lat)));
      const candidates = new Set<number>();
      for (let x = Math.floor((pos.x - rx) / size) - 1; x <= Math.floor((pos.x + rx) / size) + 1; x += 1) {
        for (let y = Math.floor((pos.y - maxDistanceM) / size) - 1; y <= Math.floor((pos.y + maxDistanceM) / size) + 1; y += 1) {
          for (const index of buckets.get(`${x}:${y}`) ?? []) candidates.add(index);
        }
      }
      if (stats) stats.checkedPairs += candidates.size;
      match = bestMatch([...candidates].map(i => project(p, segments[i])), mode, maxDistanceM);
    }
    if (match.distanceM <= maxDistanceM) result.push({ ...p, ...match });
  }
  return result.sort((a, b) => a.alongM - b.alongM || a.id.localeCompare(b.id));
}

/** Conservative segment envelopes include neighbouring cells at exact grid lines. */
export function cellsForRoute(geometry: Coordinates[], cellSize = 0.05, bufferM = 150): string[] {
  if (!Number.isFinite(cellSize) || cellSize <= 0 || !Number.isFinite(bufferM) || bufferM < 0) return [];
  const factor = 1 / cellSize, keys = new Set<string>();
  for (let i = 0; i < geometry.length; i += 1) {
    const a = geometry[i], b = geometry[Math.min(i + 1, geometry.length - 1)];
    const dy = bufferM / M_PER_DEG, dx = bufferM / Math.max(1e-9, Math.min(Math.abs(scaleX(a.lat)), Math.abs(scaleX(b.lat))));
    const loLat = Math.max(-90, Math.min(a.lat, b.lat) - dy), hiLat = Math.min(90, Math.max(a.lat, b.lat) + dy);
    const loLon = Math.max(-180, Math.min(a.lon, b.lon) - dx), hiLon = Math.min(180, Math.max(a.lon, b.lon) + dx);
    for (let lat = Math.max(Math.floor(-90 * factor), Math.ceil(loLat * factor) - 1); lat <= Math.min(Math.ceil(90 * factor) - 1, Math.floor(hiLat * factor)); lat += 1) {
      for (let lon = Math.max(Math.floor(-180 * factor), Math.ceil(loLon * factor) - 1); lon <= Math.min(Math.ceil(180 * factor) - 1, Math.floor(hiLon * factor)); lon += 1) keys.add(`${lat || 0}:${lon || 0}`);
    }
  }
  return [...keys].sort((a, b) => { const aa = a.split(":").map(Number), bb = b.split(":").map(Number); return aa[0] - bb[0] || aa[1] - bb[1]; });
}
export const formatRouteDistance = (distanceM: number) => `≈ ${Math.round(distanceM)} м от маршрута`;
export function nearestStop(alongM: number, stops: Array<{ alongM: number }>): number | null {
  if (!stops.length) return null;
  let best = 0;
  for (let i = 1; i < stops.length; i += 1) if (Math.abs(stops[i].alongM - alongM) < Math.abs(stops[best].alongM - alongM)) best = i;
  return best;
}
export function formatNearbyStop(alongM: number, stops: Array<{ alongM: number }>): string | null {
  const index = nearestStop(alongM, stops);
  return index === null ? null : `рядом с остановкой ${index + 1}`;
}

/** Cumulative vertex distances use the same segment lengths as place projections. */
export function routeVertexDistances(geometry: Coordinates[]): number[] {
  let along = 0;
  return geometry.map((point, i) => { if (i) along += distance(geometry[i - 1], point); return along; });
}
export function matchedRoutePoint(match: RouteMatch, geometry: Coordinates[], distances = routeVertexDistances(geometry)): Coordinates | null {
  const a = geometry[match.vertex], b = geometry[match.vertex + 1];
  if (!a) return null;
  if (!b) return a;
  const length = distances[match.vertex + 1] - distances[match.vertex];
  const t = length ? Math.max(0, Math.min(1, (match.alongM - distances[match.vertex]) / length)) : 0;
  return { lat: a.lat + t * (b.lat - a.lat), lon: a.lon + t * (b.lon - a.lon) };
}
