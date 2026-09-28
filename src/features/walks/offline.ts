import { validateWalkView, type WalkView } from "./model";

export const WALK_PACK_CACHE = "walk-packs-v1";
const PACK_ROOT = "/__offline/walks/";
const MAX_PACK_BYTES = 60 * 1024 * 1024;
// Published routes (published-route-cache.ts) share this cache and its recordings.
const PUBLISHED_ROUTE = /^\/api\/story-walks\/[^/]+$/;

/** Where a saved copy lives: `scope` owns it, `walkId` is the key the walk is opened by. */
export type OfflineWalkRef = { scope: string; walkId: string };
export type OfflineWalkKind = "id" | "catalog" | "share" | "local";

/**
 * Account walks are private: they are saved under the user id and removed on
 * sign-out. Catalog and shared walks are readable by anyone with the link, and
 * local walks already live in this browser, so their copies are kept on sign-out.
 */
export function offlineWalkRef(kind: OfflineWalkKind, key: string, userId: string | null): OfflineWalkRef | null {
  if (!key) return null;
  if (kind === "id") return userId ? { scope: userId, walkId: key } : null;
  return { scope: { catalog: "public:catalog", share: "public:shared", local: "device:local" }[kind], walkId: key };
}

type OfflineAudio = { chapterId: string; url: string; sha256: string; bytes: number };
export type OfflineWalkManifest = {
  version: 1;
  walkId: string;
  scope: string;
  revision: number;
  contentVersion: string;
  savedAt: string;
  audio: OfflineAudio[];
};
type OfflinePointer = { version: 1; stage: string; manifest: OfflineWalkManifest };
type CachePort = Pick<Cache, "match" | "put" | "delete" | "keys">;

const encode = (value: string) => encodeURIComponent(value);
const root = (scope: string, walkId: string) => `${PACK_ROOT}${encode(scope)}/${encode(walkId)}`;
const pointerKey = (scope: string, walkId: string) => `${root(scope, walkId)}/pointer.json`;
const response = (value: unknown) => new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } });

