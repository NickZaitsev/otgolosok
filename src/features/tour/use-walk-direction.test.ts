// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { useWalkDirection } from "./use-walk-direction";
import { usePlaybackProgress } from "./use-playback-progress";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

it.each(["reverse", "unexpected"])("читает направление %s и сохраняет выбор только для этой прогулки", async stored => {
  localStorage.clear();
  localStorage.setItem("otgolosok:walk-direction:first", stored);
  const host = document.createElement("div");
  const root = createRoot(host);
  function Probe() {
    const first = useWalkDirection("first");
    const second = useWalkDirection("second");
    return createElement("button", { onClick: () => first.setDirection("reverse") }, `${first.direction}/${second.direction}`);
  }
  try {
    await act(() => root.render(createElement(Probe)));
    expect(host.textContent).toBe(`${stored === "reverse" ? "reverse" : "forward"}/forward`);
    await act(() => host.querySelector("button")!.click());
    expect(host.textContent).toBe("reverse/forward");
    expect(localStorage.getItem("otgolosok:walk-direction:first")).toBe("reverse");
    expect(localStorage.getItem("otgolosok:walk-direction:second")).toBeNull();
  } finally { await act(() => root.unmount()); }
});

it("позволяет изменить направление, когда браузер запрещает localStorage", async () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new DOMException("Denied", "SecurityError"); });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("Denied", "SecurityError"); });
  const host = document.createElement("div");
  const root = createRoot(host);
  function Probe() {
    const { direction, setDirection } = useWalkDirection("restricted");
    return createElement("button", { onClick: () => setDirection(direction === "forward" ? "reverse" : "forward") }, direction);
  }
  try {
    await act(() => root.render(createElement(Probe)));
    expect(host.textContent).toBe("forward");
    await act(() => host.querySelector("button")!.click());
    expect(host.textContent).toBe("reverse");
    await act(() => host.querySelector("button")!.click());
    expect(host.textContent).toBe("forward");
  } finally {
    await act(() => root.unmount());
    vi.restoreAllMocks();
  }
});

it("старый прогресс остаётся прямым, сохранение и завершение обратного не затрагивают его", async () => {
  localStorage.clear();
  const checkpoint = { version: 1 as const, routeId: "progress", chapterId: "stop", audioUrl: "/story.mp3", positionSec: 12 };
  localStorage.setItem("otgolosok:playback:progress", JSON.stringify(checkpoint));
  const host = document.createElement("div");
  const root = createRoot(host);
  function Probe() {
    const chapters = [{ id: "stop", audioUrl: "/story.mp3", durationSec: 60 }];
    const forward = usePlaybackProgress("progress", chapters);
    const reverse = usePlaybackProgress("progress", chapters, "reverse");
    return createElement("div", null,
      `${forward.savedCheckpoint?.positionSec ?? "none"}/${reverse.savedCheckpoint?.positionSec ?? "none"}`,
      createElement("button", { onClick: () => reverse.saveCheckpoint({ ...checkpoint, positionSec: 24 }) }, "save"),
      createElement("button", { onClick: reverse.clearCheckpoint }, "clear"));
  }
  try {
    await act(() => root.render(createElement(Probe)));
    expect(host.textContent).toBe("12/nonesaveclear");
    await act(() => host.querySelectorAll("button")[0].click());
    expect(host.textContent).toBe("12/24saveclear");
    await act(() => host.querySelectorAll("button")[1].click());
    expect(host.textContent).toBe("12/nonesaveclear");
    expect(JSON.parse(localStorage.getItem("otgolosok:playback:progress")!)).toEqual(checkpoint);
  } finally { await act(() => root.unmount()); }
});

it("применяет выбор при переполненном хранилище, даже если чтение старого значения доступно", async () => {
  localStorage.setItem("otgolosok:walk-direction:quota", "forward");
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("Full", "QuotaExceededError"); });
  const host = document.createElement("div");
  const root = createRoot(host);
  function Probe() {
    const { direction, setDirection } = useWalkDirection("quota");
    return createElement("button", { onClick: () => setDirection("reverse") }, direction);
  }
  try {
    await act(() => root.render(createElement(Probe)));
    await act(() => host.querySelector("button")!.click());
    expect(host.textContent).toBe("reverse");
    expect(localStorage.getItem("otgolosok:walk-direction:quota")).toBe("forward");
  } finally {
    await act(() => root.unmount());
    vi.restoreAllMocks();
  }
});
