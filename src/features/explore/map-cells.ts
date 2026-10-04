import { createCellStore, createCacheStorage as sharedCacheStorage, type CellSnapshot, type CellStorage, type CellStatus } from "../../lib/geo/cell-store";
import type { CatalogBounds } from "./catalog-bounds";
import { RequestError, fetchWithRetry } from "../walk-builder/request";

/** Wire format of one slim map point (`GET /api/content/map-cells/{lat}/{lon}`). */
/** `photo` is present (true) only for a place with a photo, so the card can reserve the preview slot before the detail loads. */
export type MapPoint = { id: string; lat: number; lon: number; title: string; address: string; durationSec: number | null; facts: number; sources: number; photo?: boolean };
export type CatalogPoint = {
  id: string; location: { lat: number; lon: number }; title: string; address: string;
  durationSec: number | null; facts: number; sources: number; photo: boolean;
};
type ManifestCell = { count: number; etag: string };
export { REVALIDATE_MS } from "../../lib/geo/cell-store";
export type { CellStorage, CellStatus } from "../../lib/geo/cell-store";
export type MapCellSnapshot = CellSnapshot<CatalogPoint>;
type Fetcher = typeof fetchWithRetry;

export const MANIFEST_URL = "/api/content/map-cells";
export const CELL_CACHE_NAME = "map-cells-v1";
export const cellUrl = (key: string) => `${MANIFEST_URL}/${key.replace(":", "/")}`;

export function isServiceMaintenance(error: unknown) {
  return error instanceof RequestError && error.status === 503 && error.code === "SERVICE_MAINTENANCE";
}

/**
 * Manifest cells whose square [lat, lat+1] × [lon, lon+1] intersects the rectangle; touching edges count.
 * Iterating the manifest (a handful of cells) instead of every 1° key keeps a wrapped world view
 * (−180…180, 64,800 keys) and the minimum zoom cheap.
 */
export function cellsFor(manifestKeys: Iterable<string>, bounds: CatalogBounds): string[] {
  const keys: string[] = [];
  for (const key of manifestKeys) {
    const [lat, lon] = key.split(":").map(Number);
    if (lat <= bounds.north && lat + 1 >= bounds.south && lon <= bounds.east && lon + 1 >= bounds.west) keys.push(key);
  }
  return keys;
}

const isInteger = (value: unknown, min: number, max: number): value is number => Number.isSafeInteger(value) && (value as number) >= min && (value as number) <= max;
const isCount = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;

function parseManifest(value: unknown): Map<string, ManifestCell> {
  const manifest = value as { version?: unknown; cellSize?: unknown; cells?: unknown } | null;
  if (!manifest || typeof manifest !== "object" || manifest.version !== 1 || manifest.cellSize !== 1 || !Array.isArray(manifest.cells)) {
    throw new Error("Некорректный список областей карты.");
  }
  const cells = new Map<string, ManifestCell>();
  for (const cell of manifest.cells as Array<Record<string, unknown>>) {
    if (!cell || typeof cell !== "object" || !isInteger(cell.lat, -90, 89) || !isInteger(cell.lon, -180, 179) || !isCount(cell.count)
      || typeof cell.etag !== "string" || !/^[0-9a-f]{32}$/.test(cell.etag)) throw new Error("Некорректный список областей карты.");
    cells.set(`${cell.lat}:${cell.lon}`, { count: cell.count, etag: cell.etag });
  }
  return cells;
}

function parseCell(value: unknown, key: string): CatalogPoint[] {
  const cell = value as { lat?: unknown; lon?: unknown; points?: unknown } | null;
  if (!cell || typeof cell !== "object" || `${cell.lat}:${cell.lon}` !== key || !Array.isArray(cell.points)) throw new Error("Некорректная область карты.");
  return (cell.points as Array<Record<string, unknown>>).map(point => {
    if (!point || typeof point !== "object" || typeof point.id !== "string" || !point.id
      || typeof point.lat !== "number" || !Number.isFinite(point.lat) || typeof point.lon !== "number" || !Number.isFinite(point.lon)
      || typeof point.title !== "string" || typeof point.address !== "string"
      || !(point.durationSec === null || typeof point.durationSec === "number" && Number.isFinite(point.durationSec) && point.durationSec > 0)
      || !isCount(point.facts) || !isCount(point.sources) || !(point.photo === undefined || point.photo === true)) throw new Error("Некорректная область карты.");
    return { id: point.id, location: { lat: point.lat, lon: point.lon }, title: point.title, address: point.address,
      durationSec: point.durationSec as number | null, facts: point.facts, sources: point.sources, photo: point.photo === true };
  });
}

export const createCacheStorage = (name = CELL_CACHE_NAME) => sharedCacheStorage(name, "map-cells-");

export function createMapCellStore({ storage = createCacheStorage(), fetch = fetchWithRetry, now = Date.now }: {
  storage?: CellStorage; fetch?: Fetcher; now?: () => number;
} = {}) {
  return createCellStore<CatalogPoint>({ storage, fetch, now, manifestUrl: MANIFEST_URL, parseManifest, parseCell, cellsFor, isUnavailable: isServiceMaintenance });
}
export type MapCellStore = ReturnType<typeof createMapCellStore>;

/**
 * Status of an area: loading or error only for its cells without any copy; revalidating cached data is silent.
 * An area crossing a cell line stays loading until every cell is ready, so nothing is computed from half of it.
 */
export function areaStatus(snapshot: MapCellSnapshot, bounds: CatalogBounds): CellStatus {
  if (!snapshot.manifestKeys) return snapshot.manifestStatus === "error" ? "error" : "loading";
  let result: CellStatus = "ready";
  for (const key of cellsFor(snapshot.manifestKeys, bounds)) {
    if (snapshot.loadedKeys.has(key)) continue;
    if (snapshot.cellStatus.get(key) === "error") return "error";
    result = "loading";
  }
  return result;
}

/** Module-level store: survives `AroundScreen` remounts within the session. */
export const mapCellStore = createMapCellStore();
