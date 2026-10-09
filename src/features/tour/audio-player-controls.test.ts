// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { I18nProvider } from "@/lib/i18n/provider";
import { AudioPlayerControls } from "./audio-player-controls";

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
