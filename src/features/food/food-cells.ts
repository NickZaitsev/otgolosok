import { bareEtag, createCacheStorage, createCellStore, type CellStorage, type ManifestCell } from "../../lib/geo/cell-store";
import type { CatalogBounds } from "../explore/catalog-bounds";
import { fetchWithRetry, RequestError } from "../walk-builder/request";
import type { FoodPlace } from "./types";
export type { FoodPlace, FoodKind } from "./types";

export const FOOD_MANIFEST_URL = "/api/food/cells";
export const FOOD_CELL_SIZE = 0.05;
export const FOOD_CACHE_NAME = "food-cells-v1";
export type FoodManifest = { version: 1; cellSize: number; sourceEditedAt: string; attribution: string; cells: Array<{ lat: number; lon: number; count: number; etag: string }> };
const integer = (v: unknown, min: number, max: number): v is number => Number.isSafeInteger(v) && !Object.is(v, -0) && (v as number) >= min && (v as number) <= max;
const invalid = () => new Error("Некорректные данные заведений.");
export const foodCellKey = (lat: number, lon: number) => `${Math.max(-1800, Math.min(1799, Math.floor(lat * 20))) || 0}:${Math.max(-3600, Math.min(3599, Math.floor(lon * 20))) || 0}`;

export function foodCellsFor(keys: Iterable<string>, bounds: CatalogBounds): string[] {
  return [...keys].filter(key => {
    const [lat, lon] = key.split(":").map(Number);
    return lat / 20 <= bounds.north && (lat + 1) / 20 >= bounds.south && lon / 20 <= bounds.east && (lon + 1) / 20 >= bounds.west;
  });
}
export function parseFoodManifest(value: unknown): FoodManifest {
  const m = value as FoodManifest | null;
  if (!m || m.version !== 1 || m.cellSize !== FOOD_CELL_SIZE || typeof m.sourceEditedAt !== "string" || !Number.isFinite(Date.parse(m.sourceEditedAt))
    || typeof m.attribution !== "string" || !m.attribution.trim() || !Array.isArray(m.cells)) throw invalid();
  const keys = new Set<string>();
  for (const c of m.cells) {
    if (!c || !integer(c.lat, -1800, 1799) || !integer(c.lon, -3600, 3599) || !integer(c.count, 0, Number.MAX_SAFE_INTEGER)
      || typeof c.etag !== "string" || !/^[a-f0-9]{32}$/.test(c.etag) || keys.has(`${c.lat}:${c.lon}`)) throw invalid();
    keys.add(`${c.lat}:${c.lon}`);
  }
  return m;
}
export function parseFoodCell(value: unknown, key: string): FoodPlace[] {
  const cell = value as { lat: number; lon: number; places: FoodPlace[] } | null;
  if (!cell || !integer(cell.lat, -1800, 1799) || !integer(cell.lon, -3600, 3599) || `${cell.lat}:${cell.lon}` !== key || !Array.isArray(cell.places)) throw invalid();
  const ids = new Set<string>();
  for (const p of cell.places) {
    if (!p || typeof p.id !== "string" || !/^osm:(node|way|relation):\d+$/.test(p.id) || ids.has(p.id)
      || !["coffee", "cafe", "restaurant", "fast_food", "bakery", "bar"].includes(p.kind) || typeof p.name !== "string" || !p.name.trim()
      || !Number.isFinite(p.lat) || Math.abs(p.lat) > 90 || !Number.isFinite(p.lon) || Math.abs(p.lon) > 180 || foodCellKey(p.lat, p.lon) !== key
      || ![p.address, p.openingHours, p.cuisine, p.website, p.phone].every(v => v === null || typeof v === "string")
      || p.website !== null && !/^https?:\/\//i.test(p.website)) throw invalid();
    ids.add(p.id);
  }
  return cell.places;
}

/** 503 disables this feature; other transient errors use the shared bounded backoff. */
export const fetchFoodWithRetry: typeof fetchWithRetry = (path, signal, init = {}) => fetchWithRetry(path, signal, { ...init, noRetryStatuses: [503] });
export function createFoodCellStore({ storage = createCacheStorage(FOOD_CACHE_NAME), fetch = fetchFoodWithRetry, now = Date.now }: {
  storage?: CellStorage; fetch?: typeof fetchWithRetry; now?: () => number;
} = {}) {
  let manifest: FoodManifest | null = null;
  const core = createCellStore<FoodPlace>({ storage, fetch, now, manifestUrl: FOOD_MANIFEST_URL, cellsFor: foodCellsFor,
    isUnavailable: error => error instanceof RequestError && error.status === 503,
    parseManifest: value => {
      const parsed = parseFoodManifest(value);
      manifest = parsed;
      return new Map<string, ManifestCell>(parsed.cells.map(c => [`${c.lat}:${c.lon}`, { count: c.count, etag: c.etag }]));
    }, parseCell: parseFoodCell });
  const makeSnapshot = () => { const s = core.snapshot(); return { ...s, places: s.points, unavailable: s.maintenance, manifest }; };
  let previous = core.snapshot(), current = makeSnapshot();
  const snapshot = () => {
    if (previous !== core.snapshot()) { previous = core.snapshot(); current = makeSnapshot(); }
    return current;
  };
  return { ...core, snapshot,
    seedOffline(input: Parameters<typeof core.seedOffline>[0]) {
      const parsed = parseFoodManifest(input.manifest), keys = new Set<string>();
      for (const c of input.cells) {
        const expected = parsed.cells.find(cell => `${cell.lat}:${cell.lon}` === c.key);
        if (keys.has(c.key) || !expected || expected.etag !== bareEtag(c.etag) || parseFoodCell(c.body, c.key).length !== expected.count) throw invalid();
        keys.add(c.key);
      }
      core.seedOffline(input);
    },
    async loadManifest() { await core.ensureManifest(); return manifest; },
    async loadKeys(keys: Iterable<string>) {
      const selected = [...new Set(keys)];
      await core.ensureKeys(selected);
      const wanted = new Set(selected);
      return snapshot().places.filter(p => wanted.has(foodCellKey(p.lat, p.lon)));
    },
    async loadArea(bounds: CatalogBounds) {
      await core.ensureArea(bounds);
      return snapshot().places.filter(p => p.lat >= bounds.south && p.lat <= bounds.north && p.lon >= bounds.west && p.lon <= bounds.east);
    },
  };
}
export const foodCellStore = createFoodCellStore();
