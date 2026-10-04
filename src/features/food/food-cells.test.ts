import { afterEach, expect, it, vi } from "vitest";
import { createCacheStorage, REVALIDATE_MS, type CellStorage } from "../../lib/geo/cell-store";
import { RequestError } from "../walk-builder/request";
import { createFoodCellStore, fetchFoodWithRetry, FOOD_CACHE_NAME, FOOD_MANIFEST_URL, foodCellKey, foodCellsFor } from "./food-cells";
import { foodPlace } from "./test-fixtures";
import type { FoodPlace } from "./types";
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
const e1 = "a".repeat(32), e2 = "b".repeat(32);
function memoryStorage() {
  const entries = new Map<string, { etag: string; body: string }>();
  return { entries, read: async (url: string) => entries.get(url) ?? null, write: async (url: string, etag: string, body: string) => { entries.set(url, { etag, body }); } };
}
function server(keys = ["1115:752"]) {
  const state = { etag: e1, cells: Object.fromEntries(keys.map((key, i) => {
    const [lat, lon] = key.split(":").map(Number);
    return [key, [foodPlace(`osm:node:${i + 1}`, lat / 20 + .001, lon / 20 + .001)]];
  })) as Record<string, FoodPlace[]>, offline: false, unavailable: false };
  const manifest = () => ({ version: 1, cellSize: .05, sourceEditedAt: "2026-10-02T21:21:10Z", attribution: "© участники OpenStreetMap", cells: Object.entries(state.cells).map(([key, places]) => {
    const [lat, lon] = key.split(":").map(Number); return { lat, lon, count: places.length, etag: state.etag };
  }) });
  const fetch = vi.fn(async (path: string, _signal: AbortSignal, init: { headers?: HeadersInit } = {}) => {
    if (state.offline) throw new TypeError("offline");
    if (state.unavailable) throw new RequestError("Нет индекса", "FOOD_INDEX_UNAVAILABLE", 503);
    if (new Headers(init.headers).get("If-None-Match") === `"${state.etag}"`) return new Response(null, { status: 304 });
    const key = path.slice(FOOD_MANIFEST_URL.length + 1).replace("/", ":"), [lat, lon] = key.split(":").map(Number);
    return new Response(JSON.stringify(path === FOOD_MANIFEST_URL ? manifest() : { lat, lon, places: state.cells[key] ?? [] }), { headers: { ETag: `"${state.etag}"` } });
  });
  return { state, fetch, manifest };
}
const bounds = { south: 55.75, north: 55.79, west: 37.60, east: 37.64 };
it("loads the manifest, route keys and a viewport, returning only selected places", async () => {
  const api = server(["1115:752", "1115:753"]), store = createFoodCellStore({ storage: memoryStorage(), fetch: api.fetch });
  expect((await store.loadManifest())?.attribution).toBe("© участники OpenStreetMap");
  expect((await store.loadKeys(["1115:752", "1115:753", "1115:999"])).map(p => p.id)).toEqual(["osm:node:1", "osm:node:2"]);
  expect((await store.loadArea(bounds)).map(p => p.id)).toEqual(["osm:node:1"]);
  expect((await store.loadKeys(["1115:753"])).map(p => p.id)).toEqual(["osm:node:2"]);
  expect(api.fetch.mock.calls).toHaveLength(3);
  expect(store.snapshot().unavailable).toBe(false);
});
it("deduplicates and limits parallel cell requests to four", async () => {
  const keys = Array.from({ length: 8 }, (_, i) => `1115:${752 + i}`), api = server(keys);
  let active = 0, peak = 0;
  const fetch: typeof api.fetch = vi.fn(async (...args) => {
    active += 1; peak = Math.max(peak, active);
    try { await new Promise(resolve => setTimeout(resolve, 2)); return await api.fetch(...args); } finally { active -= 1; }
  });
  const store = createFoodCellStore({ fetch, storage: memoryStorage() });
  const results = await Promise.all([store.loadKeys(keys), store.loadKeys(keys), store.loadKeys(keys.slice(1))]);
  expect(results.map(r => r.length)).toEqual([8, 8, 7]);
  expect(api.fetch.mock.calls).toHaveLength(9);
  expect(peak).toBeLessThanOrEqual(4);
});
it("serves an offline persistent copy and exposes an error when there is no copy", async () => {
  const api = server(), storage = memoryStorage();
  await createFoodCellStore({ fetch: api.fetch, storage }).loadKeys(["1115:752"]);
  api.state.offline = true;
  const cached = createFoodCellStore({ fetch: api.fetch, storage });
  expect((await cached.loadKeys(["1115:752"])).map(p => p.name)).toEqual(["Кофейня"]);
  const empty = createFoodCellStore({ fetch: api.fetch, storage: memoryStorage() });
  expect(await empty.loadKeys(["1115:752"])).toEqual([]);
  expect(empty.snapshot().manifestStatus).toBe("error");
  expect(empty.snapshot().unavailable).toBe(false);
});
it("revalidates conditionally, refreshes requested keys and drops removed cells", async () => {
  let now = 0;
  const api = server(), store = createFoodCellStore({ fetch: api.fetch, storage: memoryStorage(), now: () => now });
  await store.loadKeys(["1115:752"]);
  now = REVALIDATE_MS + 1;
  await store.revalidate();
  expect(new Headers(api.fetch.mock.calls.at(-1)![2]?.headers).get("If-None-Match")).toBe(`"${e1}"`);
  api.state.etag = e2; api.state.cells["1115:752"][0].name = "Новое имя";
  await store.revalidate();
  await vi.waitFor(() => expect(store.snapshot().places[0].name).toBe("Новое имя"));
  expect(new Headers(api.fetch.mock.calls.at(-1)![2]?.headers).get("If-None-Match")).toBe(`"${e1}"`);
  delete api.state.cells["1115:752"]; api.state.etag = "c".repeat(32);
  await store.revalidate();
  await vi.waitFor(() => expect(store.snapshot().places).toEqual([]));
});
it("recovers from a failed cell with retry and flags 503", async () => {
  const api = server();
  let fail = true;
  const fetch: typeof api.fetch = vi.fn(async (...args) => { if (fail && args[0] !== FOOD_MANIFEST_URL) throw new TypeError("offline"); return api.fetch(...args); });
  const store = createFoodCellStore({ fetch, storage: memoryStorage() });
  expect(await store.loadKeys(["1115:752"])).toEqual([]);
  expect(store.snapshot().cellStatus.get("1115:752")).toBe("error");
  fail = false; await store.retry(bounds);
  expect(store.snapshot().places).toHaveLength(1);
  api.state.unavailable = true; await store.revalidate();
  await vi.waitFor(() => expect(store.snapshot().unavailable).toBe(true));
  api.state.unavailable = false; await store.revalidate();
  await vi.waitFor(() => expect(store.snapshot().unavailable).toBe(false));
});
it("ignores corrupt storage and storage failures", async () => {
  const api = server(), broken: CellStorage = { read: async () => ({ etag: e1, body: "{" }), write: async () => { throw new Error("quota"); } };
  expect(await createFoodCellStore({ storage: broken, fetch: api.fetch }).loadKeys(["1115:752"])).toHaveLength(1);
});
it.each([
  { version: 2 }, { cellSize: 1 }, { attribution: "" }, { sourceEditedAt: "invalid" }, { cells: [{ lat: .5, lon: 1, count: 1, etag: e1 }] },
  { cells: [{ lat: 1800, lon: 1, count: 1, etag: e1 }] }, { cells: [{ lat: 1, lon: 1, count: -1, etag: e1 }] }, { cells: [{ lat: 1, lon: 1, count: 1, etag: "bad" }] },
])("rejects malformed manifest %j", async patch => {
  const api = server();
  const store = createFoodCellStore({ storage: memoryStorage(), fetch: async () => new Response(JSON.stringify({ ...api.manifest(), ...patch })) });
  expect(await store.loadManifest()).toBeNull();
  expect(store.snapshot().manifestStatus).toBe("error");
});
it.each([{ lat: "55.751" }, { kind: "unknown" }, { website: "javascript:alert(1)" }, { openingHours: 123 }, { name: "" }, { lon: 40 }, { id: "invalid" }])("rejects a whole cell with an invalid place %j", async patch => {
  const api = server();
  const store = createFoodCellStore({ storage: memoryStorage(), fetch: async (...args) => args[0] === FOOD_MANIFEST_URL ? api.fetch(...args)
    : new Response(JSON.stringify({ lat: 1115, lon: 752, places: [foodPlace(), { ...foodPlace("osm:node:2"), ...patch }] })) });
  expect(await store.loadKeys(["1115:752"])).toEqual([]);
  expect(store.snapshot().cellStatus.get("1115:752")).toBe("error");
});
it.each([
  [55.75, 37.6, "1115:752"], [-.05, -.05, "-1:-1"], [-.05001, -.05001, "-2:-2"], [90, 180, "1799:3599"], [-90, -180, "-1800:-3600"], [0, 0, "0:0"],
])("grid key at (%s,%s)", (lat, lon, key) => expect(foodCellKey(lat, lon)).toBe(key));
it("selects viewport cells on exact boundaries, including negative coordinates", () => {
  expect(foodCellsFor(["1114:751", "1115:752", "1116:753"], { south: 55.75, north: 55.75, west: 37.6, east: 37.6 })).toEqual(["1114:751", "1115:752"]);
  expect(foodCellsFor(["-1:-1", "0:0"], { south: -.04, north: -.01, west: -.04, east: -.01 })).toEqual(["-1:-1"]);
});
it.each([503, 400, 404])("does not retry status %s", async status => {
  const fetch = vi.fn(async () => new Response(JSON.stringify({ error: "FOOD_INDEX_UNAVAILABLE" }), { status }));
  vi.stubGlobal("fetch", fetch);
  await expect(fetchFoodWithRetry(FOOD_MANIFEST_URL, new AbortController().signal)).rejects.toMatchObject({ status });
  expect(fetch).toHaveBeenCalledTimes(1);
});
it.each(["network", "500", "502", "429"])("retries %s with bounded exponential pauses", async error => {
  vi.useFakeTimers();
  const stamps: number[] = [];
  const fetch = vi.fn(async () => {
    stamps.push(Date.now());
    if (error === "network") throw new TypeError("offline");
    return new Response("{}", { status: Number(error) });
  });
  vi.stubGlobal("fetch", fetch);
  const result = fetchFoodWithRetry(FOOD_MANIFEST_URL, new AbortController().signal).catch(e => e);
  await vi.runAllTimersAsync();
  expect(await result).toBeInstanceOf(Error);
  expect(stamps).toHaveLength(3);
  expect(stamps[1] - stamps[0]).toBeGreaterThanOrEqual(500);
  expect(stamps[2] - stamps[1]).toBeGreaterThanOrEqual(1000);
});
it("does not delete map caches when opening food cache", async () => {
  const deleted: string[] = [];
  vi.stubGlobal("caches", { keys: async () => ["food-cells-v0", "map-cells-v1"], delete: async (key: string) => { deleted.push(key); }, open: async () => ({ match: async () => undefined }) });
  expect(await createCacheStorage(FOOD_CACHE_NAME).read(FOOD_MANIFEST_URL)).toBeNull();
  expect(deleted).toEqual(["food-cells-v0"]);
});
it("keeps snapshot references stable until data changes and notifies subscribers", async () => {
  const api = server(), store = createFoodCellStore({ storage: memoryStorage(), fetch: api.fetch });
  const before = store.snapshot(), seen: number[] = [];
  const unsubscribe = store.subscribe(() => seen.push(store.snapshot().places.length));
  expect(store.snapshot()).toBe(before);
  await store.loadKeys(["1115:752"]);
  expect(store.snapshot()).not.toBe(before);
  expect(store.snapshot()).toBe(store.snapshot());
  expect(seen).toContain(1);
  unsubscribe();
});
it("rejects a negative-zero manifest key before constructing URLs", async () => {
  const api = server();
  const body = JSON.stringify(api.manifest()).replace('"lat":1115', '"lat":-0');
  const store = createFoodCellStore({ storage: memoryStorage(), fetch: async () => new Response(body) });
  expect(await store.loadManifest()).toBeNull();
  expect(store.snapshot().manifestStatus).toBe("error");
});
it("does not accept a 304 without a cached manifest", async () => {
  const store = createFoodCellStore({ storage: memoryStorage(), fetch: async () => new Response(null, { status: 304 }) });
  expect(await store.loadManifest()).toBeNull();
  expect(store.snapshot().manifestStatus).toBe("error");
});
it("aborts a retry pause without further requests", async () => {
  vi.useFakeTimers();
  const controller = new AbortController(), fetch = vi.fn(async () => { throw new TypeError("offline"); });
  vi.stubGlobal("fetch", fetch);
  const result = fetchFoodWithRetry(FOOD_MANIFEST_URL, controller.signal).catch(e => e);
  await vi.advanceTimersByTimeAsync(1);
  controller.abort(new DOMException("Aborted", "AbortError"));
  await vi.runAllTimersAsync();
  expect(await result).toMatchObject({ name: "AbortError" });
  expect(fetch).toHaveBeenCalledTimes(1);
});
it("buffers successful responses after a transient failure", async () => {
  vi.useFakeTimers();
  const fetch = vi.fn().mockRejectedValueOnce(new TypeError("offline")).mockResolvedValueOnce(new Response('{"ok":true}'));
  vi.stubGlobal("fetch", fetch);
  const result = fetchFoodWithRetry(FOOD_MANIFEST_URL, new AbortController().signal);
  await vi.runAllTimersAsync();
  expect(await (await result).json()).toEqual({ ok: true });
  expect(fetch).toHaveBeenCalledTimes(2);
});

