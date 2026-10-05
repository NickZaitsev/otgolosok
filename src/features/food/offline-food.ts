import { bareEtag } from "../../lib/geo/cell-store";
import { RequestError } from "../walk-builder/request";
import type { Coordinates } from "../tour/types";
import { FOOD_MANIFEST_URL, fetchFoodWithRetry, foodCellStore, parseFoodCell, parseFoodManifest, type FoodManifest } from "./food-cells";
import { cellsForRoute } from "./route-proximity";

export type OfflineFood = { sourceEditedAt: string; attribution: string; cells: Array<{ key: string; etag: string; bytes: number }> };
export type OfflineFoodBundle = { manifest: FoodManifest; cells: Array<{ key: string; etag: string; body: string; bytes: number }> };
const byteLength = (body: string) => new TextEncoder().encode(body).byteLength;
/** Food of one walk: about four cells of a few hundred kilobytes; a bigger copy is skipped, not the walk. */
export const OFFLINE_FOOD_MAX_BYTES = 4 * 1024 * 1024;

/** Food is optional: a partial download or a spent budget leaves the walk usable. */
export async function downloadOfflineFood(geometry: Coordinates[], maxBytes: number, fetcher = fetchFoodWithRetry, signal = new AbortController().signal): Promise<{ bundle: OfflineFoodBundle | null; warning: boolean }> {
  if (geometry.length < 2) return { bundle: null, warning: false };
  let available = Boolean(foodCellStore.snapshot().manifest && !foodCellStore.snapshot().unavailable);
  try {
    const response = await fetcher(FOOD_MANIFEST_URL, signal);
    const body = await response.text();
    const manifest = parseFoodManifest(JSON.parse(body));
    available = true;
    let bytes = byteLength(JSON.stringify(manifest));
    if (bytes > maxBytes) throw new Error("Офлайн-комплект заведений слишком большой.");
    const wanted = new Set(cellsForRoute(geometry));
    const cells: OfflineFoodBundle["cells"] = [];
    for (const c of manifest.cells.filter(c => wanted.has(`${c.lat}:${c.lon}`))) {
      const key = `${c.lat}:${c.lon}`;
      const response = await fetcher(`${FOOD_MANIFEST_URL}/${c.lat}/${c.lon}`, signal);
      const body = await response.text();
      const points = parseFoodCell(JSON.parse(body), key);
      if (bareEtag(response.headers.get("ETag")) !== c.etag || points.length !== c.count) throw new Error("Данные заведений изменились во время сохранения.");
      const size = byteLength(body);
      bytes += size;
      if (bytes > maxBytes) throw new Error("Офлайн-комплект заведений слишком большой.");
      cells.push({ key, etag: c.etag, body, bytes: size });
    }
    return { bundle: { manifest, cells }, warning: false };
  } catch (error) {
    return { bundle: null, warning: available && !(error instanceof RequestError && error.status === 503) };
  }
}

export function offlineFoodSummary(bundle: OfflineFoodBundle): OfflineFood {
  return { sourceEditedAt: bundle.manifest.sourceEditedAt, attribution: bundle.manifest.attribution,
    cells: bundle.cells.map(({ key, etag, bytes }) => ({ key, etag, bytes })) };
}

/** A newer manifest already in memory wins: an old package must not roll the store back. */
export function seedOfflineFood(bundle: OfflineFoodBundle) {
  const live = foodCellStore.snapshot().manifest;
  if (live && Date.parse(live.sourceEditedAt) > Date.parse(bundle.manifest.sourceEditedAt)) return;
  foodCellStore.seedOffline({ manifest: bundle.manifest, cells: bundle.cells.map(c => ({ ...c, body: JSON.parse(c.body) })) });
}
