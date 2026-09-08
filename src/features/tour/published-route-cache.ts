import type { Route } from "./types";
import { applyPublishedRoute } from "./published-route";

const WALK_CACHE = "walk-packs-v1";
const MAX_AUDIO_BYTES = 25_000_000;
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

async function fetchAudio(audio: GeneratedAudio, signal: AbortSignal) {
  const response = await fetch(audio.url, { signal, cache: "no-store" });
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
}

async function cachedPublication(cache: Cache, base: Route, url: string) {
  try {
    const manifest = await cache.match(url);
    if (!manifest) return base;
    const merged = applyPublishedRoute(base, await manifest.json());
    if (merged === base) return base;
    const audio = generatedAudio(merged);
    const available = await Promise.all(audio.map(entry => cache.match(entry.url)));
    return available.every(Boolean) ? merged : base;
  } catch {
    return base;
  }
}

export async function loadPublishedRoute(base: Route, signal: AbortSignal): Promise<Route> {
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
    const audio = generatedAudio(merged);
    const recordings = await Promise.all(audio.map(entry => fetchAudio(entry, signal)));
    for (let index = 0; index < audio.length; index += 1) {
      signal.throwIfAborted();
      await cache.put(audio[index].url, recordings[index]);
    }
    signal.throwIfAborted();
    await cache.put(url, new Response(JSON.stringify(merged), { headers: { "Content-Type": "application/json" } }));
    return merged;
  } catch {
    return cachedPublication(cache, base, url);
  }
}
