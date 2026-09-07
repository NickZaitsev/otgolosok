import { describe, expect, it } from "vitest";
import { formatPlaybackTime, parsePlaybackCheckpoint, playbackStorageKey } from "./playback-progress";

const chapters = [{ id: "housing", audioUrl: "/audio/housing-v2.mp3", durationSec: 59.24 }];
const checkpoint = { version: 1, routeId: "walk", chapterId: "housing", audioUrl: chapters[0].audioUrl, positionSec: 23.5 };

describe("Playback checkpoint", () => {
  it("restores the selected chapter and offset without storing a position on the map", () => {
    expect(parsePlaybackCheckpoint(JSON.stringify(checkpoint), "walk", chapters)).toEqual(checkpoint);
    expect(playbackStorageKey("walk")).toBe("otgolosok:playback:walk");
  });

  it("discards offsets belonging to another route, chapter or recording version", () => {
    for (const patch of [{ routeId: "different" }, { chapterId: "gone" }, { audioUrl: "/audio/housing-v1.mp3" }, { version: 2 }]) {
      expect(parsePlaybackCheckpoint(JSON.stringify({ ...checkpoint, ...patch }), "walk", chapters)).toBeNull();
    }
  });

  it("ignores corrupt, nonfinite and oversized browser data", () => {
    for (const raw of [null, "", "{", "null", "true", "[]", "x".repeat(2049), JSON.stringify({ ...checkpoint, positionSec: -1 }), JSON.stringify({ ...checkpoint, positionSec: "23" }), JSON.stringify(checkpoint).replace("23.5", "1e999")]) {
      expect(parsePlaybackCheckpoint(raw, "walk", chapters)).toBeNull();
    }
  });

  it("clamps an offset to the measured recording length and strips unrelated fields", () => {
    expect(parsePlaybackCheckpoint(JSON.stringify({ ...checkpoint, positionSec: 100, extra: "unused" }), "walk", chapters)).toEqual({ ...checkpoint, positionSec: 59.24 });
  });

  it("formats safe player times", () => {
    expect([0, 59.99, 60, 119.2, -5, NaN, Infinity].map(formatPlaybackTime)).toEqual(["0:00", "0:59", "1:00", "1:59", "0:00", "0:00", "0:00"]);
  });
});
