import { describe, expect, it } from "vitest";
import {
  advanceDrivingPlan,
  currentDrivingStopId,
  drivingAudioAllowed,
  drivingProgressKey,
  initialDrivingPlanState,
  loadDrivingProgress,
  saveDrivingProgress,
  visitStoryGroups,
  type DrivingRoute,
} from "./driving-plan";

const point = { lat: 55.75, lon: 37.61 };
const route: DrivingRoute = {
  drivingMinutes: 22,
  totalMinutes: 60,
  visits: [
    { id: "visit-a", parking: { id: "parking-a", name: "Парковка A", location: point, entrance: point, exit: point, pedestrianAccess: point, access: "public", fee: false, openingHours: null }, stopIds: ["story-a", "story-b"], visitMinutes: 20, parkingMinutes: 4 },
    { id: "visit-b", parking: { id: "parking-b", name: "Парковка B", location: point, entrance: point, exit: point, pedestrianAccess: point, access: "public", fee: null, openingHours: null }, stopIds: ["story-c"], visitMinutes: 14, parkingMinutes: 3 },
  ],
  segments: [],
};
const options = { finishRequired: true };

describe("этапы автомобильной прогулки", () => {
  it("проходит все истории одной парковки до возвращения к машине", () => {
    let state = advanceDrivingPlan(initialDrivingPlanState(), { type: "start" }, route, options);
    expect(state).toEqual({ phase: "driving", visitIndex: 0 });
    expect(drivingAudioAllowed(state)).toBe(false);

    state = advanceDrivingPlan(state, { type: "parked" }, route, options);
    expect(currentDrivingStopId(state, route)).toBe("story-a");
    expect(drivingAudioAllowed(state)).toBe(true);
    state = advanceDrivingPlan(state, { type: "next-story" }, route, options);
    expect(currentDrivingStopId(state, route)).toBe("story-b");

    state = advanceDrivingPlan(state, { type: "return-to-car" }, route, options);
    expect(state).toEqual({ phase: "returning", visitIndex: 0 });
    expect(drivingAudioAllowed(state)).toBe(false);
    state = advanceDrivingPlan(state, { type: "at-car" }, route, options);
    expect(state).toEqual({ phase: "driving", visitIndex: 1 });
  });

  it("после последней парковки отдельно ведёт к финишу", () => {
    const returning = { phase: "returning", visitIndex: 1 } as const;
    const finishing = advanceDrivingPlan(returning, { type: "at-car" }, route, options);
    expect(finishing).toEqual({ phase: "finishing" });
    expect(advanceDrivingPlan(finishing, { type: "finish-reached" }, route, options)).toEqual({ phase: "complete" });
  });

  it("не придумывает финишный переезд у открытого маршрута", () => {
    expect(advanceDrivingPlan({ phase: "returning", visitIndex: 1 }, { type: "at-car" }, route, { finishRequired: false }))
      .toEqual({ phase: "complete" });
  });

  it("группирует только известные истории и убирает повторы", () => {
    expect(visitStoryGroups(route, new Set(["story-a", "story-b", "story-c"]))).toEqual([
      { visitId: "visit-a", stopIds: ["story-a", "story-b"] },
      { visitId: "visit-b", stopIds: ["story-c"] },
    ]);
    expect(visitStoryGroups({ ...route, visits: [{ ...route.visits[0], stopIds: ["story-a", "missing", "story-a"] }] }, new Set(["story-a"])))
      .toEqual([{ visitId: "visit-a", stopIds: ["story-a"] }]);
  });
});

it("восстанавливает только прогресс той же редакции и допустимого этапа", () => {
  const data = new Map<string, string>();
  const storage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value),
    removeItem: (key: string) => data.delete(key),
  };
  const saved = { phase: "visiting", visitIndex: 0, storyIndex: 1 } as const;
  saveDrivingProgress(storage, "walk", 4, saved);
  expect(loadDrivingProgress(storage, "walk", 4, route, options)).toEqual(saved);
  expect(loadDrivingProgress(storage, "walk", 5, route, options)).toEqual({ phase: "overview" });

  data.set(drivingProgressKey("walk"), JSON.stringify({ version: 1, revision: 4, state: { phase: "visiting", visitIndex: 0, storyIndex: 99 } }));
  expect(loadDrivingProgress(storage, "walk", 4, route, options)).toEqual({ phase: "overview" });
});