it("seeds a package without persistent cache and revalidates its ETags after reconnecting", async () => {
  const api = server(), storage = memoryStorage(), store = createFoodCellStore({ storage, fetch: api.fetch });
  api.state.offline = true;
  store.seedOffline({ manifest: api.manifest(), cells: [{ key: "1115:752", etag: e1, body: { lat: 1115, lon: 752, places: api.state.cells["1115:752"] } }] });
  expect(store.snapshot().manifestStatus).toBe("ready");
  expect(store.snapshot().unavailable).toBe(false);
  expect((await store.loadKeys(["1115:752"])).map(p => p.name)).toEqual(["Кофейня"]);
  expect(storage.entries.size).toBe(0);
  api.state.offline = false;
  api.state.etag = e2;
  api.state.cells["1115:752"][0] = { ...foodPlace(), name: "Новая кофейня" };
  await store.revalidate();
  await store.loadKeys(["1115:752"]);
  await vi.waitFor(() => expect(store.snapshot().places.map(p => p.name)).toEqual(["Новая кофейня"]));
  const cellCall = api.fetch.mock.calls.find(([path]) => path.endsWith("1115/752"));
  expect(new Headers(cellCall?.[2]?.headers).get("If-None-Match")).toBe(`"${e1}"`);
});

it("rejects a malformed offline cell without changing the snapshot", () => {
  const api = server(), store = createFoodCellStore({ storage: memoryStorage(), fetch: api.fetch });
  const before = store.snapshot();
  expect(() => store.seedOffline({ manifest: api.manifest(), cells: [{ key: "1115:752", etag: e1, body: { lat: 1115, lon: 752, places: [{ ...foodPlace(), website: "javascript:alert(1)" }] } }] })).toThrow();
  expect(store.snapshot()).toBe(before);
  expect(store.snapshot().manifest).toBeNull();
});


it.each(["etag", "count", "duplicate"])("отклоняет офлайн-пакет с неверным %s целиком", failure => {
  const api = server(), store = createFoodCellStore({ storage: memoryStorage(), fetch: api.fetch });
  const cell = { key: "1115:752", etag: failure === "etag" ? e2 : e1, body: { lat: 1115, lon: 752, places: failure === "count" ? [] : [foodPlace()] } };
  const before = store.snapshot();
  expect(() => store.seedOffline({ manifest: api.manifest(), cells: failure === "duplicate" ? [cell, cell] : [cell] })).toThrow();
  expect(store.snapshot()).toBe(before);
  expect(store.snapshot().manifest).toBeNull();
});
