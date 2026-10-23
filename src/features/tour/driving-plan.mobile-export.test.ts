import { describe, expect, it } from "vitest";
import { mobileFlutterPath, stableJson } from "@/lib/mobile-export/snapshot";
import { advanceDrivingPlan, currentDrivingStopId, drivingAudioAllowed, initialDrivingPlanState, loadDrivingProgress,
  type DrivingPlanAction, type DrivingPlanState, type DrivingRoute } from "./driving-plan";

const parking = (id: string) => ({ id, name: `Парковка ${id}`, location: { lat: 55.75, lon: 37.6 }, entrance: { lat: 55.75, lon: 37.6 },
  exit: { lat: 55.75, lon: 37.6 }, pedestrianAccess: { lat: 55.75, lon: 37.6 }, access: "public" as const, fee: null, openingHours: null });
const route: DrivingRoute = { drivingMinutes: 30, totalMinutes: 90, segments: [], visits: [
  { id: "v1", parking: parking("p1"), stopIds: ["s1", "s2"], visitMinutes: 20, parkingMinutes: 5 },
  { id: "v2", parking: parking("p2"), stopIds: [], visitMinutes: 10, parkingMinutes: 5 },
  { id: "v3", parking: parking("p3"), stopIds: ["s3"], visitMinutes: 10, parkingMinutes: 5 },
] };
const emptyRoute: DrivingRoute = { ...route, visits: [] };
const actions = ["start", "parked", "next-story", "return-to-car", "at-car", "finish-reached", "restart"]
  .map(type => ({ type }) as DrivingPlanAction);
const states: DrivingPlanState[] = [
  initialDrivingPlanState(),
  ...[0, 1, 2, 5].map(visitIndex => ({ phase: "driving" as const, visitIndex })),
  { phase: "visiting", visitIndex: 0, storyIndex: 0 }, { phase: "visiting", visitIndex: 0, storyIndex: 1 }, { phase: "visiting", visitIndex: 2, storyIndex: 0 },
  ...[0, 1, 2].map(visitIndex => ({ phase: "returning" as const, visitIndex })),
  { phase: "finishing" }, { phase: "complete" },
];
const memory = (raw: string | null) => ({ getItem: () => raw, setItem: () => undefined, removeItem: () => undefined });

describe("driving plan fixtures for the mobile app", () => {
  it("exports every action from every phase and saved-progress validation", async () => {
    const transitions = [route, emptyRoute].flatMap(plan => [true, false].flatMap(finishRequired => states.flatMap(state => actions.map(action => ({
      route: plan === route ? "three-visits" : "empty", finishRequired, state, action,
      result: advanceDrivingPlan(state, action, plan, { finishRequired }),
    })))));
    const derived = states.map(state => ({ state, audioAllowed: drivingAudioAllowed(state), stopId: currentDrivingStopId(state, route) }));
    const saved = [
      null, "not json", JSON.stringify({ version: 1, revision: 4, state: { phase: "visiting", visitIndex: 0, storyIndex: 1 } }),
      JSON.stringify({ version: 1, revision: 3, state: { phase: "driving", visitIndex: 1 } }),
      JSON.stringify({ version: 2, revision: 4, state: { phase: "complete" } }),
      JSON.stringify({ version: 1, revision: 4, state: { phase: "visiting", visitIndex: 1, storyIndex: 0 } }),
      JSON.stringify({ version: 1, revision: 4, state: { phase: "driving", visitIndex: 3 } }),
      JSON.stringify({ version: 1, revision: 4, state: { phase: "finishing" } }),
      JSON.stringify({ version: 1, revision: 4, state: { phase: "returning", visitIndex: 2.5 } }),
    ].flatMap(raw => [true, false].map(finishRequired => ({ raw, revision: 4, finishRequired,
      result: loadDrivingProgress(memory(raw), "doc", 4, route, { finishRequired }) })));
    expect(transitions.length).toBe(2 * 2 * states.length * actions.length);
    await expect(stableJson({ route, transitions, derived, saved })).toMatchFileSnapshot(mobileFlutterPath("test/fixtures/engine/driving_plan.json"));
  });
});
