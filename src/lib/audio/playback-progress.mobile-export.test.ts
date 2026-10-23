import { describe, expect, it } from "vitest";
import { mobileFlutterPath, stableJson } from "../mobile-export/snapshot";
import { formatPlaybackTime, parsePlaybackCheckpoint, playbackStorageKey, type PlaybackChapter } from "./playback-progress";

const chapters: PlaybackChapter[] = [
  { id: "a", audioUrl: "/api/story-audio/a.mp3", durationSec: 120 },
  { id: "b", audioUrl: "/api/story-audio/b.mp3", durationSec: 0 },
];
const saved = (patch: Record<string, unknown>) =>
  JSON.stringify({ version: 1, routeId: "walk", chapterId: "a", audioUrl: "/api/story-audio/a.mp3", positionSec: 30, ...patch });

describe("playback checkpoint fixtures for the mobile app", () => {
  it("exports checkpoint parsing, keys and time formatting", async () => {
    const raws = [null, "", "{", "x".repeat(2049), saved({}), saved({ positionSec: 500 }), saved({ positionSec: -1 }), saved({ positionSec: "30" }),
      saved({ version: 2 }), saved({ routeId: "other" }), saved({ chapterId: "missing" }), saved({ audioUrl: "/api/story-audio/changed.mp3" }),
      saved({ chapterId: "b", audioUrl: "/api/story-audio/b.mp3" }), "null", "[]"];
    const checkpoints = raws.map(raw => ({ raw, routeId: "walk", result: parsePlaybackCheckpoint(raw, "walk", chapters) }));
    const keys = (["ru", "en", "zh"] as const).map(locale => ({ routeId: "walk-1", locale, key: playbackStorageKey("walk-1", locale) }));
    const times = [0, 0.9, 59, 60, 61.5, 3599, 3600, -5, Number.NaN]
      .map(seconds => ({ seconds: Number.isNaN(seconds) ? "NaN" : seconds, text: formatPlaybackTime(seconds) }));
    expect(checkpoints.filter(item => item.result).length).toBe(2);
    await expect(stableJson({ chapters, checkpoints, keys, times })).toMatchFileSnapshot(mobileFlutterPath("test/fixtures/engine/playback_progress.json"));
  });
});
