import { createCacheStorage, createCellStore, type CellStorage, type ManifestCell } from "@/lib/geo/cell-store";
import type { CatalogBounds } from "../explore/catalog-bounds";
import { fetchWithRetry, RequestError } from "../walk-builder/request";
import { isParkingPlace } from "./parking-client";
import type { ParkingPlace } from "./types";

export const PARKING_MANIFEST_URL = "/api/parking/cells";
export const PARKING_CACHE_NAME = "parking-cells-v1";
export type ParkingManifest = {
  version: 1;
  cellSize: number;
  sourceEditedAt: string;
  attribution: string;
  cells: Array<{ lat: number; lon: number; count: number; etag: string }>;
};

const invalid = () => new Error("Некорректные данные парковок.");
const integer = (value: unknown, min: number, max: number): value is number =>
  Number.isSafeInteger(value) && !Object.is(value, -0) && (value as number) >= min && (value as number) <= max;

export function parkingCellKey(location: { lat: number; lon: number }, cellSize: number) {
  const factor = Math.round(1 / cellSize);
  return `${Math.floor(location.lat * factor) || 0}:${Math.floor(location.lon * factor) || 0}`;
}

export function parkingCellsFor(keys: Iterable<string>, bounds: CatalogBounds, cellSize = 0.05): string[] {
  const factor = Math.round(1 / cellSize);
  return [...keys].filter(key => {
    const [lat, lon] = key.split(":").map(Number);
    return lat / factor <= bounds.north && (lat + 1) / factor >= bounds.south
      && lon / factor <= bounds.east && (lon + 1) / factor >= bounds.west;
  });
}

export function parseParkingManifest(value: unknown): ParkingManifest {
  const manifest = value as ParkingManifest | null;
  if (!manifest || manifest.version !== 1 || typeof manifest.cellSize !== "number" || manifest.cellSize <= 0 || manifest.cellSize > 1
    || typeof manifest.sourceEditedAt !== "string" || !Number.isFinite(Date.parse(manifest.sourceEditedAt))
    || typeof manifest.attribution !== "string" || !manifest.attribution.trim() || !Array.isArray(manifest.cells)) throw invalid();
  const factor = Math.round(1 / manifest.cellSize), keys = new Set<string>();
  for (const cell of manifest.cells) {
    const key = `${cell?.lat}:${cell?.lon}`;
    if (!cell || !integer(cell.lat, -90 * factor, 90 * factor - 1) || !integer(cell.lon, -180 * factor, 180 * factor - 1)
      || !integer(cell.count, 0, Number.MAX_SAFE_INTEGER) || typeof cell.etag !== "string" || !/^[a-f0-9]{32}$/.test(cell.etag)
      || keys.has(key)) throw invalid();
    keys.add(key);
  }
  return manifest;
}

export function parseParkingCell(value: unknown, key: string, cellSize: number): ParkingPlace[] {
  const cell = value as { lat: number; lon: number; places: ParkingPlace[] } | null;
  if (!cell || `${cell.lat}:${cell.lon}` !== key || !Array.isArray(cell.places)) throw invalid();
  const ids = new Set<string>();
  for (const place of cell.places) {
    if (!isParkingPlace(place) || ids.has(place.id) || parkingCellKey(place.location, cellSize) !== key) throw invalid();
    ids.add(place.id);
  }
  return cell.places;
}

export function createParkingCellStore({ storage = createCacheStorage(PARKING_CACHE_NAME), fetch = fetchWithRetry, now = Date.now }: {
  storage?: CellStorage; fetch?: typeof fetchWithRetry; now?: () => number;
} = {}) {
  let manifest: ParkingManifest | null = null;
  const core = createCellStore<ParkingPlace>({
    storage, fetch, now, manifestUrl: PARKING_MANIFEST_URL,
    cellsFor: (keys, bounds) => parkingCellsFor(keys, bounds, manifest?.cellSize),
    isUnavailable: error => error instanceof RequestError && error.status === 503,
    parseManifest: value => {
      manifest = parseParkingManifest(value);
      return new Map<string, ManifestCell>(manifest.cells.map(cell => [`${cell.lat}:${cell.lon}`, { count: cell.count, etag: cell.etag }]));
    },
    parseCell: (value, key) => parseParkingCell(value, key, manifest?.cellSize ?? 0.05),
  });
  let previous = core.snapshot();
  let current: ReturnType<typeof core.snapshot> & { places: ParkingPlace[]; unavailable: boolean; manifest: ParkingManifest | null } = { ...previous, places: previous.points, unavailable: previous.maintenance, manifest };
  const snapshot = () => {
    const next = core.snapshot();
    if (previous !== next) { previous = next; current = { ...next, places: next.points, unavailable: next.maintenance, manifest }; }
    return current;
  };
  return { ...core, snapshot, async loadManifest() { await core.ensureManifest(); return manifest; },
    async loadArea(bounds: CatalogBounds) { await core.ensureArea(bounds); return snapshot().places; } };
}

export const parkingCellStore = createParkingCellStore();
