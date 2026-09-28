import { webcrypto } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WalkView } from "./model";
import { clearOfflineScope, loadOfflineWalk, offlineWalkRef, removeOfflineWalk, saveWalkOffline, type OfflineWalkRef } from "./offline";
import { loadWalkWithOfflineCopy, WalkLoadError } from "./walk-loader";

class MemoryCache {
  entries = new Map<string, Response>();
  key(key: RequestInfo) { return typeof key === "string" ? key : new URL(key.url).pathname; }
  async match(key: RequestInfo) { return this.entries.get(this.key(key))?.clone(); }
  async put(key: RequestInfo, value: Response) { this.entries.set(this.key(key), value.clone()); }
  async delete(key: RequestInfo) { return this.entries.delete(this.key(key)); }
  async keys() { return [...this.entries.keys()].map(key => new Request(`https://offline.test${key}`)); }
}

const audioBody = new TextEncoder().encode("audio bytes");
const audioHash = "ef71589075ccf9332917b0d8d711d1a8d205560f96842f9221de70e6c29454e0";
const audioUrl = `/api/story-audio/${audioHash}.mp3`;
const view: WalkView = {
  document: { version: 2, id: "11111111-1111-4111-8111-111111111111", title: "Арбат", description: "", city: "Москва", mode: "open", minutes: 30,
    start: { address: "Москва, Арбат, 1", location: { lat: 55.75, lon: 37.6 } }, stops: [{ id: "22222222-2222-4222-8222-222222222222", place: { address: "Москва, Арбат, 10", location: { lat: 55.751, lon: 37.601 } }, storyRef: null, transition: "", nextHint: "" }], route: null, fieldChecked: false },
  revision: 1, contentVersion: "version-1", chapters: [{ id: "22222222-2222-4222-8222-222222222222", status: "ready", story: { title: "Дом", address: "Москва, Арбат, 10", paragraphs: [{ text: "История дома.", factIds: [] }], sources: [], facts: [] }, audio: { url: audioUrl, sha256: audioHash, durationSec: 12 } }],
};
const otherView: WalkView = { ...view, document: { ...view.document, id: "33333333-3333-4333-8333-333333333333" } };
const silentView: WalkView = { ...view, chapters: view.chapters.map(chapter => ({ ...chapter, audio: null })) };
const audioFetcher = () => vi.fn(async () => new Response(audioBody, { status: 200, headers: { "Content-Type": "audio/mpeg", "Content-Length": String(audioBody.byteLength) } }));
const userRef: OfflineWalkRef = { scope: "user-one", walkId: view.document.id };
const catalogRef = offlineWalkRef("catalog", "arbat", null)!;
const sharedRef = offlineWalkRef("share", "share-token", null)!;

