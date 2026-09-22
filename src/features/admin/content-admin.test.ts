// @vitest-environment jsdom

import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ContentAdmin } from "./content-admin";
import type { AdminApi, AdminRun, ContentPlace } from "./model";

const story = { title: "История дома", paragraphs: [{ text: "Текст истории", factIds: [] }] };
const places: ContentPlace[] = [
  { id: "osm:node:1", name: "Первое место", address: null, location: { lat: 55, lon: 37 },
    text: { id: "text-1", profile: "story-v1", story, draft: story, verification: "editorial", audio: null, createdAt: "2026-09-22" } },
  { id: "osm:node:2", name: "Место без текста", address: null, location: { lat: 55, lon: 37 }, text: null },
];

let root: Root;
let container: HTMLDivElement;
let failDetail: boolean;
let scrolled: Element[];
const onDirtyChange = vi.fn();

const api: AdminApi = async <T,>(path: string): Promise<T> => {
  if (path.startsWith("/content/places/")) {
    if (failDetail) throw new Error("Не удалось загрузить место");
    return { place: structuredClone(places.find(place => path.endsWith(place.id))) } as T;
  }
  if (path.startsWith("/content/places?")) return { places: places.map(place => ({ ...place, textStatus: place.text ? "approved" : "none", audio: null })), total: 2, hasMore: false } as T;
  const responses: Record<string, unknown> = {
    "/content/batches": { batches: [] },
    "/content/stats": { places: 2, texts: 1, audio: 0 },
    "/content/workers": { workers: [], heartbeats: [] },
    "/content/audio": { audioJobs: [] },
  };
  if (!(path in responses)) throw new Error(`Неожиданный запрос: ${path}`);
  return responses[path] as T;
};

function Harness() {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const run: AdminRun = async (label, action) => {
    setBusy(label); setError("");
    try { await action(new AbortController().signal); }
    catch (cause) { setError((cause as Error).message); }
    finally { setBusy(""); }
  };
  return createElement("div", null,
    error && createElement("p", { role: "alert" }, error),
    createElement(ContentAdmin, { api, run, busy, onDirtyChange }));
}

function buttons(label: string) {
  return [...container.querySelectorAll("button")].filter(button => button.textContent === label);
}

async function click(button: HTMLButtonElement) {
  await act(async () => { button.focus(); button.click(); });
}

function editorHeading() {
  return container.querySelector("article h3");
}

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  failDetail = false;
  scrolled = [];
  Object.defineProperty(Element.prototype, "scrollIntoView", {
    configurable: true, value: function (this: Element) { scrolled.push(this); },
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => { root.render(createElement(Harness)); });
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  vi.restoreAllMocks();
  Reflect.deleteProperty(Element.prototype, "scrollIntoView");
  vi.unstubAllGlobals();
  onDirtyChange.mockClear();
});

describe("переход из каталога к редактору места", () => {
  it("открывает текст, прокручивает к заголовку и переводит на него фокус", async () => {
    await click(buttons("Открыть")[0]);
    expect(container.querySelector<HTMLInputElement>("#content-title")?.value).toBe(story.title);
    expect(editorHeading()?.textContent).toBe(places[0].name);
    expect(document.activeElement).toBe(editorHeading());
    expect(scrolled.at(-1)).toBe(editorHeading());
  });

  it("переходит к уже открытому месту при повторном нажатии", async () => {
    const opener = buttons("Открыть")[0];
    await click(opener);
    scrolled = [];
    await click(opener);
    expect(document.activeElement).toBe(editorHeading());
    expect(scrolled).toEqual([editorHeading()]);
  });

  it("показывает другое место без текста и возвращает к его строке после закрытия", async () => {
    await click(buttons("Открыть")[0]);
    const opener = buttons("Открыть")[1];
    await click(opener);
    expect(editorHeading()?.textContent).toBe(places[1].name);
    expect(container.querySelector("article")?.textContent).toContain("текст ещё не создан");
    expect(document.activeElement).toBe(editorHeading());
    await click(buttons("Закрыть")[0]);
    expect(container.querySelector("article")).toBeNull();
    expect(document.activeElement).toBe(opener);
    expect(scrolled.at(-1)).toBe(opener);
  });

  it("при ошибке загрузки сохраняет текущий редактор и не запускает переход", async () => {
    await click(buttons("Открыть")[0]);
    failDetail = true;
    scrolled = [];
    const opener = buttons("Открыть")[1];
    await click(opener);
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("Не удалось загрузить место");
    expect(editorHeading()?.textContent).toBe(places[0].name);
    expect(document.activeElement).toBe(opener);
    expect(scrolled).toEqual([]);
  });

  it("отмена потери правок сохраняет текст и не меняет место", async () => {
    await click(buttons("Открыть")[0]);
    const input = container.querySelector<HTMLInputElement>("#content-title")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Моя правка");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    vi.spyOn(window, "confirm").mockReturnValue(false);
    scrolled = [];
    await click(buttons("Открыть")[1]);
    await click(buttons("Закрыть")[0]);
    expect(editorHeading()?.textContent).toBe(places[0].name);
    expect(input.value).toBe("Моя правка");
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
    expect(scrolled).toEqual([]);
  });
});
