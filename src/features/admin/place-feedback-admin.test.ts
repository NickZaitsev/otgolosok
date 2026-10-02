// @vitest-environment jsdom
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PlaceFeedbackAdmin } from "./place-feedback-admin";
import type { AdminApi, AdminRun } from "./model";

let root: Root, container: HTMLDivElement;
const request = vi.fn();
const item = { id: "feedback-id", place: { id: "osm:node:7", title: "Парк" }, rating: -1, issues: ["voiceover"], text: "<script>Слишком тихо</script>", status: "open", updatedAt: "2026-10-02T10:00:00Z" };
const page = { items: [item], total: 1, offset: 0, hasMore: false };
const api: AdminApi = async <T,>(path: string, _signal: AbortSignal, body?: unknown): Promise<T> => request(path, body) as Promise<T>;
function Harness() {
  const [busy, setBusy] = useState("");
  const run: AdminRun = async (label, action) => {
    setBusy(label);
    try { await action(new AbortController().signal); } catch { /* error is visible in the component */ }
    finally { setBusy(""); }
  };
  return createElement(PlaceFeedbackAdmin, { api, run, busy });
}
const button = (text: string) => [...container.querySelectorAll("button")].find(item => item.textContent === text)!;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  request.mockReset(); request.mockResolvedValue(page);
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
it("shows reasons and safely renders comments, then removes resolved requests", async () => {
  await act(async () => root.render(createElement(Harness)));
  await act(async () => button("Показать оценки мест").click());
  expect(container.textContent).toContain("Не нравится озвучка");
  expect(container.textContent).toContain(item.text);
  expect(container.querySelector("script")).toBeNull();
  request.mockImplementation(async (path: string) => path.endsWith("/resolve") ? { resolved: 1 } : { ...page, items: [], total: 0 });
  await act(async () => button("Отметить решённым").click());
  expect(container.textContent).toContain("Открытых запросов к местам нет.");
  expect(container.textContent).toContain("Запрос к месту «Парк» отмечен решённым.");
});
it("explains a load failure and offers a retry", async () => {
  request.mockRejectedValue(new Error("offline"));
  await act(async () => root.render(createElement(Harness)));
  await act(async () => button("Показать оценки мест").click());
  expect(container.querySelector("[role='alert']")?.textContent).toBe("Не удалось загрузить оценки мест.");
  request.mockResolvedValue(page);
  await act(async () => button("Повторить загрузку оценок мест").click());
  expect(container.querySelector("[role='alert']")).toBeNull();
  expect(container.textContent).toContain("Парк");
});
