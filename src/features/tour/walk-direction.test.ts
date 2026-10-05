import { expect, it } from "vitest";
import routeData from "../../../public/data/routes/paveletskaya.json";
import type { Route } from "./types";
import { orientWalk } from "./walk-direction";
import { arrivalTarget, getWalkChapters, hasFinishLeg } from "./walk-plan";
import { legRange, routeLegCuts } from "./route-legs";

const route = routeData as Route;

it("разворачивает остановки, маршрут, входы и выходы тоннелей без изменения оригинала", () => {
  const original = structuredClone(route);
  const reversed = orientWalk(route, "reverse");
  const walk = reversed.walk!;
  expect(walk.start).toEqual(route.walk!.finish);
  expect(walk.finish).toEqual(route.walk!.start);
  expect(walk.path.coordinates).toEqual(route.walk!.path.coordinates.toReversed());
  const last = walk.path.coordinates.length - 1;
  expect(walk.path.tunnels).toEqual(route.walk!.path.tunnels!.toReversed().map(([a, b]) => [last - b, last - a]));
  expect(walk.steps.map(step => step.id)).toEqual(route.walk!.steps.map(step => step.id).toReversed());
  for (const step of walk.steps) {
    const source = route.walk!.steps.find(item => item.id === step.id)!;
    expect(step).toEqual({ ...source, transition: "", next_hint: "" });
  }
  expect(walk.distance_m).toBe(route.walk!.distance_m);
  expect(reversed.pois).toBe(route.pois);
  expect(route).toEqual(original);
});

it("ведёт к последней остановке, затем к предыдущей и финиширует у прежнего старта", () => {
  const reversed = orientWalk(route, "reverse");
  const chapters = getWalkChapters(reversed);
  const original = getWalkChapters(route);
  const finish = reversed.walk!.finish.location;
  expect(chapters[0].audio).toEqual(original.at(-1)!.audio);
  expect(chapters[0].content).toBe(original.at(-1)!.content);
  expect(arrivalTarget(chapters, 0, "approach", finish)).toEqual(original.at(-1)!.trigger_location ?? original.at(-1)!.location);
  expect(arrivalTarget(chapters, 0, "stop", finish)).toEqual(original.at(-2)!.trigger_location ?? original.at(-2)!.location);
  expect(arrivalTarget(chapters, chapters.length, "approach", finish)).toEqual(route.walk!.start.location);
  const geometry = reversed.walk!.path.coordinates.map(([lon, lat]) => ({ lat, lon }));
  const cuts = routeLegCuts(geometry, chapters.map(item => item.trigger_location ?? item.location));
  expect(cuts).toEqual(cuts.toSorted((a, b) => a - b));
  expect(legRange(cuts, geometry.length, 1)).not.toBeNull();
});

it("сохраняет дополнительный участок до исходного старта и в кольцевой прогулке", () => {
  const loop = { ...route, walk: { ...route.walk!, finish: route.walk!.start } };
  const reversed = orientWalk(loop, "reverse");
  expect(reversed.walk!.start).toEqual(reversed.walk!.finish);
  const chapters = getWalkChapters(reversed);
  expect(hasFinishLeg(chapters, reversed.walk!.finish.location, 1)).toBe(true);
});

it.each([{ steps: [] }, { steps: route.walk!.steps.slice(0, 1) }])("разворачивает прогулку с $steps.length остановками", ({ steps }) => {
  const input = { ...route, walk: { ...route.walk!, steps, path: { ...route.walk!.path, tunnels: undefined } } };
  expect(orientWalk(input, "reverse").walk!.steps.map(step => step.id)).toEqual(steps.map(step => step.id).toReversed());
  expect(orientWalk(input, "reverse").walk!.path.tunnels).toBeUndefined();
});

it("обычное направление и маршрут без плана остаются прежними", () => {
  expect(orientWalk(route, "forward")).toBe(route);
  const noPlan = { ...route, walk: undefined };
  expect(orientWalk(noPlan, "reverse")).toBe(noPlan);
});
