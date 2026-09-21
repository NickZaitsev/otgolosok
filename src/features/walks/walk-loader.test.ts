import { describe, expect, it, vi } from "vitest";
import { loadCatalogCards, loadJson, loadLocalWalkView, WalkLoadError } from "./walk-loader";
import type { WalkDocument } from "./model";

describe("загрузка прогулок", () => {
  it("повторяет сетевой сбой, но не повторяет ошибку схемы", async () => {
    const fetcher = vi.fn()
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockResolvedValueOnce(new Response(JSON.stringify({ walks: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetcher);
    await expect(loadCatalogCards(new AbortController().signal)).resolves.toEqual([]);
    expect(fetcher).toHaveBeenCalledTimes(2);

    fetcher.mockReset().mockResolvedValue(new Response("{}", { status: 200 }));
    await expect(loadCatalogCards(new AbortController().signal)).rejects.toMatchObject({ retryable: false });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("сохраняет статус и Retry-After для временного ответа", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: "Занято" } }), { status: 429, headers: { "Retry-After": "1" } }));
    vi.stubGlobal("fetch", fetcher);
    await expect(loadJson("/api/story-walks", new AbortController().signal, value => value, 1)).rejects.toEqual(expect.objectContaining({
      status: 429,
      retryable: true,
      retryAfterMs: 1000,
    } satisfies Partial<WalkLoadError>));
  });

  it("подтягивает готовую историю локального документа, не создавая новую задачу", async () => {
    const jobId = "11111111-1111-4111-8111-111111111111";
    const document: WalkDocument = { version: 2, id: "22222222-2222-4222-8222-222222222222", title: "Арбат", description: "", city: "Москва", mode: "open", minutes: 30,
      start: { address: "Москва, Арбат, 1", location: { lat: 55.75, lon: 37.6 } }, stops: [{ id: "33333333-3333-4333-8333-333333333333", place: { address: "Москва, Арбат, 10", location: { lat: 55.751, lon: 37.601 } }, storyRef: { kind: "job", id: jobId }, transition: "", nextHint: "" }], route: null, fieldChecked: false };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: jobId, stage: "ready", story: { title: "История дома", address: "Москва, Арбат, 10", paragraphs: [{ text: "Проверенный рассказ.", factIds: [] }], sources: [], facts: [] }, audio: { url: `/api/story-audio/${"a".repeat(64)}.mp3`, sha256: "a".repeat(64), durationSec: 12 } }), { status: 200 })));
    const result = await loadLocalWalkView(document, 0, new AbortController().signal);
    expect(result.chapters[0].status).toBe("ready");
    expect(result.chapters[0].audio?.durationSec).toBe(12);
  });
});
