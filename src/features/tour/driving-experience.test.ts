// @vitest-environment jsdom
import { act, createElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { I18nProvider } from "@/lib/i18n/provider";
import { carWalkDocument } from "../../../backend/test-fixtures/car-walk.mjs";
import { DrivingExperience } from "./driving-experience";
import type { WalkView } from "../walks/model";

vi.mock("../shell/map-shell", () => ({ MapShell: ({ sheet }: { sheet: ReactNode }) => sheet }));
vi.mock("./offline-copy", () => ({ useOfflineCopy: () => ({}), OfflineCopyControls: () => null }));
vi.mock("../reviews/use-walk-reviews", () => ({ useWalkReviews: () => ({}) }));
vi.mock("../reviews/review-dialog", () => ({ ReviewDialog: () => null }));
vi.mock("../walks/launches", () => ({ useLaunchReport: () => () => {} }));

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  localStorage.clear();
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(async function (this: HTMLMediaElement) {
    this.dispatchEvent(new Event("play"));
  });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("открывает автомобильный навигатор до въезда и предоставляет аудио только между парковкой и возвращением", async () => {
  const document = carWalkDocument() as WalkView["document"];
  const view: WalkView = { document, revision: 1, contentVersion: "1", chapters: [{ id: "car-stop-1", status: "ready",
    story: { title: "История дома", address: "Дом", paragraphs: [{ text: "История", factIds: [] }], sources: [], facts: [] },
    audio: { url: "/audio/walk/story.mp3", sha256: "a".repeat(64), durationSec: 50 } }] };
  const container = window.document.createElement("div");
  const root = createRoot(container);
  try {
    await act(async () => root.render(createElement(I18nProvider, { locale: "ru" }, createElement(DrivingExperience, { view }))));
    const click = async (label: string) => {
      const button = Array.from(container.querySelectorAll("button")).find(item => item.textContent?.includes(label));
      expect(button, label).toBeDefined();
      await act(async () => button!.click());
    };
    const audio = container.querySelector("audio")!;
    expect(audio.getAttribute("src")).toBeNull();
    await click("Начать поездку");
    const navigation = container.querySelector("a[href*='rtt=auto']")!.getAttribute("href")!;
    expect(new URL(navigation).searchParams.get("rtext")).toBe("~55.76,37.63");
    expect(container.textContent).toContain("В дороге звук остановлен");
    expect(audio.getAttribute("src")).toBeNull();
    await click("Я припарковался");
    expect(audio.getAttribute("src")).toBe("/audio/walk/story.mp3");
    await click("Слушать историю");
    expect(container.textContent).toContain("Пауза");
    await click("Вернуться к машине");
    expect(audio.getAttribute("src")).toBeNull();
    expect(container.textContent).not.toContain("Слушать историю");
    expect(container.querySelector("a[href*='rtt=pd']")).not.toBeNull();
    await click("Я у машины");
    expect(container.textContent).toContain("Поездка завершена");
  } finally {
    await act(async () => root.unmount());
  }
});
