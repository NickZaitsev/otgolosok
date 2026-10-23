import { describe, expect, it } from "vitest";
import { mobileFlutterPath, stableJson } from "../mobile-export/snapshot";
import { createWalkReplayTrack } from "../position/fixtures/walk";
import { CLEAN_REPLAY_TARGET, CLEAN_REPLAY_TRACK } from "../position/fixtures/clean";
import { distanceMeters } from "./distance";
import { createTriggerState, DEFAULT_TRIGGER_CONFIG, processFix } from "./trigger";
import type { GeoPoint, PositionFix, TriggerConfig, TriggerState } from "./types";

// The Dart port (mobile-flutter/lib/walk_engine) replays these inputs and must produce identical outputs.
const target: GeoPoint = { lat: 55.75, lon: 37.62 };
const METERS_PER_DEGREE = 111_111;
const north = (meters: number, accuracyM = 8, timestampMs = 1_000): PositionFix =>
  ({ lat: target.lat + meters / METERS_PER_DEGREE, lon: target.lon, accuracyM, timestampMs });

type Step = { fix: PositionFix; busy: boolean };
type Scenario = { name: string; config: TriggerConfig; target: GeoPoint; state: TriggerState; steps: Step[] };

const steps = (meters: number[], options: { accuracyM?: number; busy?: boolean[] } = {}): Step[] =>
  meters.map((distance, index) => ({ fix: north(distance, options.accuracyM ?? 8, 1_000 * (index + 1)), busy: options.busy?.[index] ?? false }));

const base = { config: DEFAULT_TRIGGER_CONFIG, target, state: createTriggerState() };
const scenarios: Scenario[] = [
  { ...base, name: "enters after a full window with three inside", steps: steps([80, 70, 30, 20, 10]) },
  { ...base, name: "window not full yet", steps: steps([30, 20, 10, 5]) },
  { ...base, name: "current fix outside blocks entry", steps: steps([30, 20, 10, 5, 40]) },
  // The fixes are offset north by the label in metres of latitude, so the haversine distance lands within
  // a few centimetres of it: 34.9 stays inside, 35.1 stays outside, 35 is decided by the exact float.
  { ...base, name: "boundary 34.9 m", steps: steps([100, 100, 34.9, 34.9, 34.9]) },
  { ...base, name: "boundary 35 m", steps: steps([100, 100, 35, 35, 35]) },
  { ...base, name: "boundary 35.1 m", steps: steps([100, 100, 35.1, 35.1, 35.1]) },
  { ...base, name: "accuracy 50 m is used", steps: steps([10, 10, 10, 10, 10], { accuracyM: 50 }) },
  { ...base, name: "accuracy 50.1 m is ignored", steps: steps([10, 10, 10, 10, 10], { accuracyM: 50.1 }) },
  { ...base, name: "busy audio withholds the arrival", steps: steps([10, 10, 10, 10, 10, 10], { busy: [false, false, false, false, true, false] }) },
  { ...base, name: "inside, then exit at 60/60.5 m, then cooldown", steps: steps([10, 10, 10, 10, 10, 59, 60, 60.5, 10, 10, 10, 10, 10]) },
  { ...base, name: "custom config", config: { enterM: 20, exitM: 40, minFixes: 2, windowSize: 3, maxAccuracyM: 30 }, steps: steps([25, 15, 18, 41, 10]) },
  { ...base, name: "window size 1", config: { enterM: 35, exitM: 60, minFixes: 1, windowSize: 1, maxAccuracyM: 50 }, steps: steps([40, 10]) },
  { ...base, name: "invalid coordinates and timestamps", steps: [
    { fix: { lat: Number.NaN, lon: 37.62, accuracyM: 5, timestampMs: 1 }, busy: false },
    { fix: { lat: 91, lon: 37.62, accuracyM: 5, timestampMs: 1 }, busy: false },
    { fix: { lat: 55.75, lon: -181, accuracyM: 5, timestampMs: 1 }, busy: false },
    { fix: { lat: 55.75, lon: 37.62, accuracyM: -1, timestampMs: 1 }, busy: false },
    { fix: { lat: 55.75, lon: 37.62, accuracyM: 5, timestampMs: Number.POSITIVE_INFINITY }, busy: false },
  ] },
  { ...base, name: "clean replay track", target: CLEAN_REPLAY_TARGET, steps: CLEAN_REPLAY_TRACK.map(fix => ({ fix, busy: false })) },
];

// JSON has no NaN/Infinity: encode them as strings the Dart test decodes back.
const number = (value: number) => Number.isNaN(value) ? "NaN" : value === Infinity ? "Infinity" : value === -Infinity ? "-Infinity" : value;
const encodeFix = (fix: PositionFix) => ({ lat: number(fix.lat), lon: number(fix.lon), accuracyM: number(fix.accuracyM), timestampMs: number(fix.timestampMs) });

function run(scenario: Scenario) {
  let state = scenario.state;
  return scenario.steps.map(step => {
    const result = processFix(state, step.fix, scenario.target, scenario.config, step.busy);
    state = result.state;
    return result;
  });
}

const replayPath = [{ lat: 55.7300, lon: 37.6400 }, { lat: 55.7310, lon: 37.6400 }, { lat: 55.7310, lon: 37.6420 }];
const distancePairs: Array<[GeoPoint, GeoPoint]> = [
  [{ lat: 55.75, lon: 37.62 }, { lat: 55.75, lon: 37.62 }],
  [{ lat: 55.75, lon: 37.62 }, { lat: 55.7503, lon: 37.6204 }],
  [{ lat: 0, lon: 0 }, { lat: 0, lon: 180 }],
  [{ lat: 55.8, lon: 37.4 }, { lat: 55.6, lon: 37.8 }],
  [{ lat: -33.86, lon: 151.21 }, { lat: 51.5, lon: -0.12 }],
];

describe("trigger fixtures for the mobile app", () => {
  it("exports trigger scenarios, distances and the walk replay track", async () => {
    const fixture = {
      defaultConfig: DEFAULT_TRIGGER_CONFIG,
      distances: distancePairs.map(([from, to]) => ({ from, to, meters: distanceMeters(from, to) })),
      scenarios: scenarios.map(scenario => ({
        name: scenario.name, config: scenario.config, target: scenario.target, state: scenario.state,
        steps: scenario.steps.map(step => ({ fix: encodeFix(step.fix), busy: step.busy })),
        results: run(scenario),
      })),
      replay: { path: replayPath, fixes: createWalkReplayTrack(replayPath) },
    };
    // The table covers both outcomes at the entry boundary.
    expect(fixture.scenarios.find(item => item.name === "boundary 34.9 m")?.results.at(-1)?.event?.type).toBe("entered");
    expect(fixture.scenarios.find(item => item.name === "boundary 35.1 m")?.results.at(-1)?.event).toBeNull();
    await expect(stableJson(fixture)).toMatchFileSnapshot(mobileFlutterPath("test/fixtures/engine/trigger.json"));
  });
});
