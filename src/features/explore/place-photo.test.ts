// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PlacePhotoBanner } from "./place-photo";

vi.mock("@/lib/i18n/provider", () => ({ useI18n: () => ({ locale: "ru", t: (s: string, values?: Record<string, unknown>) => s.replace(/\{(\w+)\}/g, (_, k: string) => String(values?.[k] ?? k)) }) }));
vi.mock("next/image", () => ({ default: (props: Record<string, unknown>) => { const imageProps = { ...props }; delete imageProps.unoptimized; return createElement("img", imageProps); } }));
let container: HTMLDivElement, root: Root;
const click = async (label: string) => {
  const button = [...container.querySelectorAll("button")].find(node => node.textContent === label || node.getAttribute("aria-label") === label);
  expect(button, label).toBeDefined();
  await act(async () => button!.click());
};
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); this.dispatchEvent(new Event("close")); };
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

it("показывает архивное превью, переключает подписи и авторство, ограничивает края и возвращает фокус", async () => {
  await act(async () => root.render(createElement(PlacePhotoBanner, { placeId: "osm:way:48859891", title: "Палаты", pending: true })));
  expect(container.querySelector("[data-photo-banner] img")).not.toBeNull();
  expect(container.querySelector("[data-photo-placeholder]")).toBeNull();
  await click("Открыть фото: Палаты");
  const dialog = container.querySelector("dialog")!;
  expect(dialog.textContent).toContain("1927");
  expect(dialog.textContent).toContain("Александр Александрович Губарев");
  expect([...dialog.querySelectorAll("button")].find(b => b.textContent === "Предыдущее фото")?.disabled).toBe(true);
  await click("Следующее фото");
  expect(dialog.textContent).toContain("1867");
  expect(dialog.textContent).toContain("Автор неизвестен");
  expect([...dialog.querySelectorAll("button")].find(b => b.textContent === "Следующее фото")?.disabled).toBe(true);
  expect(dialog.querySelector('a[href*="1867_Moscow"]')).not.toBeNull();
  await click("Закрыть фото");
  expect(dialog.hasAttribute("open")).toBe(false);
  expect(document.activeElement).toBe(container.querySelector("[data-photo-banner]"));
});

it("ошибка снимка не мешает открыть другой кадр и повторить загрузку", async () => {
  await act(async () => root.render(createElement(PlacePhotoBanner, { placeId: "osm:way:48859891", title: "Палаты" })));
  await click("Открыть фото: Палаты");
  const dialog = container.querySelector("dialog")!;
  await act(async () => dialog.querySelector("img")!.dispatchEvent(new Event("error")));
  expect(dialog.textContent).toContain("Фотография не загрузилась");
  await click("Повторить");
  expect(dialog.querySelector("img")).not.toBeNull();
  await act(async () => dialog.querySelector("img")!.dispatchEvent(new Event("error")));
  await click("Следующее фото");
  expect(dialog.textContent).not.toContain("Фотография не загрузилась");
  expect(dialog.querySelector("img")?.getAttribute("alt")).toContain("1867");
});

it("не создаёт пустую галерею у места без изображения", async () => {
  await act(async () => root.render(createElement(PlacePhotoBanner, { placeId: "osm:node:0", title: "Нет фото" })));
  expect(container.children).toHaveLength(0);
});

it("при ошибке обложки показывает следующий кадр, а ошибку единственного снимка скрывает", async () => {
  await act(async () => root.render(createElement(PlacePhotoBanner, { placeId: "osm:way:48859891", title: "Палаты" })));
  await act(async () => container.querySelector("[data-photo-banner] img")!.dispatchEvent(new Event("error")));
  expect(container.querySelector("[data-photo-banner] img")?.getAttribute("alt")).toContain("1867");
  await click("Открыть фото: Палаты");
  expect(container.querySelector("dialog img")?.getAttribute("alt")).toContain("1867");
  await click("Закрыть фото");
  await act(async () => container.querySelector("[data-photo-banner] img")!.dispatchEvent(new Event("error")));
  expect(container.querySelector("[data-photo-banner]")).toBeNull();
});
