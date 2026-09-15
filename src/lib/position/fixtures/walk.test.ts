import { describe, expect, it } from "vitest";
import routeData from "../../../../public/data/routes/paveletskaya.json";
import { distanceMeters } from "../../geo/distance";
import { createTriggerState, processFix } from "../../geo/trigger";
import type { GeoPoint, TriggerConfig } from "../../geo/types";
import type { Route } from "../../../features/tour/types";
import { createWalkReplayTrack, WALK_REPLAY_ACCURACY_M, WALK_REPLAY_INTERVAL_MS, WALK_REPLAY_STEP_M } from "./walk";

const route = routeData as Route;
const walk = route.walk!;
const path: GeoPoint[] = walk.path.coordinates.map(([lon, lat]) => ({ lat, lon }));
const config: TriggerConfig = {
  enterM: route.pois[0].trigger.enter_m,
  exitM: route.pois[0].trigger.exit_m,
  minFixes: route.pois[0].trigger.min_fixes,
  windowSize: 5,
  maxAccuracyM: route.pois[0].trigger.max_accuracy_m,
};

/** Metres from a point to the nearest point of the routed line, not to a vertex. */
function distanceToPathM(point: GeoPoint) {
  const scale = Math.cos(point.lat * Math.PI / 180);
  const project = (value: GeoPoint) => [value.lon * scale, value.lat] as const;
  const [px, py] = project(point);
  let best = Infinity;
  for (let index = 1; index < path.length; index += 1) {
    const [ax, ay] = project(path[index - 1]);
    const [bx, by] = project(path[index]);
    const dx = bx - ax, dy = by - ay;
    const lengthSq = dx * dx + dy * dy;
    const ratio = lengthSq > 0 ? Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / lengthSq)) : 0;
    best = Math.min(best, distanceMeters(point, { lat: (ay + dy * ratio), lon: (ax + dx * ratio) / scale }));
  }
  return best;
}

describe("walk replay track", () => {
  const track = createWalkReplayTrack(path);

  it("returns nothing for a path it cannot walk", () => {
    expect(createWalkReplayTrack([])).toEqual([]);
    expect(createWalkReplayTrack([path[0]])).toEqual([]);
    expect(createWalkReplayTrack(path, { stepM: 0 })).toEqual([]);
    expect(createWalkReplayTrack([{ lat: Number.NaN, lon: 1 }, { lat: 2, lon: 2 }])).toEqual([]);
  });

  it("starts at the start, ends at the finish and keeps an even pace", () => {
    expect(distanceMeters(track[0], path[0])).toBeLessThan(1);
    expect(distanceMeters(track.at(-1)!, path.at(-1)!)).toBeLessThan(1);
    expect(track.every((fix) => fix.accuracyM === WALK_REPLAY_ACCURACY_M)).toBe(true);
    expect(track.every((fix, index) => index === 0 || fix.timestampMs - track[index - 1].timestampMs === WALK_REPLAY_INTERVAL_MS)).toBe(true);
  });

  it("steps roughly the requested distance and stays on the routed line", () => {
    for (let index = 1; index < track.length; index += 1) {
      expect(distanceMeters(track[index - 1], track[index])).toBeLessThanOrEqual(WALK_REPLAY_STEP_M + 0.5);
    }
    for (const fix of track) expect(distanceToPathM(fix)).toBeLessThan(1);
  });

  it("covers the whole walk at an unhurried pace", () => {
    const seconds = (track.at(-1)!.timestampMs - track[0].timestampMs) / 1000;
    expect(seconds).toBeGreaterThan(walk.walking_min * 60 * 0.7);
    expect(seconds).toBeLessThan(walk.walking_min * 60 * 2);
  });

  it("enters the trigger zone of every stop in walking order", () => {
    const entered: string[] = [];
    for (const step of walk.steps) {
      let state = createTriggerState();
      const target = step.trigger_location ?? step.location;
      for (const fix of track) {
        const result = processFix(state, fix, target, config);
        state = result.state;
        if (result.event?.type === "entered") { entered.push(step.id); break; }
      }
    }
    expect(entered).toEqual(walk.steps.map((step) => step.id));
  });
});
