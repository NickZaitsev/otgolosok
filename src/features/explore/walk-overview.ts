import type { ReviewSummary } from "../reviews/model";
import { fetchWithRetry, RequestError } from "../walk-builder/request";
import { CATALOG_WALK_ID, record, validateWalkCard, WALK_UUID } from "../walks/top-model";
import type { CatalogBounds, MapViewport } from "./catalog-bounds";

export const WALK_OVERVIEW_URL = "/api/walks/map";
export const WALK_OVERVIEW_TOGGLE_KEY = "otgolosok:around:walks:v1";
/** Loaded areas are trusted this long; after that a view inside them asks the server again. */
export const WALK_OVERVIEW_TTL_MS = 10 * 60_000;
/** How close to a line a tap still selects it, in screen pixels: a finger, not a cursor. */
export const WALK_HIT_TOLERANCE_PX = 16;
/** Colours of the overview lines, as CSS custom properties of tokens.css. */
export const WALK_OVERVIEW_COLORS = 6;
/**
 * The only region with walks: Moscow with New Moscow and Zelenograd. A request never leaves it,
 * so a zoomed-out desktop view stays within the server's span limit.
 */
export const WALK_REGION: CatalogBounds = { west: 36.8, south: 55.1, east: 38.4, north: 56.2 };
/** Requested edges snap outward to this grid: neighbouring views share a request and it reveals less of where one looks. */
const GRID = 0.01;
const AREA_HISTORY = 8;

/** A public walk drawn as an overview line; `key` is unique across kinds. */
export type MapWalk = {
  key: string;
  kind: "catalog" | "shared";
  id: string;
  title: string;
  walkingMinutes: number;
  distanceM: number;
  stopCount: number;
  rating: ReviewSummary;
  line: Array<[number, number]>;
  bounds: CatalogBounds;
};

function validateMapWalk(raw: unknown): MapWalk {
  const item = record(raw);
  if (item.kind !== "catalog" && item.kind !== "shared") throw new TypeError("Неверный вид прогулки.");
  const id = item.id;
  if (typeof id !== "string" || !(item.kind === "catalog" ? CATALOG_WALK_ID : WALK_UUID).test(id)) throw new TypeError("Неверный идентификатор прогулки.");
  const line = item.line;
  if (!Array.isArray(line) || line.length < 2 || line.length > 20_000 || !line.every(point => Array.isArray(point) && point.length === 2
    && Number.isFinite(point[0]) && Math.abs(point[0]) <= 90 && Number.isFinite(point[1]) && Math.abs(point[1]) <= 180)) throw new TypeError("Неверная линия прогулки.");
  const points = line as Array<[number, number]>;
  let south = 90, north = -90, west = 180, east = -180;
  for (const [lat, lon] of points) { south = Math.min(south, lat); north = Math.max(north, lat); west = Math.min(west, lon); east = Math.max(east, lon); }
  return { key: `${item.kind}:${id}`, kind: item.kind, id, ...validateWalkCard(item), line: points, bounds: { west, south, east, north } };
}

/** `complete` is false when the server's limit cut the list (an older server never cuts it). */
export function validateMapWalks(value: unknown): { walks: MapWalk[]; complete: boolean } {
  const body = record(value), walks = body.walks;
  if (!Array.isArray(walks)) throw new TypeError("Ожидался список прогулок.");
  if (body.complete !== undefined && typeof body.complete !== "boolean") throw new TypeError("Неверный признак полноты.");
  return { walks: walks.map(validateMapWalk), complete: body.complete !== false };
}

/** A stable colour per walk (1-based token index), so a walk keeps its colour across visits. */
export function walkColorIndex(key: string) {
  let hash = 0;
  for (let index = 0; index < key.length; index += 1) hash = (hash * 31 + key.charCodeAt(index)) | 0;
  return (Math.abs(hash) % WALK_OVERVIEW_COLORS) + 1;
}

