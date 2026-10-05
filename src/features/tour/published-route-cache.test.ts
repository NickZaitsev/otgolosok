import { FOOD_MANIFEST_URL, foodCellStore } from "../food/food-cells";
import { afterEach, describe, expect, it, vi } from "vitest";
import routeData from "../../../public/data/routes/paveletskaya.json";
import type { Route } from "./types";
import { loadPublishedRoute } from "./published-route-cache";

const route = routeData as Route;
const manifestUrl = `/api/story-walks/${encodeURIComponent(route.id)}`;

class MemoryCache {
  entries = new Map<string, Response>();
  writes: string[] = [];
  onPut?: (key: string) => void;

  async match(key: RequestInfo | URL) {
    return this.entries.get(String(key))?.clone();
  }

  async put(key: RequestInfo | URL, response: Response) {
    const value = String(key);
    this.entries.set(value, response.clone());
    this.writes.push(value);
    this.onPut?.(value);
  }
}

async function publication(audioBody = "new walk recording") {
  const value = structuredClone(route);
  const step = value.walk!.steps[0];
  const bytes = new TextEncoder().encode(audioBody);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
  step.title = "Новая редакция";
  step.transition = "Новое вступление к прогулке.";
  step.audio = { ...step.audio!, url: `/api/story-audio/${hash}.mp3`, audio_sha256: hash, duration_sec: 61 };
  const content = [...value.pois, ...value.notes!].find(item => item.id === step.content_id)!;
  content.story.paragraphs[0].text = "Уточнённый текст прогулки.";
  return { value, audioBody, audioUrl: step.audio.url };
}

// Generated recordings for the first steps, one per body.
async function publicationWithRecordings(bodies: string[]) {
  const value = structuredClone(route);
  const audio = [] as Array<{ url: string; body: string }>;
  for (const [index, body] of bodies.entries()) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body));
    const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
    const step = value.walk!.steps[index];
    step.audio = { ...step.audio!, url: `/api/story-audio/${hash}.mp3`, audio_sha256: hash };
    audio.push({ url: step.audio.url, body });
  }
  return { value, audio };
}

function installCache(cache: MemoryCache) {
  vi.stubGlobal("caches", { open: vi.fn(async () => cache) });
}

