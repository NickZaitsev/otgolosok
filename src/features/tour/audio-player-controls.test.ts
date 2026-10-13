// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { I18nProvider } from "@/lib/i18n/provider";
import { AudioPlayerControls, nextPlaybackRate } from "./audio-player-controls";

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function renderPlayer(position: number, duration: number, canSeek = true, walk = true, mini = false) {
  const onSeek = vi.fn();
  const onToggle = vi.fn();
  await act(async () => root.render(createElement(I18nProvider, { locale: "ru" },
    createElement(AudioPlayerControls, { compact: true, walk, mini, position, duration, canSeek, playing: false, label: "Слушать", onSeek, onToggle }))));
  const button = (name: string) => container.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`);
  return { onSeek, onToggle, button };
}

it("плеер прогулки перематывает на 15 секунд в пределах записи", async () => {
  let player = await renderPlayer(10, 60);
  await act(async () => player.button("Назад на 15 секунд")!.click());
  expect(player.onSeek).toHaveBeenCalledWith(0);
  player = await renderPlayer(55, 60);
  await act(async () => player.button("Вперёд на 15 секунд")!.click());
  expect(player.onSeek).toHaveBeenCalledWith(60);
  await act(async () => player.button("Слушать")!.click());
  expect(player.onToggle).toHaveBeenCalledTimes(1);
});

it("блокирует перемотку без готовой записи и на границах", async () => {
  let player = await renderPlayer(0, 60);
  expect(player.button("Назад на 15 секунд")?.disabled).toBe(true);
  player = await renderPlayer(60, 60);
  expect(player.button("Вперёд на 15 секунд")?.disabled).toBe(true);
  player = await renderPlayer(20, 60, false);
  expect(player.button("Назад на 15 секунд")?.disabled).toBe(true);
  expect(player.button("Вперёд на 15 секунд")?.disabled).toBe(true);
  expect(container.querySelector<HTMLInputElement>('input[type="range"]')?.disabled).toBe(true);
});

it("плеер карточки места сохраняет прежний набор кнопок", async () => {
  await renderPlayer(20, 60, true, false);
  expect(container.querySelector('button[aria-label="Слушать"]')).not.toBeNull();
  expect(container.querySelector('button[aria-label="Назад на 15 секунд"]')).toBeNull();
});

it("мини-плеер под открытым ящиком управляет звуком без надписи на кнопке", async () => {
  const player = await renderPlayer(20, 60, true, true, true);
  await act(async () => player.button("Назад на 15 секунд")!.click());
  expect(player.onSeek).toHaveBeenCalledWith(5);
  await act(async () => player.button("Слушать")!.click());
  expect(player.onToggle).toHaveBeenCalledTimes(1);
  expect(player.button("Слушать")!.textContent).toBe("");
  expect(container.querySelector<HTMLInputElement>('input[type="range"]')?.value).toBe("20");
});

it.each([
  { rate: 0.8, next: 1 },
  { rate: 1, next: 1.25 },
  { rate: 1.25, next: 1.5 },
  { rate: 1.5, next: 0.8 },
] as const)("кнопка скорости переключает $rate× на $next×", ({ rate, next }) => {
  expect(nextPlaybackRate(rate)).toBe(next);
});

it("плеер прогулки показывает скорость и меняет её одной кнопкой, мини-плеер — без неё", async () => {
  const onRate = vi.fn();
  const render = (mini: boolean) => act(async () => root.render(createElement(I18nProvider, { locale: "ru" },
    createElement(AudioPlayerControls, { compact: true, walk: true, mini, position: 0, duration: 60, canSeek: true, playing: false, label: "Слушать", onSeek: vi.fn(), onToggle: vi.fn(), rate: 1.25, onRate }))));
  await render(false);
  const rate = container.querySelector<HTMLButtonElement>('button[aria-label="Скорость рассказа: 1,25×"]')!;
  expect(rate.textContent).toBe("1,25×");
  await act(async () => rate.click());
  expect(onRate).toHaveBeenCalledWith(1.5);
  await render(true);
  expect(container.querySelector('button[aria-label^="Скорость рассказа"]')).toBeNull();
});

it("кнопка запуска показывает короткую подпись, сохраняя полное название для экранного чтения", async () => {
  await act(async () => root.render(createElement(I18nProvider, { locale: "ru" },
    createElement(AudioPlayerControls, { compact: true, walk: true, position: 0, duration: 60, canSeek: true, playing: false, label: "Повторить запуск звука", caption: "Повторить", onSeek: vi.fn(), onToggle: vi.fn() }))));
  const toggle = container.querySelector<HTMLButtonElement>('button[aria-label="Повторить запуск звука"]')!;
  expect(toggle.textContent).toBe("Повторить");
});
