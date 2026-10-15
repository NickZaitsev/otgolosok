// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { historicalWalkPhotos } from "./historical-photos";
import { HistoricalPhotos } from "./historical-photos-viewer";

vi.mock("@/lib/i18n/provider", () => ({ useI18n: () => ({ locale: "ru", t: (s: string, values?: Record<string, unknown>) => s.replace(/\{(\w+)\}/g, (_, k: string) => String(values?.[k] ?? k)) }) }));
const TVERSKAYA = "259d5970-d002-5dc4-b15f-b2a784c2dbb3";
let container: HTMLDivElement, root: Root;
const button = (label: string) => [...document.querySelectorAll("button")].find(node => node.getAttribute("aria-label") === label || node.textContent === label);
const open = async (walkId: string, stopId: string) => {
  await act(async () => root.render(createElement(HistoricalPhotos, { walkId, stopId })));
  await act(async () => button("Исторические снимки · 3")!.click());
  return document.querySelector("dialog[open]")!;
};
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); this.dispatchEvent(new Event("close")); };
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

it("открывает снимки внутри прогулки, а ссылка на PastVu есть только в просмотре", async () => {
  await act(async () => root.render(createElement(HistoricalPhotos, { walkId: TVERSKAYA, stopId: "tverskaya-stop-10" })));
  expect(container.querySelector("a")).toBeNull();
  const dialog = await open(TVERSKAYA, "tverskaya-stop-10");
  // Inside the walk tools their `button` rule stripped the arrows of their backdrop: the viewer must live in <body>.
  expect(container.contains(dialog)).toBe(false);
  expect(dialog.parentElement).toBe(document.body);
  expect(dialog.querySelector("h3")?.textContent).toBe("1901 · Контора Международного общества спальных вагонов на Страстном бульваре");
  expect(dialog.querySelector("img")?.getAttribute("alt")).toBe("Контора Международного общества спальных вагонов на Страстном бульваре, 1901 год");
  expect(dialog.querySelector("a")?.getAttribute("href")).toBe("https://pastvu.com/p/1344568");
});

it("листает снимки без выхода за края и возвращает фокус на кнопку", async () => {
  await open(TVERSKAYA, "tverskaya-stop-10");
  expect(button("Предыдущее фото")?.disabled).toBe(true);
  await act(async () => button("Следующее фото")!.click());
  await act(async () => button("Следующее фото")!.click());
  expect(button("Следующее фото")?.disabled).toBe(true);
  expect(document.querySelector("dialog[open] [role=status]")?.textContent).toBe("Фото 3 из 3");
  expect(document.querySelector("dialog[open] a")?.getAttribute("href")).toBe("https://pastvu.com/p/1036442");
  await act(async () => button("Закрыть фото")!.click());
  expect(document.querySelector("dialog[open]")).toBeNull();
  expect(document.activeElement).toBe(button("Исторические снимки · 3"));
});

it("предлагает повторить, если снимок не загрузился", async () => {
  const dialog = await open("5295c72b-5d9f-4142-9d26-fb4f367b8865", "boulevard-stop-1");
  await act(async () => dialog.querySelector("img")!.dispatchEvent(new Event("error")));
  expect(dialog.querySelector("[role=status] p")?.textContent).toContain("не загрузилась");
  await act(async () => button("Повторить")!.click());
  expect(dialog.querySelector("img")).not.toBeNull();
});

it("сообщает, если просмотр не открылся", async () => {
  HTMLDialogElement.prototype.showModal = () => { throw new DOMException("not allowed", "InvalidStateError"); };
  await act(async () => root.render(createElement(HistoricalPhotos, { walkId: TVERSKAYA, stopId: "tverskaya-stop-10" })));
  await act(async () => button("Исторические снимки · 3")!.click());
  expect(container.querySelector("p[role=status]")?.textContent).toBe("Не удалось открыть фотографию. Попробуйте ещё раз.");
});

it.each([
  ["у остановки без снимков", TVERSKAYA, "tverskaya-stop-2"],
  // Эта остановка есть только в бульварных прогулках: ключ «прогулка:остановка» не даёт снимкам перейти в Тверскую.
  ["у остановки чужой прогулки", TVERSKAYA, "boulevard-stop-1"],
  ["у неизвестной прогулки", "unknown-walk", "tverskaya-stop-10"],
])("ничего не показывает %s", async (_, walkId, stopId) => {
  await act(async () => root.render(createElement(HistoricalPhotos, { walkId, stopId })));
  expect(container.innerHTML).toBe("");
});

it.each([
  // Тот же id остановки у бульварной прогулки — Пушкинская площадь, а в Тверской — «Националь».
  ["0055eb13-d26d-4eab-b1f6-b25900bd7095", "tverskaya-stop-1", 1036442],
  [TVERSKAYA, "tverskaya-stop-1", 7141],
  [TVERSKAYA, "tverskaya-stop-3", 1370355],
  [TVERSKAYA, "tverskaya-stop-9", 230],
  [TVERSKAYA, "tverskaya-stop-12", 154120],
])("подбирает снимки по прогулке и остановке: %s %s", (walkId, stopId, cid) => {
  expect(historicalWalkPhotos(walkId, stopId).map(photo => photo.cid)).toContain(cid);
});

it("показывает торговые ряды у Красной площади и сохраняет диапазон дат снимка палаток", async () => {
  const walk = "956c756d-452f-59c9-a3a5-d935a3e90764";
  const dialog = await open(walk, "red-square-stop-4");
  expect(dialog.querySelector("h3")?.textContent).toContain("1852 · Старые Верхние торговые ряды");
  await act(async () => button("Следующее фото")!.click());
  await act(async () => button("Следующее фото")!.click());
  expect(dialog.querySelector("h3")?.textContent).toBe("1890–1905 · Торговые палатки на Красной площади");
  expect(dialog.querySelector("a")?.getAttribute("href")).toBe("https://pastvu.com/p/70775");
  expect(historicalWalkPhotos(walk, "red-square-stop-3")).toEqual([]);
});