async function sha256(bytes: Uint8Array) {
  const digest = await webcrypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

afterEach(() => { vi.unstubAllGlobals(); });

describe("офлайн-комплект прогулки", () => {
  it("публикует указатель только после проверки записи и разделяет владельцев", async () => {
    const cache = new MemoryCache();
    const saved = await saveWalkOffline(view, userRef, { cache, fetcher: audioFetcher(), now: () => new Date("2026-09-21T12:00:00Z") });
    expect(saved.availableAudio).toBe(1);
    expect(await sha256(audioBody)).toBe(audioHash);
    expect((await loadOfflineWalk(userRef, cache))?.manifest.scope).toBe("user-one");
    expect(await loadOfflineWalk({ ...userRef, scope: "user-two" }, cache)).toBeNull();
  });

  it("keeps the previous package when a replacement download is invalid", async () => {
    const cache = new MemoryCache();
    const validView = { ...view, chapters: view.chapters.map(chapter => ({ ...chapter, audio: chapter.audio && { ...chapter.audio, url: "/audio/walk/recording.mp3" } })) };
    await saveWalkOffline(validView, userRef, { cache, fetcher: audioFetcher() });
    const broken = { ...validView, revision: 2, contentVersion: "version-2", chapters: validView.chapters.map(chapter => ({ ...chapter, audio: chapter.audio && { ...chapter.audio, url: "/audio/walk/other.mp3" } })) };
    await expect(saveWalkOffline(broken, userRef, { cache, fetcher: vi.fn(async () => new Response("wrong", { status: 200 })) })).rejects.toThrow("контрольной суммой");
    expect((await loadOfflineWalk(userRef, cache))?.manifest.revision).toBe(1);
    expect(await cache.match("/audio/walk/recording.mp3")).toBeDefined();
  });

  it("берёт уже сохранённую запись без повторной загрузки и удаляет её вместе с последней копией", async () => {
    const cache = new MemoryCache();
    await saveWalkOffline(view, catalogRef, { cache, fetcher: audioFetcher() });
    const second = audioFetcher();
    await saveWalkOffline(otherView, sharedRef, { cache, fetcher: second });
    expect(second).not.toHaveBeenCalled();

    await removeOfflineWalk(catalogRef, cache);
    expect(await loadOfflineWalk(catalogRef, cache)).toBeNull();
    expect(await cache.match(audioUrl)).toBeDefined();
    expect((await loadOfflineWalk(sharedRef, cache))?.manifest.audio).toHaveLength(1);

    await removeOfflineWalk(sharedRef, cache);
    expect([...cache.entries.keys()]).toEqual([]);
  });

  it("не удаляет запись, которую использует сохранённый опубликованный маршрут", async () => {
    const cache = new MemoryCache();
    await cache.put("/api/story-walks/route-1", new Response(JSON.stringify({ id: "route-1", walk: { steps: [{ audio: { url: audioUrl } }] } })));
    await saveWalkOffline(view, catalogRef, { cache, fetcher: audioFetcher() });
    await removeOfflineWalk(catalogRef, cache);
    expect(await cache.match(audioUrl)).toBeDefined();
  });

  it("при выходе удаляет приватные копии пользователя и их записи, но оставляет публичные", async () => {
    const cache = new MemoryCache();
    await saveWalkOffline(view, userRef, { cache, fetcher: audioFetcher() });
    await saveWalkOffline(silentView, catalogRef, { cache, fetcher: audioFetcher() });
    await clearOfflineScope("user-one", cache);
    expect(await loadOfflineWalk(userRef, cache)).toBeNull();
    expect(await cache.match(audioUrl)).toBeUndefined();
    expect(await loadOfflineWalk(catalogRef, cache)).not.toBeNull();
  });
});

describe("адрес офлайн-копии", () => {
  it.each([
    ["id", "walk-1", "user-1", { scope: "user-1", walkId: "walk-1" }],
    ["id", "walk-1", null, null],
    ["catalog", "arbat", "user-1", { scope: "public:catalog", walkId: "arbat" }],
    ["share", "token", null, { scope: "public:shared", walkId: "token" }],
    ["local", "local-1", "user-1", { scope: "device:local", walkId: "local-1" }],
    ["catalog", "", null, null],
  ] as const)("%s/%s для пользователя %s", (kind, key, userId, expected) => {
    expect(offlineWalkRef(kind, key, userId)).toEqual(expected);
  });
});

describe("открытие прогулки без сети", () => {
  const signal = () => new AbortController().signal;
  async function withSavedCopy(ref: OfflineWalkRef) {
    const cache = new MemoryCache();
    await saveWalkOffline(silentView, ref, { cache, now: () => new Date("2026-09-21T12:00:00Z") });
    vi.stubGlobal("caches", { open: async () => cache });
  }

  it.each([
    ["каталога", catalogRef],
    ["по ссылке", sharedRef],
    ["локальной", offlineWalkRef("local", "local-1", null)!],
    ["из аккаунта", userRef],
  ])("открывает сохранённую копию прогулки %s при сбое сети или сервера", async (_, ref) => {
    await withSavedCopy(ref);
    for (const failure of [new TypeError("Failed to fetch"), new WalkLoadError("Сбой", 503, true)]) {
      const loaded = await loadWalkWithOfflineCopy(async () => { throw failure; }, ref, signal());
      expect(loaded).toEqual({ view: silentView, offline: true, savedAt: "2026-09-21T12:00:00.000Z" });
    }
  });

  it("не подменяет копией удалённую или недоступную прогулку", async () => {
    await withSavedCopy(catalogRef);
    for (const status of [403, 404]) {
      const failure = new WalkLoadError("Нет", status);
      await expect(loadWalkWithOfflineCopy(async () => { throw failure; }, catalogRef, signal())).rejects.toBe(failure);
    }
  });

  it("возвращает сетевую ошибку, если копии нет или она не подходит", async () => {
    await withSavedCopy(catalogRef);
    const failure = new TypeError("Failed to fetch");
    await expect(loadWalkWithOfflineCopy(async () => { throw failure; }, sharedRef, signal())).rejects.toBe(failure);
    await expect(loadWalkWithOfflineCopy(async () => { throw failure; }, null, signal())).rejects.toBe(failure);
    await expect(loadWalkWithOfflineCopy(async () => { throw failure; }, catalogRef, signal(), saved => saved.revision === 2)).rejects.toBe(failure);
  });

  it("открывает свежую версию из сети, когда она доступна", async () => {
    await withSavedCopy(catalogRef);
    await expect(loadWalkWithOfflineCopy(async () => otherView, catalogRef, signal())).resolves.toEqual({ view: otherView, offline: false });
  });
});
