// @vitest-environment jsdom
import { act, createElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { carWalkDocument } from "../../../backend/test-fixtures/car-walk.mjs";
import type { WalkView } from "../walks/model";
import { TourExperience } from "./tour-experience";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

vi.mock("@/lib/i18n/provider", () => ({
  useI18n: () => ({ locale: "ru", languageTag: "ru-RU", path: (path: string) => path,
    t: (text: string, values: Record<string, string | number> = {}) => text.replace(/\{([^}]+)\}/g, (_, key: string) => String(values[key] ?? key)) }),
}));
// The map renderer and network/storage controls do not participate in trip transitions.
vi.mock("../shell/map-shell", () => ({ MapShell: ({ sheet, notices }: { sheet: ReactNode; notices: ReactNode }) => createElement("main", null, notices, sheet) }));
vi.mock("./offline-copy", () => ({ useOfflineCopy: () => ({ busy: false }), OfflineCopyControls: () => null }));
vi.mock("../reviews/use-walk-reviews", () => ({ useWalkReviews: () => ({}) }));
vi.mock("../walks/launches", () => ({ useLaunchReport: () => () => {} }));
// Throwing catches accidental initialization of pedestrian audio or GPS triggers,
// rather than merely checking which screen label appeared.
vi.mock("./use-walk-audio", () => ({ useWalkAudio: () => { throw new Error("Пешеходное аудио включилось в автомобильной поездке"); } }));
vi.mock("./use-walk-position", () => ({ useWalkPosition: () => { throw new Error("Пешеходный GPS включился в автомобильной поездке"); } }));

function view(): WalkView {
  return {
    document: carWalkDocument() as WalkView["document"], revision: 1, contentVersion: "test:1",
    chapters: [{ id: "car-stop-1", status: "ready",
      story: { title: "История дома", address: "Москва, исторический дом", paragraphs: [{ text: "История этого дома.", factIds: [] }], sources: [], facts: [] },
      audio: { url: "/audio/walk/car-story.mp3", sha256: "a".repeat(64), durationSec: 60 } }],
  };
}

it("выбирает сценарий поездки и разрешает звук только после парковки, отключая его при возврате", async () => {
  localStorage.clear();
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  const playing = new WeakSet<HTMLMediaElement>();
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(async function (this: HTMLMediaElement) {
    playing.add(this); this.dispatchEvent(new Event("play"));
  });
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(function (this: HTMLMediaElement) {
    playing.delete(this); this.dispatchEvent(new Event("pause"));
  });
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
  const host = document.createElement("div"), root = createRoot(host);
  const click = async (text: string) => {
    const button = [...host.querySelectorAll("button")].find(item => item.textContent?.includes(text));
    expect(button, text).toBeDefined();
    await act(() => button!.click());
  };
  try {
    // Opening data in the same mounted component keeps React's hooks in order.
    await act(() => root.render(createElement(TourExperience)));
    expect(host.textContent).toContain("Прогулка не найдена");
    await act(() => root.render(createElement(TourExperience, { walk: view() })));
    expect(host.querySelector("[data-sheet=driving]")?.getAttribute("data-state")).toBe("overview");
    const audio = host.querySelector("audio")!;
    expect(audio.getAttribute("src")).toBeNull();
    await click("Начать поездку");
    expect(host.querySelector("[data-sheet=driving]")?.getAttribute("data-state")).toBe("driving");
    expect(audio.getAttribute("src")).toBeNull();
    expect(host.textContent).toContain("В дороге звук остановлен");
    expect(host.querySelector("a[href*='yandex']")?.getAttribute("href")).toContain("37.63");
    await click("Я припарковался");
    expect(host.querySelector("[data-sheet=driving]")?.getAttribute("data-state")).toBe("visiting");
    expect(audio.getAttribute("src")).toBe("/audio/walk/car-story.mp3");
    expect(host.textContent).toContain("История этого дома.");
    expect(playing.has(audio)).toBe(false);
    await click("Слушать историю");
    expect(playing.has(audio)).toBe(true);
    await click("Вернуться к машине");
    expect(host.querySelector("[data-sheet=driving]")?.getAttribute("data-state")).toBe("returning");
    expect(audio.getAttribute("src")).toBeNull();
    expect(playing.has(audio)).toBe(false);
    await click("Я у машины");
    expect(host.textContent).toContain("Поездка завершена");
    expect(audio.getAttribute("src")).toBeNull();
  } finally {
    await act(() => root.unmount());
    vi.restoreAllMocks(); vi.unstubAllGlobals();
  }
});