const mercatorY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360));
const latitude = (y: number) => (2 * Math.atan(Math.exp(y)) - Math.PI / 2) * 180 / Math.PI;

export const intersects = (a: CatalogBounds, b: CatalogBounds) => a.west <= b.east && a.east >= b.west && a.south <= b.north && a.north >= b.south;
export const contains = (outer: CatalogBounds, inner: CatalogBounds) =>
  outer.west <= inner.west && outer.east >= inner.east && outer.south <= inner.south && outer.north >= inner.north;

/**
 * The area to load for a view: twice the visible width and height (the viewport's required
 * bounds already carry half a zoom step, √2), snapped outward and clipped to {@link WALK_REGION};
 * null when the view is outside the region.
 */
export function overviewArea(viewport: Pick<MapViewport, "required">): CatalogBounds | null {
  const { west, east, south, north } = viewport.required;
  const scale = Math.SQRT2;
  const halfX = (east - west) / 2 * scale, midX = (east + west) / 2;
  const top = mercatorY(Math.min(85, north)), bottom = mercatorY(Math.max(-85, south));
  const halfY = (top - bottom) / 2 * scale, midY = (top + bottom) / 2;
  const area = {
    west: Math.max(WALK_REGION.west, Math.floor((midX - halfX) / GRID) * GRID),
    east: Math.min(WALK_REGION.east, Math.ceil((midX + halfX) / GRID) * GRID),
    south: Math.max(WALK_REGION.south, Math.floor(latitude(midY - halfY) / GRID) * GRID),
    north: Math.min(WALK_REGION.north, Math.ceil(latitude(midY + halfY) / GRID) * GRID),
  };
  if (area.west >= area.east || area.south >= area.north) return null;
  // Snapping in floating point leaves tails like 37.580000000000005; the server takes six decimals.
  const fixed = (value: number) => Number(value.toFixed(2));
  return { west: fixed(area.west), south: fixed(area.south), east: fixed(area.east), north: fixed(area.north) };
}

export function overviewUrl(area: CatalogBounds) {
  const value = (number: number) => number.toFixed(2);
  return `${WALK_OVERVIEW_URL}?west=${value(area.west)}&south=${value(area.south)}&east=${value(area.east)}&north=${value(area.north)}`;
}

type Point = { x: number; y: number };
function segmentDistance(p: Point, a: Point, b: Point) {
  const dx = b.x - a.x, dy = b.y - a.y, lengthSquared = dx * dx + dy * dy;
  const ratio = lengthSquared ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared)) : 0;
  return Math.hypot(p.x - a.x - ratio * dx, p.y - a.y - ratio * dy);
}

/** Lines passing within the tolerance of a tap, nearest first: overlapping walks are all offered. */
export function walksAtPoint(point: Point, lines: ReadonlyArray<{ key: string; pixels: Point[] }>, tolerance = WALK_HIT_TOLERANCE_PX): string[] {
  return lines.flatMap(({ key, pixels }) => {
    let nearest = Infinity;
    for (let index = 1; index < pixels.length; index += 1) nearest = Math.min(nearest, segmentDistance(point, pixels[index - 1], pixels[index]));
    return nearest <= tolerance ? [{ key, nearest }] : [];
  }).sort((a, b) => a.nearest - b.nearest || (a.key < b.key ? -1 : 1)).map(hit => hit.key);
}

export type WalkOverviewSnapshot = {
  /** Every loaded walk, in the server's ranking order of first arrival. */
  walks: MapWalk[];
  status: "idle" | "loading" | "ready" | "error";
  /** The server has no walk store (503 UNAVAILABLE): the layer is switched off rather than retried. */
  unavailable: boolean;
};

/**
 * Overview walks loaded by area and kept for the session: a view already covered by a fresh
 * loaded area makes no request, a new one loads twice the view. Walks are merged by key; an
 * area's reply also drops walks that left it (unpublished or moved).
 */
