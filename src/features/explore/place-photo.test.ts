// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PlacePhotoBanner } from "./place-photo";

vi.mock("@/lib/i18n/provider", () => ({ useI18n: () => ({ locale: "ru", t: (s: string, values?: Record<string, unknown>) => s.replace(/\{(\w+)\}/g, (_, k: string) => String(values?.[k] ?? k)) }) }));
vi.mock("next/image", () => ({ default: (props: Record<string, unknown>) => { const imageProps = { ...props }; delete imageProps.unoptimized; return createElement("img", imageProps); } }));
let container: HTMLDivElement, root: Root;
const click = async (label: string) => {
  const scope = container.querySelector("dialog[open]") ?? container;
  const button = [...scope.querySelectorAll("button")].find(node => node.textContent === label || node.getAttribute("aria-label") === label);
  expect(button, label).toBeDefined();
  await act(async () => button!.click());
};
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); this.dispatchEvent(new Event("close")); };
});

const pointer = async (target: Element, type: string, x: number, y: number) => {
  const event = new MouseEvent(type, {bubbles:true, clientX:x, clientY:y, button:0});
  Object.defineProperties(event, {pointerId:{value:1}, isPrimary:{value:true}, pointerType:{value:"touch"}});
  await act(async () => target.dispatchEvent(event));
};

it("листит обложки стрелками без открытия галереи и открывает выбранный кадр", async () => {
  await act(async () => root.render(createElement(PlacePhotoBanner, {placeId:"osm:way:48859891", title:"Палаты"})));
  expect(container.querySelector('[aria-label="Предыдущее фото"]')?.getAttribute('disabled')).toBe("");
  await click("Следующее фото");
  expect(container.querySelector('[data-photo-banner] img')?.getAttribute('alt')).toContain("1867");
  expect(container.querySelector("dialog[open]")).toBeNull();
  expect(container.querySelector('[aria-label="Следующее фото"]')?.getAttribute('disabled')).toBe("");
  await click("Открыть фото: Палаты");
  expect(container.querySelector('dialog[open] img')?.getAttribute('alt')).toContain("1867");
});

it("свайп меняет превью, подавляет случайное открытие и не выходит за края", async () => {
  await act(async () => root.render(createElement(PlacePhotoBanner, {placeId:"osm:way:48859891", title:"Палаты"})));
  const banner=container.querySelector('[data-photo-banner]')!;
  await pointer(banner,"pointerdown",200,60); await pointer(banner,"pointermove",110,65); await pointer(banner,"pointerup",110,65);
  await act(async () => (banner as HTMLButtonElement).click());
  expect(container.querySelector('[data-photo-banner] img')?.getAttribute('alt')).toContain("1867");
  expect(container.querySelector("dialog[open]")).toBeNull();
  await pointer(banner,"pointerdown",200,60); await pointer(banner,"pointerup",90,60);
  expect(container.querySelector('[data-photo-banner] img')?.getAttribute('alt')).toContain("1867");
  await pointer(banner,"pointerdown",90,60); await pointer(banner,"pointerup",200,60);
  expect(container.querySelector('[data-photo-banner] img')?.getAttribute('alt')).toContain("1927");
  await pointer(banner,"pointerdown",100,60); await pointer(banner,"pointerup",110,160);
  expect(container.querySelector('[data-photo-banner] img')?.getAttribute('alt')).toContain("1927");
  await pointer(banner,"pointerdown",200,60); await pointer(banner,"pointercancel",110,60); await pointer(banner,"pointerup",110,60);
  expect(container.querySelector('[data-photo-banner] img')?.getAttribute('alt')).toContain("1927");
});

it("стрелки в свёрнутой карточке меняют снимок, сохраняя обычное нажатие для открытия истории", async () => {
  const expand=vi.fn();
  await act(async () => root.render(createElement(PlacePhotoBanner, {placeId:"osm:way:48859891", title:"Палаты", onPreview:expand})));
  await click("Следующее фото");
  expect(container.querySelector('[data-photo-banner] img')?.getAttribute('alt')).toContain("1867");
  expect(expand).not.toHaveBeenCalled();
  await act(async () => (container.querySelector('[data-photo-banner]') as HTMLElement).click());
  expect(expand).toHaveBeenCalledOnce();
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
  expect(dialog.querySelector<HTMLButtonElement>('[aria-label="Предыдущее фото"]')?.disabled).toBe(true);
  await click("Следующее фото");
  expect(dialog.textContent).toContain("1867");
  expect(dialog.textContent).toContain("Автор неизвестен");
  expect(dialog.querySelector<HTMLButtonElement>('[aria-label="Следующее фото"]')?.disabled).toBe(true);
  expect(dialog.querySelector('a[href*="1867_Moscow"]')).not.toBeNull();
  await click("Закрыть фото");
  expect(dialog.hasAttribute("open")).toBe(false);
  expect(document.activeElement).toBe(container.querySelector("[data-photo-banner]"));
});

it("просмотрщик листается жестами без текстовых кнопок, сохраняет границы, подпись и выбранное превью", async () => {
  await act(async () => root.render(createElement(PlacePhotoBanner, {placeId:"osm:way:48859891", title:"Палаты"})));
  await click("Открыть фото: Палаты");
  const dialog=container.querySelector('dialog[open]')!;
  const slider=dialog.querySelector('[data-photo-slider]')!;
  expect(slider).not.toBeNull();
  expect(dialog.textContent).not.toContain("Следующее фото");
  expect(dialog.textContent).not.toContain("Предыдущее фото");
  await pointer(slider,"pointerdown",200,60);await pointer(slider,"pointermove",100,60);await pointer(slider,"pointerup",100,60);
  expect(dialog.querySelector('img')?.getAttribute('alt')).toContain("1867");
  expect(dialog.querySelector('[role="status"]')?.textContent).toBe("Фото 2 из 2");
  expect(dialog.querySelector('a[href*="1867_Moscow"]')).not.toBeNull();
  await pointer(slider,"pointerdown",200,60);await pointer(slider,"pointerup",100,60);
  expect(dialog.querySelector('img')?.getAttribute('alt')).toContain("1867");
  await pointer(slider,"pointerdown",100,60);await pointer(slider,"pointerup",110,180);
  await pointer(slider,"pointerdown",100,60);await pointer(slider,"pointercancel",200,60);await pointer(slider,"pointerup",200,60);
  expect(dialog.querySelector('img')?.getAttribute('alt')).toContain("1867");
  await pointer(slider,"pointerdown",100,60);await pointer(slider,"pointerup",200,60);
  expect(dialog.querySelector('img')?.getAttribute('alt')).toContain("1927");
  await click("Следующее фото");await click("Закрыть фото");
  expect(container.querySelector('[data-photo-banner] img')?.getAttribute('alt')).toContain("1867");
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
