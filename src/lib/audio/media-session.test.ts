import { describe, expect, it, vi } from "vitest";
import {
  createMediaSessionController,
  DEFAULT_SEEK_OFFSET_SEC,
  type MediaSessionLike,
  type MediaSessionTrack,
} from "./media-session";

function environment(overrides: Partial<MediaSessionLike> = {}) {
  const handlers = new Map<string, ((details: { seekOffset?: number; seekTime?: number }) => void) | null>();
  const positions: Array<{ duration: number; playbackRate: number; position: number } | undefined> = [];
  const session: MediaSessionLike = {
    metadata: null,
    playbackState: "none",
    setActionHandler: (action, handler) => { handlers.set(action, handler); },
    setPositionState: (state) => { positions.push(state); },
    ...overrides,
  };
  return {
    handlers,
    positions,
    session,
    controller: createMediaSessionController({ session, createMetadata: (track: MediaSessionTrack) => ({ ...track }) }),
  };
}

describe("media session controller", () => {
  it("reports no controls and stays silent without a Media Session", () => {
    const controller = createMediaSessionController(null);
    expect(controller.available).toBe(false);
    expect(() => {
      controller.setActions({ play: () => {} });
      controller.setTrack({ title: "Кожевники", artist: "Отголосок", album: "Прогулка" });
      controller.setPlaybackState("playing");
      controller.setPosition({ durationSec: 60, positionSec: 10, playbackRate: 1 });
      controller.release();
    }).not.toThrow();
  });

  it("maps lock-screen actions onto the player", () => {
    const calls: string[] = [];
    const { handlers, controller } = environment();
    controller.setActions({
      play: () => calls.push("play"),
      pause: () => calls.push("pause"),
      seekBy: (offset) => calls.push(`seekBy:${offset}`),
      seekTo: (position) => calls.push(`seekTo:${position}`),
      next: () => calls.push("next"),
      previous: () => calls.push("previous"),
    });
    handlers.get("play")!({});
    handlers.get("pause")!({});
    handlers.get("seekbackward")!({});
    handlers.get("seekforward")!({ seekOffset: 30 });
    handlers.get("seekto")!({ seekTime: 42 });
    handlers.get("nexttrack")!({});
    handlers.get("previoustrack")!({});
    expect(calls).toEqual([
      "play", "pause", `seekBy:${-DEFAULT_SEEK_OFFSET_SEC}`, "seekBy:30", "seekTo:42", "next", "previous",
    ]);
  });

  it("ignores a seekto without a finite time", () => {
    const calls: number[] = [];
    const { handlers, controller } = environment();
    controller.setActions({ seekTo: (position) => calls.push(position) });
    handlers.get("seekto")!({});
    handlers.get("seekto")!({ seekTime: Number.NaN });
    expect(calls).toEqual([]);
  });

  it("clears the handlers of actions the walk cannot offer", () => {
    const { handlers, controller } = environment();
    controller.setActions({ play: () => {}, next: () => {} });
    expect(handlers.get("nexttrack")).toBeTypeOf("function");
    expect(handlers.get("previoustrack")).toBeNull();
    controller.setActions({ play: () => {} });
    expect(handlers.get("nexttrack")).toBeNull();
  });

  it("registers the remaining actions when one is unsupported", () => {
    const { controller, handlers } = environment({
      setActionHandler: (action, handler) => {
        if (action === "seekto") throw new Error("NotSupportedError");
        handlers.set(action, handler);
      },
    });
    controller.setActions({ play: () => {}, pause: () => {}, seekTo: () => {} });
    expect(handlers.get("play")).toBeTypeOf("function");
    expect(handlers.get("pause")).toBeTypeOf("function");
    expect(handlers.has("seekto")).toBe(false);
  });

  it("publishes the current chapter and playback state", () => {
    const { session, controller } = environment();
    controller.setTrack({ title: "Фабрика и авангард", artist: "От Кожевников к Цинделю", album: "Отголосок" });
    expect(session.metadata).toMatchObject({ title: "Фабрика и авангард", album: "Отголосок" });
    controller.setPlaybackState("playing");
    expect(session.playbackState).toBe("playing");
    controller.setTrack(null);
    expect(session.metadata).toBeNull();
  });

  it("clamps position inside the recording and rejects an unusable duration", () => {
    const { positions, controller } = environment();
    controller.setPosition({ durationSec: 60, positionSec: 75, playbackRate: 1.25 });
    controller.setPosition({ durationSec: 60, positionSec: -5, playbackRate: 0 });
    controller.setPosition({ durationSec: Number.NaN, positionSec: 3, playbackRate: 1 });
    controller.setPosition(null);
    expect(positions).toEqual([
      { duration: 60, playbackRate: 1.25, position: 60 },
      { duration: 60, playbackRate: 1, position: 0 },
      undefined,
      undefined,
    ]);
  });

  it("survives a browser that rejects position state", () => {
    const { controller } = environment({ setPositionState: () => { throw new TypeError("inconsistent"); } });
    expect(() => controller.setPosition({ durationSec: 60, positionSec: 10, playbackRate: 1 })).not.toThrow();
  });

  it("hands the controls back on release and stays inert afterwards", () => {
    const { handlers, session, controller } = environment();
    controller.setActions({ play: () => {}, pause: () => {}, next: () => {} });
    controller.setTrack({ title: "Кожевники", artist: "Отголосок", album: "Прогулка" });
    controller.setPlaybackState("playing");
    controller.release();
    expect([...handlers.values()].every((handler) => handler === null)).toBe(true);
    expect(session.metadata).toBeNull();
    expect(session.playbackState).toBe("none");
    const setActionHandler = vi.fn();
    Object.assign(session, { setActionHandler });
    controller.setActions({ play: () => {} });
    controller.setPlaybackState("playing");
    expect(setActionHandler).not.toHaveBeenCalled();
    expect(session.playbackState).toBe("none");
  });
});