function installNetwork(value: Route, audioUrl: string, audioBody: string) {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === FOOD_MANIFEST_URL) return new Response("{}", { status: 503 });
    if (url === manifestUrl) return new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } });
    if (url === audioUrl) return new Response(audioBody, { headers: { "Content-Type": "audio/mpeg" } });
    throw new Error(`Unexpected request: ${url}`);
  }));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("published route cache", () => {
  it("uses a valid live publication when Cache Storage is unavailable", async () => {
    const update = await publication();
    vi.stubGlobal("caches", undefined);
    installNetwork(update.value, update.audioUrl, update.audioBody);

    const result = await loadPublishedRoute(route, new AbortController().signal);

    expect(result.walk!.steps[0].audio?.url).toBe(update.audioUrl);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("commits generated audio before the matching route snapshot", async () => {
    const cache = new MemoryCache();
    const update = await publication();
    installCache(cache);
    installNetwork(update.value, update.audioUrl, update.audioBody);

    const result = await loadPublishedRoute(route, new AbortController().signal);

    expect(result.walk!.steps[0].title).toBe("Новая редакция");
    expect(cache.writes).toEqual([update.audioUrl, manifestUrl]);
    expect(await (await cache.match(update.audioUrl))?.text()).toBe(update.audioBody);
    expect((await (await cache.match(manifestUrl))?.json()).walk.steps[0].audio.url).toBe(update.audioUrl);
  });

  it("uses the last complete cached publication when the network fails", async () => {
    const cache = new MemoryCache();
    const update = await publication();
    installCache(cache);
    installNetwork(update.value, update.audioUrl, update.audioBody);
    await loadPublishedRoute(route, new AbortController().signal);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Offline")));

    const result = await loadPublishedRoute(route, new AbortController().signal);

    expect(result.walk!.steps[0].audio?.url).toBe(update.audioUrl);
    expect(result.walk!.steps[0].title).toBe("Новая редакция");
  });

  it("keeps the bundled route when cached generated audio is missing", async () => {
    const cache = new MemoryCache();
    const update = await publication();
    cache.entries.set(manifestUrl, new Response(JSON.stringify(update.value), { headers: { "Content-Type": "application/json" } }));
    installCache(cache);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Offline")));

    await expect(loadPublishedRoute(route, new AbortController().signal)).resolves.toBe(route);
  });

  it("never commits a route manifest after interrupted partial caching", async () => {
    const cache = new MemoryCache();
    const update = await publication();
    const controller = new AbortController();
    cache.onPut = key => { if (key === update.audioUrl) controller.abort(); };
    installCache(cache);
    installNetwork(update.value, update.audioUrl, update.audioBody);

    await expect(loadPublishedRoute(route, controller.signal)).resolves.toBe(route);

    expect(cache.writes).toEqual([update.audioUrl]);
    expect(await cache.match(manifestUrl)).toBeUndefined();
  });

  it("does not download recordings that are already cached", async () => {
    const cache = new MemoryCache();
    const update = await publication();
    installCache(cache);
    installNetwork(update.value, update.audioUrl, update.audioBody);
    await loadPublishedRoute(route, new AbortController().signal);
    const network = vi.mocked(fetch);
    network.mockClear();

    await loadPublishedRoute(route, new AbortController().signal);

    expect(network.mock.calls.map(([input]) => String(input))).toEqual([manifestUrl, FOOD_MANIFEST_URL]);
  });

  it("keeps verified recordings when another one stalls, and fetches only the missing one later", async () => {
    const cache = new MemoryCache();
    const update = await publicationWithRecordings(["first recording", "stalled recording"]);
    let stalled = true;
    const requested: string[] = [];
    installCache(cache);
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      requested.push(url);
      if (url === FOOD_MANIFEST_URL) return new Response("{}", { status: 503 });
      if (url === manifestUrl) return new Response(JSON.stringify(update.value), { headers: { "Content-Type": "application/json" } });
      const audio = update.audio.find(item => item.url === url)!;
      if (stalled && audio === update.audio[1]) {
        return new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal!.reason), { once: true }));
      }
      return new Response(audio.body, { headers: { "Content-Type": "audio/mpeg" } });
    }));

    await expect(loadPublishedRoute(route, new AbortController().signal, { audioTimeoutMs: 20 })).resolves.toBe(route);
    expect(cache.writes).toEqual([update.audio[0].url]);

    stalled = false;
    requested.length = 0;
    const result = await loadPublishedRoute(route, new AbortController().signal, { audioTimeoutMs: 20 });
    expect(result.walk!.steps[1].audio?.url).toBe(update.audio[1].url);
    expect(requested).toEqual([manifestUrl, update.audio[1].url, FOOD_MANIFEST_URL]);
  });
});


it("keeps catalog food with the publication, seeds it offline and replaces it on update", async () => {
  const cache = new MemoryCache(), update = await publication();
  const [lon, lat] = update.value.walk!.path.coordinates[0];
  const latKey = Math.floor(lat * 20), lonKey = Math.floor(lon * 20), etag = "a".repeat(32);
  const food = { id: "osm:node:99", kind: "coffee", name: "Кофе каталога", lat, lon, address: null, openingHours: "24/7", cuisine: null, website: null, phone: null };
  let offline = false, enabled = true;
  installCache(cache);
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    if (offline) throw new TypeError("offline");
    const url = String(input);
    if (url === manifestUrl) return new Response(JSON.stringify(update.value));
    if (url === update.audioUrl) return new Response(update.audioBody, { headers: { "Content-Type": "audio/mpeg" } });
    if (url === FOOD_MANIFEST_URL) return enabled ? new Response(JSON.stringify({ version: 1, cellSize: .05, sourceEditedAt: "2026-10-02T10:00:00Z", attribution: "© участники OpenStreetMap", cells: [{ lat: latKey, lon: lonKey, count: 1, etag }] })) : new Response("{}", { status: 503 });
    return new Response(JSON.stringify({ lat: latKey, lon: lonKey, places: [food] }), { headers: { ETag: `"${etag}"` } });
  }));
  await loadPublishedRoute(route, new AbortController().signal);
  expect((await (await cache.match(manifestUrl))?.json()).offlineFood.cells).toHaveLength(1);
  offline = true;
  expect((await loadPublishedRoute(route, new AbortController().signal)).walk!.steps[0].audio?.url).toBe(update.audioUrl);
  expect(foodCellStore.snapshot().places.map(p => p.name)).toContain("Кофе каталога");
  offline = false; enabled = false;
  await loadPublishedRoute(route, new AbortController().signal);
  expect((await (await cache.match(manifestUrl))?.json()).offlineFood).toBeUndefined();
});
