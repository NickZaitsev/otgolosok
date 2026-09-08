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

function installCache(cache: MemoryCache) {
  vi.stubGlobal("caches", { open: vi.fn(async () => cache) });
}

function installNetwork(value: Route, audioUrl: string, audioBody: string) {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
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
});
