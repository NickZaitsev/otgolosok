import { downloadOfflineFood, OFFLINE_FOOD_MAX_BYTES, seedOfflineFood, type OfflineFoodBundle } from "../food/offline-food";
import type { Route } from "./types";
import { applyPublishedRoute } from "./published-route";

const WALK_CACHE = "walk-packs-v1";
const MAX_AUDIO_BYTES = 25_000_000;
const AUDIO_TIMEOUT_MS = 30_000;
const GENERATED_AUDIO = /^\/api\/story-audio\/([a-f0-9]{64})\.mp3$/;

type GeneratedAudio = {
  url: string;
  sha256: string;
};

function routeUrl(route: Route) {
  return `/api/story-walks/${encodeURIComponent(route.id)}`;
}

function generatedAudio(route: Route): GeneratedAudio[] {
  const result = new Map<string, GeneratedAudio>();
  for (const step of route.walk?.steps ?? []) {
    const audio = step.audio;
    const match = audio && GENERATED_AUDIO.exec(audio.url);
    if (!audio || !match) continue;
    if (audio.audio_sha256 !== match[1]) throw new Error("Published audio identity is invalid");
    result.set(audio.url, { url: audio.url, sha256: audio.audio_sha256 });
  }
  return [...result.values()];
}

async function sha256(bytes: ArrayBuffer) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

async function fetchPublication(base: Route, url: string, signal: AbortSignal) {
  const response = await fetch(url, { signal, cache: "no-store" });
  if (!response.ok || response.status !== 200) throw new Error("Published walk is unavailable");
  const merged = applyPublishedRoute(base, await response.json());
  if (merged === base) throw new Error("Published walk is invalid");
  signal.throwIfAborted();
  return merged;
}

// Recordings are content-addressed, so the HTTP cache may serve them.
async function fetchAudio(audio: GeneratedAudio, signal: AbortSignal, timeoutMs: number) {
  const controller = new AbortController();
  const abort = () => controller.abort(signal.reason);
  signal.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => controller.abort(new DOMException("Audio download timed out", "TimeoutError")), timeoutMs);
  try {
    const response = await fetch(audio.url, { signal: controller.signal });
    const declaredLength = Number(response.headers.get("content-length"));
    if (!response.ok || response.status !== 200 || !response.headers.get("content-type")?.startsWith("audio/")
      || (Number.isFinite(declaredLength) && declaredLength > MAX_AUDIO_BYTES)) throw new Error("Published audio is unavailable");
    const bytes = await response.arrayBuffer();
    if (!bytes.byteLength || bytes.byteLength > MAX_AUDIO_BYTES || await sha256(bytes) !== audio.sha256) {
      throw new Error("Published audio is incomplete");
    }
    signal.throwIfAborted();
    return new Response(bytes, { headers: {
      "Content-Type": response.headers.get("content-type") ?? "audio/mpeg",
      "Content-Length": String(bytes.byteLength),
    } });
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", abort);
  }
}

async function cachedPublication(cache: Cache, base: Route, url: string) {
  try {
    const manifest = await cache.match(url);
    if (!manifest) return base;
    const value = await manifest.json();
    const merged = applyPublishedRoute(base, value);
    if (merged === base) return base;
    const audio = generatedAudio(merged);
    const available = await Promise.all(audio.map(entry => cache.match(entry.url)));
    if (!available.every(Boolean)) return base;
    if (value.offlineFood) {
      try { seedOfflineFood(value.offlineFood as OfflineFoodBundle); } catch { /* A damaged optional copy does not block the walk. */ }
    }
    return merged;
  } catch {
    return base;
  }
}

export async function loadPublishedRoute(base: Route, signal: AbortSignal, { audioTimeoutMs = AUDIO_TIMEOUT_MS } = {}): Promise<Route> {
  const url = routeUrl(base);
  if (!("caches" in globalThis)) {
    try {
      return await fetchPublication(base, url, signal);
    } catch {
      return base;
    }
  }

  let cache: Cache;
  try {
    cache = await caches.open(WALK_CACHE);
  } catch {
    try {
      return await fetchPublication(base, url, signal);
    } catch {
      return base;
    }
  }

  try {
    const merged = await fetchPublication(base, url, signal);
    // One recording at a time, each kept as soon as it is verified: an interrupted
    // update resumes from the missing files instead of downloading everything again.
    for (const entry of generatedAudio(merged)) {
      signal.throwIfAborted();
      if (await cache.match(entry.url)) continue;
      await cache.put(entry.url, await fetchAudio(entry, signal, audioTimeoutMs));
    }
    signal.throwIfAborted();
    const food = await downloadOfflineFood(merged.walk?.path?.coordinates.map(([lon, lat]) => ({ lat, lon })) ?? [], OFFLINE_FOOD_MAX_BYTES, undefined, signal);
    signal.throwIfAborted();
    // The route snapshot owns its food copy: replacement and removal cannot leave orphan cells.
    await cache.put(url, new Response(JSON.stringify({ ...merged, ...(food.bundle ? { offlineFood: food.bundle } : {}) }), { headers: { "Content-Type": "application/json" } }));
    return merged;
  } catch {
    return cachedPublication(cache, base, url);
  }
}
