import { describe, expect, it } from "vitest";
import {
  createTriggerState,
  DEFAULT_TRIGGER_CONFIG,
  processFix,
  resetTrigger,
} from "./trigger";
import type { PositionFix, TriggerState } from "./types";

const target = { lat: 55.72326, lon: 37.65309 };

function fix(distanceNorthM: number, accuracyM = 8, timestampMs = 0): PositionFix {
  return {
    lat: target.lat + distanceNorthM / 111_111,
    lon: target.lon,
    accuracyM,
    timestampMs,
  };
}

function run(distances: number[], initial = createTriggerState(), audioBusy = false) {
  let state = initial;
  const events = [];

  for (const [index, distance] of distances.entries()) {
    const result = processFix(state, fix(distance, 8, index), target, DEFAULT_TRIGGER_CONFIG, audioBusy);
    state = result.state;
    if (result.event) events.push(result.event);
  }

  return { state, events };
}

describe("geo trigger", () => {
  it("enters after three of the last five accurate fixes are inside 35 m", () => {
    const result = run([70, 20, 48, 18, 12]);
    expect(result.state.phase).toBe("inside");
    expect(result.events.map((event) => event.type)).toEqual(["entered"]);
  });

  it("does not enter with only two of five fixes inside", () => {
    expect(run([70, 20, 48, 18, 44]).state.phase).toBe("outside");
  });

  it("does not enter after the walker has already left the enter radius", () => {
    const result = run([10, 10, 10, 100, 100]);
    expect(result.state.phase).toBe("outside");
    expect(result.events).toHaveLength(0);
  });

  it("ignores fixes with accuracy worse than 50 m", () => {
    const state = createTriggerState();
    const result = processFix(state, fix(10, 51), target);
    expect(result).toMatchObject({ state, ignored: true, event: null, distanceM: null });
  });

  it.each([
    { accuracyM: NaN }, { accuracyM: -1 }, { accuracyM: Infinity },
    { lat: NaN }, { lat: 91 }, { lon: Infinity }, { lon: -181 },
    { timestampMs: NaN },
  ])("ignores malformed fixes: %j", (invalid) => {
    const state: TriggerState = { phase: "outside", recentInside: [true, true, true, true] };
    const result = processFix(state, { ...fix(10), ...invalid }, target);
    expect(result).toMatchObject({ state, ignored: true, event: null, distanceM: null });
  });

  it("supports a one-fix window after an outside fix", () => {
    const config = { ...DEFAULT_TRIGGER_CONFIG, windowSize: 1, minFixes: 1 };
    const outside = processFix(createTriggerState(), fix(100), target, config);
    expect(processFix(outside.state, fix(10), target, config).event?.type).toBe("entered");
  });

  it("stays inside between the 35 m enter and 60 m exit boundaries", () => {
    const inside: TriggerState = { phase: "inside", recentInside: [] };
    expect(processFix(inside, fix(50), target).state.phase).toBe("inside");
  });

  it("exits only beyond 60 m and enters session cooldown", () => {
    const inside: TriggerState = { phase: "inside", recentInside: [] };
    const result = processFix(inside, fix(61), target);
    expect(result.state.phase).toBe("cooldown");
    expect(result.event?.type).toBe("exited");
  });

  it("does not retrigger during the same session until explicitly reset", () => {
    const cooldown: TriggerState = { phase: "cooldown", recentInside: [] };
    expect(run([5, 5, 5, 5, 5], cooldown).events).toHaveLength(0);
    expect(run([5, 5, 5, 5, 5], resetTrigger()).events).toHaveLength(1);
  });

  it("does not start another story while audio is busy", () => {
    const result = run([10, 10, 10, 10, 10], createTriggerState(), true);
    expect(result.state.phase).toBe("outside");
    expect(result.events).toHaveLength(0);
  });
});