function randomId() {
  return typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function digest(bytes: ArrayBuffer) {
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("");
}

async function openCache(cache?: CachePort) {
  if (cache) return cache;
  if (!("caches" in globalThis)) throw new Error("Офлайн-сохранение недоступно в этом браузере.");
  return caches.open(WALK_PACK_CACHE);
}

async function removeStage(cache: CachePort, stage: string) {
  const keys = await cache.keys();
  await Promise.all(keys.filter(key => key.url.includes(stage)).map(key => cache.delete(key)));
}

function audioUrls(path: string, value: unknown): string[] {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : null;
  if (!record) return [];
  if (path.endsWith("/pointer.json")) return readPointer(record)?.manifest.audio.map(item => item.url) ?? [];
  if (path.endsWith("/pending.json")) return Array.isArray(record.audio) ? record.audio.filter((url): url is string => typeof url === "string") : [];
  const steps = (record.walk as { steps?: unknown } | undefined)?.steps;
  if (!Array.isArray(steps)) return [];
  return (steps as Array<{ audio?: { url?: unknown } } | null>).flatMap(step => typeof step?.audio?.url === "string" ? [step.audio.url] : []);
}

const pathOf = (key: Request | string) => new URL(typeof key === "string" ? key : key.url, "https://offline.invalid").pathname;

/**
 * Deletes recordings that no saved walk, unfinished save or published route
 * references any more. Several walks can share one recording.
 */
async function pruneAudio(cache: CachePort) {
  const keys = await cache.keys();
  const referenced = new Set<string>();
  for (const key of keys) {
    const path = pathOf(key);
    const manifest = path.startsWith(PACK_ROOT) ? /\/(?:pointer|pending)\.json$/.test(path) : PUBLISHED_ROUTE.test(path);
    if (!manifest) continue;
    const value = await (await cache.match(key))?.json().catch(() => null);
    for (const url of audioUrls(path, value)) referenced.add(pathOf(url));
  }
  await Promise.all(keys.filter(key => pathOf(key).endsWith(".mp3") && !referenced.has(pathOf(key))).map(key => cache.delete(key)));
}

function readPointer(value: unknown): OfflinePointer | null {
  if (!value || typeof value !== "object" || (value as { version?: unknown }).version !== 1 || typeof (value as { stage?: unknown }).stage !== "string") return null;
  const pointer = value as OfflinePointer;
  if (!pointer.manifest || pointer.manifest.version !== 1 || typeof pointer.manifest.walkId !== "string" || typeof pointer.manifest.scope !== "string" ||
      !Number.isSafeInteger(pointer.manifest.revision) || pointer.manifest.revision < 0 || typeof pointer.manifest.contentVersion !== "string" ||
      typeof pointer.manifest.savedAt !== "string" || !Array.isArray(pointer.manifest.audio)) return null;
  return pointer;
}

async function readRecording(cache: CachePort, url: string, sha256: string) {
  const cached = await cache.match(url);
  if (!cached) return null;
  const body = await cached.arrayBuffer().catch(() => null);
  return body && await digest(body) === sha256 ? body : null;
}

export async function saveWalkOffline(view: WalkView, ref: OfflineWalkRef, options: {
  cache?: CachePort;
  fetcher?: typeof fetch;
  now?: () => Date;
  maxBytes?: number;
} = {}) {
  validateWalkView(view);
  const { scope, walkId } = ref;
  if (!scope.trim() || !walkId.trim()) throw new Error("Не удалось определить владельца офлайн-копии.");
  const cache = await openCache(options.cache);
  const fetcher = options.fetcher ?? fetch;
  const maxBytes = options.maxBytes ?? MAX_PACK_BYTES;
  const stage = `${root(scope, walkId)}/staging-${randomId()}`;
  const audio = [] as OfflineAudio[];
  const downloaded = new Set<string>();
  let bytesTotal = 0;
  try {
    // Recordings put before the pointer is published must survive a concurrent prune.
    await cache.put(`${stage}/pending.json`, response({ audio: view.chapters.flatMap(chapter => chapter.audio ? [chapter.audio.url] : []) }));
    for (const chapter of view.chapters) {
      if (!chapter.audio || downloaded.has(chapter.audio.url)) continue;
      downloaded.add(chapter.audio.url);
      // Another saved walk or a published route may already hold this recording.
      let body = await readRecording(cache, chapter.audio.url, chapter.audio.sha256);
      if (!body) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(new DOMException("Download timed out", "TimeoutError")), 20_000);
        let result: Response;
        try { result = await fetcher(chapter.audio.url, { signal: controller.signal, cache: "reload" }); }
        finally { clearTimeout(timer); }
        if (!result.ok || result.status !== 200) throw new Error("Не удалось скачать запись для офлайн-прогулки.");
        const declared = Number(result.headers.get("content-length") ?? 0);
        if (declared > 0 && (declared > maxBytes || bytesTotal + declared > maxBytes)) throw new Error("Офлайн-комплект прогулки слишком большой.");
        body = await result.arrayBuffer();
        if (await digest(body) !== chapter.audio.sha256) throw new Error("Запись загрузилась с неверной контрольной суммой.");
        await cache.put(chapter.audio.url, new Response(body, { headers: { "Content-Type": "audio/mpeg", "Content-Length": String(body.byteLength) } }));
      }
      bytesTotal += body.byteLength;
      if (bytesTotal > maxBytes) throw new Error("Офлайн-комплект прогулки слишком большой.");
      audio.push({ chapterId: chapter.id, url: chapter.audio.url, sha256: chapter.audio.sha256, bytes: body.byteLength });
    }
    const manifest: OfflineWalkManifest = { version: 1, walkId, scope, revision: view.revision, contentVersion: view.contentVersion,
      savedAt: (options.now ?? (() => new Date()))().toISOString(), audio };
    await cache.put(`${stage}/view.json`, response(view));
    await cache.put(`${stage}/manifest.json`, response(manifest));
    const priorResponse = await cache.match(pointerKey(scope, walkId));
    const prior = priorResponse ? readPointer(await priorResponse.json().catch(() => null)) : null;
    const pointer: OfflinePointer = { version: 1, stage, manifest };
    await cache.put(pointerKey(scope, walkId), response(pointer));
    if (prior && prior.stage !== stage) await removeStage(cache, prior.stage);
    await pruneAudio(cache).catch(() => {});
    return { manifest, availableAudio: audio.length };
  } catch (error) {
    await removeStage(cache, stage).then(() => pruneAudio(cache)).catch(() => {});
    throw error instanceof Error ? error : new Error("Не удалось сохранить прогулку без сети.");
  }
}

export async function loadOfflineWalk({ scope, walkId }: OfflineWalkRef, cache?: CachePort): Promise<{ view: WalkView; manifest: OfflineWalkManifest } | null> {
  const storage = await openCache(cache);
  const pointerResponse = await storage.match(pointerKey(scope, walkId));
  const pointer = pointerResponse ? readPointer(await pointerResponse.json().catch(() => null)) : null;
  if (!pointer || pointer.manifest.scope !== scope || pointer.manifest.walkId !== walkId) return null;
  const viewResponse = await storage.match(`${pointer.stage}/view.json`);
  if (!viewResponse) return null;
  try {
    return { view: validateWalkView(await viewResponse.json()), manifest: pointer.manifest };
  } catch {
    return null;
  }
}

export async function removeOfflineWalk({ scope, walkId }: OfflineWalkRef, cache?: CachePort) {
  const storage = await openCache(cache);
  const pointerResponse = await storage.match(pointerKey(scope, walkId));
  const pointer = pointerResponse ? readPointer(await pointerResponse.json().catch(() => null)) : null;
  await storage.delete(pointerKey(scope, walkId));
  if (pointer) await removeStage(storage, pointer.stage);
  await pruneAudio(storage);
}

/** Removes every copy saved under `scope` and the recordings only they used. */
export async function clearOfflineScope(scope: string, cache?: CachePort) {
  const storage = await openCache(cache);
  const prefix = `${PACK_ROOT}${encode(scope)}/`;
  const keys = await storage.keys();
  await Promise.all(keys.filter(key => pathOf(key).startsWith(prefix)).map(key => storage.delete(key)));
  await pruneAudio(storage);
}

export async function isWalkOffline(ref: OfflineWalkRef, cache?: CachePort) {
  return Boolean(await loadOfflineWalk(ref, cache));
}
