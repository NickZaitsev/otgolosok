// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PlaceVideo } from "./place-video";

vi.mock("./place-videos.json", () => ({ default: { "osm:relation:1794442": { youtubeId: "abcdefghijk", durationSeconds: 79.5, privacy: "unlisted" }, "osm:node:1": { youtubeId: "https://evil.test", privacy: "unlisted" } } }));
vi.mock("@/lib/i18n/provider", () => ({ useI18n: () => ({ t: (s: string, values?: Record<string, unknown>) => s.replace(/\{(\w+)\}/g, (_, k: string) => String(values?.[k] ?? k)) }) }));
let container: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); this.dispatchEvent(new Event("close")); };
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
const render = async (placeId = "osm:relation:1794442") => act(async () => root.render(createElement(PlaceVideo, {placeId, title:"Мост"})));
const click = async (label: string) => {
  const button = [...container.querySelectorAll("button")].find(b => b.textContent === label || b.getAttribute("aria-label") === label);
  expect(button).toBeDefined(); await act(async () => button!.click());
};

it("загружает YouTube только по нажатию, сохраняет Referer и удаляет плеер после закрытия", async () => {
  await render(); expect(container.querySelector("iframe")).toBeNull();
  await click("Смотреть видео");
  const iframe = container.querySelector("iframe")!;
  expect(iframe.src).toBe("https://www.youtube-nocookie.com/embed/abcdefghijk?playsinline=1&rel=0&controls=0&iv_load_policy=3&autoplay=1");
  expect(iframe.getAttribute("referrerpolicy")).toBe("strict-origin-when-cross-origin");
  expect(iframe.title).toContain("Мост");
  expect(container.querySelector('dialog')?.getAttribute('aria-label')).toBe("Видео: Мост");
  expect(container.querySelector('a[href="https://www.youtube.com/watch?v=abcdefghijk"]')).not.toBeNull();
  await click("Закрыть видео"); expect(container.querySelector("iframe")).toBeNull();
  expect(document.activeElement).toBe(container.querySelector("[data-video-trigger]"));
});

it("не показывает неизвестную точку или неподходящий идентификатор YouTube", async () => {
  await render("osm:node:0"); expect(container.children).toHaveLength(0);
  await render("osm:node:1"); expect(container.children).toHaveLength(0);
});

it("при ошибке открытия оставляет рабочую ссылку, а при ошибке iframe разрешает повтор", async () => {
  await render(); HTMLDialogElement.prototype.showModal = () => { throw new Error("Unsupported"); };
  await click("Смотреть видео"); expect(container.querySelector('[role="alert"]')?.textContent).toContain("Не удалось открыть видео");
  expect(container.querySelector('a[href*="youtube.com/watch"]')).not.toBeNull();
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  await click("Смотреть видео");
  await act(async () => container.querySelector("iframe")!.dispatchEvent(new Event("error")));
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("Не удалось загрузить видео");
  await click("Повторить загрузку видео"); expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(container.querySelector("iframe")).not.toBeNull();
});

it("перед просмотром приостанавливает местную озвучку, не сбрасывая её позицию", async () => {
  const audio = document.createElement("audio"); audio.currentTime = 12; container.append(audio);
  const pause = vi.spyOn(audio, "pause").mockImplementation(() => {});
  // Place audio lives beside the video component, outside its React root.
  document.body.append(audio);
  try { await render(); await click("Смотреть видео"); expect(pause).toHaveBeenCalledOnce(); expect(audio.currentTime).toBe(12); }
  finally { audio.remove(); }
});
