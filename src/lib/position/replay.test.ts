import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createReplayPositionSource } from "./replay";
import type { PositionSourceUpdate } from "./types";

const fixes = [
  { lat: 55.72, lon: 37.65, accuracyM: 8, timestampMs: 1_000 },
  { lat: 55.721, lon: 37.651, accuracyM: 7, timestampMs: 2_000 },
  { lat: 55.722, lon: 37.652, accuracyM: 6, timestampMs: 3_000 },
] as const;

describe("replay position source", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("emits a deterministic track and completes after the last fix", () => {
    const updates: PositionSourceUpdate[] = [];
    createReplayPositionSource({ fixes, intervalMs: 500 }).subscribe((update) =>
      updates.push(update),
    );

    expect(updates.map((update) => update.type === "status" ? update.status : update.sequence)).toEqual([
      "starting",
      "active",
      1,
    ]);

    vi.advanceTimersByTime(1_000);

    expect(updates.filter((update) => update.type === "fix")).toEqual([
      { type: "fix", source: "replay", sequence: 1, fix: fixes[0] },
      { type: "fix", source: "replay", sequence: 2, fix: fixes[1] },
      { type: "fix", source: "replay", sequence: 3, fix: fixes[2] },
    ]);
    expect(updates.at(-1)).toEqual({
      type: "status",
      source: "replay",
      status: "complete",
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stops pending playback idempotently", () => {
    const updates: PositionSourceUpdate[] = [];
    const stop = createReplayPositionSource({ fixes, intervalMs: 500 }).subscribe(
      (update) => updates.push(update),
    );

    stop();
    stop();
    vi.runAllTimers();

    expect(updates.filter((update) => update.type === "fix")).toHaveLength(1);
    expect(updates.at(-1)).toEqual({
      type: "status",
      source: "replay",
      status: "stopped",
    });
  });

  it("completes immediately when the track is empty", () => {
    const updates: PositionSourceUpdate[] = [];
    createReplayPositionSource({ fixes: [] }).subscribe((update) => updates.push(update));

    expect(updates).toEqual([
      { type: "status", source: "replay", status: "starting" },
      { type: "status", source: "replay", status: "complete" },
    ]);
  });

  it("rejects invalid intervals", () => {
    expect(() => createReplayPositionSource({ fixes, intervalMs: -1 })).toThrow(
      RangeError,
    );
  });
});
