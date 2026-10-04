import type { CatalogBounds } from "../../features/explore/catalog-bounds";
import { fetchWithRetry } from "../../features/walk-builder/request";

export type ManifestCell = { count: number; etag: string };
export type CellStatus = "ready" | "loading" | "error";
export type CellSnapshot<T> = {
  points: T[];
  /** Cells listed by the manifest; null until any manifest (memory, storage or network) is known. */
  manifestKeys: ReadonlySet<string> | null;
  /** Cells with data in memory, possibly older than the manifest while it is revalidated. */
  loadedKeys: ReadonlySet<string>;
  cellStatus: ReadonlyMap<string, CellStatus>;
  manifestStatus: "idle" | "loading" | "ready" | "error";
  maintenance: boolean;
};
export type CellStorage = {
  read(url: string): Promise<{ etag: string; body: string } | null>;
  write(url: string, etag: string, body: string): Promise<void>;
};
export const REVALIDATE_MS = 5 * 60_000;
const FAILED_REVALIDATE_MS = 30_000;
const MAX_CONCURRENT_CELLS = 4;
const RECENT_AREAS = 8;
export const bareEtag = (value: string | null | undefined) => value ? value.trim().replace(/^W\//, "").replace(/^"(.*)"$/, "$1") : null;

export function createCacheStorage(name: string, prefix = name.replace(/v\d+$/, "")): CellStorage {
  let opened: Promise<Cache | null> | null = null;
  const open = () => opened ??= (async () => {
    if (typeof caches === "undefined") return null;
    try {
      for (const key of await caches.keys()) if (key.startsWith(prefix) && key !== name) await caches.delete(key);
    } catch {
      // A stale schema version only wastes space; the current cache still works.
    }
    try { return await caches.open(name); } catch { return null; }
  })();
  return {
    async read(url) {
      try {
        const response = await (await open())?.match(url);
        const etag = response?.headers.get("ETag");
        return response && etag ? { etag, body: await response.text() } : null;
      } catch {
        return null;
      }
    },
    async write(url, etag, body) {
      try {
        await (await open())?.put(url, new Response(body, { headers: { "Content-Type": "application/json", ETag: etag } }));
      } catch {
        // Quota or private mode: the memory copy still serves this session.
      }
    },
  };
}

export function createCellStore<T extends { id: string }>({ storage, fetch = fetchWithRetry, now = Date.now, manifestUrl: MANIFEST_URL, parseManifest, parseCell, cellsFor, isUnavailable: isServiceMaintenance }: {
  storage: CellStorage; fetch?: typeof fetchWithRetry; now?: () => number; manifestUrl: string;
  parseManifest: (value: unknown) => Map<string, ManifestCell>; parseCell: (value: unknown, key: string) => T[];
  cellsFor: (keys: Iterable<string>, bounds: CatalogBounds) => string[]; isUnavailable: (error: unknown) => boolean;
}) {
  // Shared fetches outlive any one screen: their results land in the cache for the next one.
  const signal = new AbortController().signal;
  const cellUrl = (key: string) => `${MANIFEST_URL}/${key.replace(":", "/")}`;
  // Storage is only an accelerator: any failure of a custom implementation counts as an empty cache too.
  const read = (url: string) => Promise.resolve().then(() => storage.read(url)).catch(() => null);
  const write = (url: string, etag: string, body: string) => Promise.resolve().then(() => storage.write(url, etag, body)).catch(() => {});
  let manifest: { etag: string | null; cells: Map<string, ManifestCell>; nextCheckAt: number } | null = null;
  let manifestStatus: CellSnapshot<T>["manifestStatus"] = "idle";
  let maintenance = false;
  let storedManifest: Promise<void> | null = null;
  let revalidating: Promise<void> | null = null;
  // Each store owns its session cache; manifest removal discards obsolete cells.
  const memory = new Map<string, { etag: string; points: T[]; fetched: number }>();
  let fetches = 0;
  const status = new Map<string, CellStatus>();
  const inflight = new Map<string, Promise<void>>();
  const areas: CatalogBounds[] = [];
  const requestedKeys = new Set<string>();
  const listeners = new Set<() => void>();
  let active = 0;
  const waiting: Array<() => void> = [];
  let snapshot: CellSnapshot<T> = { points: [], manifestKeys: null, loadedKeys: new Set(), cellStatus: new Map(), manifestStatus, maintenance };
  let pointsDirty = false;

  function emit() {
    const points = pointsDirty ? union() : snapshot.points;
    pointsDirty = false;
    snapshot = { points, manifestKeys: manifest ? new Set(manifest.cells.keys()) : null, loadedKeys: new Set(memory.keys()),
      cellStatus: new Map(status), manifestStatus, maintenance };
    for (const listener of listeners) listener();
  }
  const setCell = (key: string, etag: string, points: T[]) => { memory.set(key, { etag, points, fetched: fetches += 1 }); pointsDirty = true; };
  /**
   * One set of points for the map and the nearby ranking, deduplicated by id: a place moved across a cell line
   * may sit in a fresh cell and a stale one for a moment, and the most recently fetched cell wins.
   */
  function union() {
    const points = new Map<string, T>();
    for (const cell of [...memory.values()].sort((a, b) => a.fetched - b.fetched)) for (const point of cell.points) points.set(point.id, point);
    return [...points.values()];
  }

  function replaceManifest(etag: string | null, cells: Map<string, ManifestCell>, nextCheckAt: number) {
    manifest = { etag, cells, nextCheckAt };
    for (const key of [...memory.keys()]) {
      if (!cells.has(key)) { memory.delete(key); status.delete(key); pointsDirty = true; }
    }
  }

  async function loadStoredManifest() {
    const stored = await read(MANIFEST_URL);
    if (!stored || manifest) return;
    try {
      replaceManifest(stored.etag, parseManifest(JSON.parse(stored.body)), 0);
      manifestStatus = "ready";
      emit();
    } catch {
      // A broken stored copy is ignored; the network copy replaces it.
    }
  }

  async function revalidateManifest() {
    if (!manifest) { manifestStatus = "loading"; emit(); }
    try {
      const previous = manifest;
      const response = await fetch(MANIFEST_URL, signal, previous?.etag ? { headers: { "If-None-Match": previous.etag } } : {});
      if (response.status === 304) {
        if (!previous || manifest !== previous) throw new Error("Некорректный ответ списка областей карты.");
        previous.nextCheckAt = now() + REVALIDATE_MS;
      } else {
        const body = await response.text();
        const etag = response.headers.get("ETag");
        replaceManifest(etag, parseManifest(JSON.parse(body)), now() + REVALIDATE_MS);
        if (etag) await write(MANIFEST_URL, etag, body);
        // Cells changed by this manifest are refreshed for the areas asked for recently.
        void ensureAreas([...areas]);
        void ensureKeys([...requestedKeys]);
      }
      manifestStatus = "ready";
      maintenance = false;
    } catch (error) {
      maintenance = isServiceMaintenance(error);
      if (manifest) manifest.nextCheckAt = now() + FAILED_REVALIDATE_MS;
      else manifestStatus = "error";
    } finally {
      emit();
    }
  }

  /** Resolves once some manifest is available; a stale one is revalidated in the background. */
  async function ensureManifest(force = false) {
    if (!force && manifest && now() < manifest.nextCheckAt) return;
    await (storedManifest ??= loadStoredManifest());
    if (!force && manifest && now() < manifest.nextCheckAt) return;
    const network = revalidating ??= revalidateManifest().finally(() => { revalidating = null; });
    if (!manifest) await network;
  }

  async function limited<T>(task: () => Promise<T>) {
    if (active >= MAX_CONCURRENT_CELLS) await new Promise<void>(resolve => waiting.push(resolve));
    active += 1;
    try {
      return await task();
    } finally {
      active -= 1;
      waiting.shift()?.();
    }
  }

  async function loadCell(key: string) {
    const url = cellUrl(key);
    if (!memory.has(key)) {
      const stored = await read(url);
      if (stored && !memory.has(key)) {
        try { setCell(key, bareEtag(stored.etag) ?? "", parseCell(JSON.parse(stored.body), key)); status.set(key, "ready"); emit(); } catch {
          // A broken stored copy is refetched below.
        }
      }
    }
    const expected = manifest?.cells.get(key)?.etag;
    const current = memory.get(key);
    if (!expected || current?.etag === expected) return;
    if (!current) { status.set(key, "loading"); emit(); }
    try {
      const response = await limited(() => fetch(url, signal, current ? { headers: { "If-None-Match": `"${current.etag}"` } } : {}));
      let etag: string;
      if (response.status === 304) {
        if (!current) throw new Error("Некорректный ответ области карты.");
        etag = current.etag;
      } else {
        const body = await response.text();
        const points = parseCell(JSON.parse(body), key);
        etag = bareEtag(response.headers.get("ETag")) ?? expected;
        setCell(key, etag, points);
        await write(url, `"${etag}"`, body);
      }
      // The cell was published after the manifest was read: keep the newer cell and recheck the manifest.
      if (manifest && etag !== manifest.cells.get(key)?.etag) manifest.nextCheckAt = 0;
      status.set(key, "ready");
      maintenance = false;
    } catch (error) {
      maintenance = isServiceMaintenance(error);
      // A stale copy keeps serving (offline included); only a cell without any copy is an error.
      status.set(key, memory.has(key) ? "ready" : "error");
    } finally {
      emit();
    }
  }

  function ensureCell(key: string): Promise<void> {
    const running = inflight.get(key);
    if (running) return running;
    const task = loadCell(key).finally(() => inflight.delete(key));
    inflight.set(key, task);
    return task;
  }

  async function ensureAreas(bounds: CatalogBounds[]) {
    await ensureManifest();
    const cells = manifest?.cells;
    if (!cells) return;
    // Only manifest cells are requested: everything else is empty.
    const keys = new Set(bounds.flatMap(area => cellsFor(cells.keys(), area)));
    await Promise.all([...keys].map(ensureCell));
  }
  async function ensureKeys(keys: Iterable<string>) {
    const selected = [...keys];
    for (const key of selected) requestedKeys.add(key);
    await ensureManifest();
    await Promise.all(selected.filter(key => manifest?.cells.has(key)).map(ensureCell));
  }
  function remember(bounds: CatalogBounds[]) {
    for (const area of bounds) {
      const index = areas.findIndex(item => item.west === area.west && item.south === area.south && item.east === area.east && item.north === area.north);
      if (index >= 0) areas.splice(index, 1);
      areas.push(area);
    }
    areas.splice(0, Math.max(0, areas.length - RECENT_AREAS));
  }

  return {
    ensureKeys,
    ensureManifest,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    snapshot: () => snapshot,
    /** Loads the cells of the areas (memory → storage → network) and keeps them fresh on later manifest updates. */
    ensureArea(...bounds: CatalogBounds[]) {
      remember(bounds);
      return ensureAreas(bounds);
    },
    /** Forces a manifest revalidation, e.g. after a published story turned out to be gone. */
    async revalidate() {
      await ensureManifest(true);
    },
    async retry(...bounds: CatalogBounds[]) {
      remember(bounds);
      await ensureManifest(true);
      await ensureAreas(bounds);
    },
  };
}