export function createWalkOverviewStore({ fetch = fetchWithRetry, now = Date.now }: { fetch?: typeof fetchWithRetry; now?: () => number } = {}) {
  const walks = new Map<string, MapWalk>();
  /** Loaded areas; an incomplete one (cut by the server's limit) only spares repeating its own request. */
  let areas: Array<{ bounds: CatalogBounds; at: number; complete: boolean }> = [];
  let current: WalkOverviewSnapshot = { walks: [], status: "idle", unavailable: false };
  let inflight: { url: string; controller: AbortController; promise: Promise<void> } | null = null;
  let last: CatalogBounds | null = null;
  const listeners = new Set<() => void>();
  const publish = (patch: Partial<WalkOverviewSnapshot>) => {
    current = { ...current, ...patch };
    for (const listener of listeners) listener();
  };
  const fresh = (area: { at: number }) => now() - area.at < WALK_OVERVIEW_TTL_MS;
  const covered = (view: CatalogBounds) => areas.some(area => area.complete && fresh(area) && contains(area.bounds, view));
  const same = (a: CatalogBounds, b: CatalogBounds) => a.west === b.west && a.south === b.south && a.east === b.east && a.north === b.north;
  const requested = (bounds: CatalogBounds) => areas.some(area => fresh(area) && same(area.bounds, bounds));

  async function load(area: CatalogBounds) {
    const url = overviewUrl(area);
    if (inflight?.url === url) return inflight.promise;
    // Only the latest view matters: a fast pan cancels the request for the area it left.
    inflight?.controller.abort();
    const controller = new AbortController();
    last = area;
    publish({ status: "loading" });
    const promise = (async () => {
      try {
        const response = await fetch(url, controller.signal, { noRetryStatuses: [503] });
        const { walks: loaded, complete } = validateMapWalks(await response.json());
        if (controller.signal.aborted) return;
        // Only a full answer proves that a missing walk left the area; a cut one may have skipped it.
        if (complete) {
          const present = new Set(loaded.map(walk => walk.key));
          for (const [key, walk] of walks) if (!present.has(key) && intersects(walk.bounds, area)) walks.delete(key);
        }
        for (const walk of loaded) walks.set(walk.key, walk);
        areas = [...areas.filter(known => !(complete ? contains(area, known.bounds) : same(area, known.bounds))), { bounds: area, at: now(), complete }].slice(-AREA_HISTORY);
        publish({ walks: [...walks.values()], status: "ready", unavailable: false });
      } catch (error) {
        if (controller.signal.aborted) return;
        // Only a server without the walk store turns the layer off; maintenance and other 503s can be retried.
        if (error instanceof RequestError && error.status === 503 && error.code === "UNAVAILABLE") publish({ status: "error", unavailable: true });
        else publish({ status: "error" });
      } finally {
        if (inflight?.controller === controller) inflight = null;
      }
    })();
    inflight = { url, controller, promise };
    return promise;
  }

  return {
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    snapshot: () => current,
    /** Loads twice the view unless a fresh loaded area already covers it. */
    ensure(viewport: Pick<MapViewport, "required">) {
      if (current.unavailable) return Promise.resolve();
      const area = overviewArea(viewport);
      if (!area) return Promise.resolve();
      // The visible view (within the required bounds) decides; the doubled area is only what gets loaded.
      if (covered(viewport.required) || requested(area)) {
        // Back inside loaded walks: a request or an error for the area just left no longer concerns this view.
        inflight?.controller.abort();
        inflight = null;
        last = area;
        if (current.status !== "ready") publish({ status: "ready" });
        return Promise.resolve();
      }
      return load(area);
    },
    retry() { return last ? load(last) : Promise.resolve(); },
    /** Stops a request nobody waits for (the layer was switched off). */
    cancel() {
      inflight?.controller.abort();
      inflight = null;
      if (current.status === "loading") publish({ status: walks.size ? "ready" : "idle" });
    },
  };
}
export type WalkOverviewStore = ReturnType<typeof createWalkOverviewStore>;
export const walkOverviewStore = createWalkOverviewStore();
