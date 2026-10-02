// @vitest-environment jsdom
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ImprovementsAdmin } from "./improvements-admin";
import type { AdminApi, AdminRun } from "./model";

const arbat = {
  walk: { kind: "catalog", id: "arbat", title: "Арбат", url: "/walk?catalog=arbat" },
  total: 3, open: 3, lastAt: "2026-10-02T10:00:00Z", issues: { short_text: 2, no_images: 0, voiceover: 1 },
};
const page = { walks: [arbat], total: 1, offset: 0, hasMore: false, open: 3 };
let root: Root, container: HTMLDivElement;
const request = vi.fn();
const api: AdminApi = async <T,>(path: string, _signal: AbortSignal, body?: unknown): Promise<T> => request(path, body) as Promise<T>;

function Harness() {
  const [busy, setBusy] = useState("");
  const run: AdminRun = async (label, action) => {
    setBusy(label);
    try { await action(new AbortController().signal); } catch { /* The component shows its own error. */ }
    finally { setBusy(""); }
  };
  return createElement(ImprovementsAdmin, { api, run, busy });
}
const button = (text: string) => [...container.querySelectorAll("button")].find(item => item.textContent === text)!;
async function mount() { await act(async () => root.render(createElement(Harness))); }
const cells = () => [...container.querySelectorAll("tbody tr:first-child > *")].map(cell => cell.textContent);
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  request.mockReset();
  request.mockImplementation(async (path: string) => path.startsWith("/improvements?") ? page : { resolved: 3 });
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it("opens on open requests and shows the counts of every option per walk", async () => {
  await mount();
  expect(request).toHaveBeenCalledWith("/improvements?status=open&limit=25&offset=0", undefined);
  expect(container.textContent).toContain("Открытых запросов: 3");
  expect([...container.querySelectorAll("thead th")].map(cell => cell.textContent)).toEqual(["Прогулка", "Всего", "Мало информации", "Нет превью", "Озвучка", "Последний", "Действия"]);
  expect(cells().slice(1, 5)).toEqual(["3", "2", "—", "1"]);
  expect(container.querySelector("tbody a")?.getAttribute("href")).toBe("/walk?catalog=arbat");
});

it("filters by option and resolves the requests of one walk", async () => {
  await mount();
  await act(async () => {
    const select = [...container.querySelectorAll("label")].find(label => label.textContent?.startsWith("Причина"))!.querySelector("select")!;
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!;
    setter.call(select, "voiceover");
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await act(async () => button("Найти").click());
  expect(request).toHaveBeenLastCalledWith("/improvements?status=open&issue=voiceover&limit=25&offset=0", undefined);
  await act(async () => button("Отметить решёнными").click());
  expect(request).toHaveBeenCalledWith("/improvements/resolve", { kind: "catalog", id: "arbat" });
  expect(container.textContent).toContain("Запросы к прогулке «Арбат» отмечены решёнными.");
  expect(request).toHaveBeenLastCalledWith("/improvements?status=open&issue=voiceover&limit=25&offset=0", undefined);
});

it("shows resolved walks without the resolve action and explains an empty queue", async () => {
  request.mockImplementation(async () => ({ ...page, walks: [{ ...arbat, open: 0 }] }));
  await mount();
  expect(container.textContent).toContain("Решены");
  expect(button("Отметить решёнными")).toBeUndefined();
  request.mockImplementation(async () => ({ walks: [], total: 0, offset: 0, hasMore: false, open: 0 }));
  await act(async () => button("Обновить список").click());
  expect(container.textContent).toContain("Открытых запросов на улучшение нет.");
});
