import { describe, expect, it } from "vitest";
import { createTriggerState, processFix } from "../../geo/trigger";
import { CLEAN_REPLAY_TARGET, CLEAN_REPLAY_TRACK } from "./clean";

describe("clean replay fixture", () => {
  it("drives the first POI through entered and exited into cooldown", () => {
    let state = createTriggerState();
    const events = [];
    const ignored = [];

    for (const fix of CLEAN_REPLAY_TRACK) {
      const result = processFix(state, fix, CLEAN_REPLAY_TARGET);
      state = result.state;
      ignored.push(result.ignored);
      if (result.event) events.push(result.event);
    }

    expect(ignored[0]).toBe(true);
    expect(events.map((event) => event.type)).toEqual(["entered", "exited"]);
    expect(state.phase).toBe("cooldown");
  });

  it("has strictly increasing timestamps", () => {
    const timestamps = CLEAN_REPLAY_TRACK.map((fix) => fix.timestampMs);
    expect(timestamps.every((value, index) => index === 0 || value > timestamps[index - 1])).toBe(
      true,
    );
  });
});
