import { describe, expect, it } from "vitest";
import { DEFAULT_TRIGGER_CONFIG } from "@/lib/geo/trigger";
import { mobileFlutterPath, stableJson } from "@/lib/mobile-export/snapshot";
import { walkViewToRoute } from "../walks/adapters";
import type { WalkView } from "../walks/model";
import { arrivalTarget, arrivalTriggerConfig, followChapter, getWalkChapters, hasFinishLeg, highlightedLeg, type StopStage } from "./walk-plan";
import { orientWalk } from "./walk-direction";

// A universal walk view as the API returns it; the Dart port converts it the same way walkViewToRoute does.
const stops = [
  { id: "a-stop", lat: 55.7520, lon: 37.5930, trigger: { lat: 55.75205, lon: 37.59305 } },
  { id: "b-stop", lat: 55.7530, lon: 37.5950 },
  { id: "c-stop", lat: 55.7540, lon: 37.5970 },
];
const hash = (letter: string) => letter.repeat(64);

function view(finish: "near" | "far", statuses: string[] = ["ready", "ready", "ready"]): WalkView {
  const start = { address: "Москва, Арбат, 1", location: { lat: 55.7515, lon: 37.5925 } };
  const destination = finish === "far" ? { address: "Москва, Арбат, 50", location: { lat: 55.7560, lon: 37.6000 } }
    : { address: "Москва, Арбат, 40", location: { lat: 55.7541, lon: 37.5971 } };
  return {
    document: {
      version: 2, id: "arbat-test", title: "Арбат", description: "", city: "Москва", mode: "open", minutes: 30,
      start, destination,
      stops: stops.map(stop => ({ id: stop.id, place: { address: `Москва, ${stop.id}`, location: { lat: stop.lat, lon: stop.lon } }, storyRef: null,
        transition: "", nextHint: "", ...(stop.trigger ? { triggerLocation: stop.trigger } : {}) })),
      route: { geometry: [start.location, ...stops.map(stop => ({ lat: stop.lat, lon: stop.lon })), destination.location], distanceM: 900, walkingMinutes: 15, attribution: "OSM" },
      fieldChecked: false,
    },
    revision: 3, contentVersion: "v3",
    chapters: stops.map((stop, index) => {
      const letter = String.fromCharCode(97 + index);
      return statuses[index] === "ready" ? {
        id: stop.id, status: "ready" as const,
        story: { title: `Дом ${index + 1}`, address: `Москва, ${stop.id}`, paragraphs: [{ text: "Текст рассказа.", factIds: [] }], sources: [], facts: [] },
        audio: { url: `/api/story-audio/${hash(letter)}.mp3`, sha256: hash(letter), durationSec: 60 + index },
      } : { id: stop.id, status: statuses[index] as "preparing", story: null, audio: null };
    }),
  };
}

describe("walk plan fixtures for the mobile app", () => {
  it("exports chapters, targets, legs and finish legs", async () => {
    const stages: StopStage[] = ["approach", "stop"];
    const cases = (["near", "far"] as const).flatMap(finish => (["forward", "reverse"] as const).map(direction => {
      const input = view(finish, finish === "far" ? ["ready", "preparing", "ready"] : undefined);
      const route = orientWalk(walkViewToRoute(input), direction);
      const chapters = getWalkChapters(route, true);
      const ready = getWalkChapters(route, false);
      const finishPoint = route.walk!.finish.location;
      return {
        name: `${finish} finish, ${direction}`, view: input, direction,
        chapterIds: chapters.map(item => item.id), readyChapterIds: ready.map(item => item.id),
        start: route.walk!.start.location, finish: finishPoint,
        finishLeg: hasFinishLeg(chapters, finishPoint, DEFAULT_TRIGGER_CONFIG.enterM),
        steps: route.walk!.steps.map(step => ({ id: step.id, title: step.title, place: step.place, location: step.location,
          trigger_location: step.trigger_location ?? null, transition: step.transition, next_hint: step.next_hint,
          duration_sec: step.duration_sec, status: step.status ?? null, audio: step.audio ? { url: step.audio.url, duration_sec: step.audio.duration_sec } : null })),
        path: route.walk!.path.coordinates,
        targets: [...chapters.keys(), chapters.length].flatMap(index => stages.map(stage => ({
          index, stage,
          target: arrivalTarget(chapters, index, stage, finishPoint),
          config: arrivalTriggerConfig(chapters, index, stage, DEFAULT_TRIGGER_CONFIG),
          leg: highlightedLeg(index, stage, chapters.length),
        }))),
      };
    }));
    const follow = [
      { before: ["a", "b", "c"], after: ["a", "b", "c"] },
      { before: ["a", "b", "c"], after: ["a", "x", "b", "c"] },
      { before: ["a", "b", "c"], after: ["x", "a", "b", "c"] },
      { before: ["a", "b", "c"], after: ["a", "b", "c", "x"] },
      { before: ["a", "b", "c"], after: ["a", "c"] },
      { before: ["a", "b"], after: [] },
      { before: [], after: ["x"] },
    ].flatMap(({ before, after }) => [...before.keys(), before.length].flatMap(index => stages.map(stage =>
      ({ before, after, index, stage, result: followChapter(before, after, index, stage) }))));
    const legs = [0, 1, 3].flatMap(count => [0, 1, 2, 3, 4].flatMap(index => stages.map(stage =>
      ({ index, stage, count, result: highlightedLeg(index, stage, count) }))));
    expect(cases.some(item => item.finishLeg)).toBe(true);
    expect(cases.some(item => !item.finishLeg)).toBe(true);
    await expect(stableJson({ cases, follow, legs })).toMatchFileSnapshot(mobileFlutterPath("test/fixtures/engine/walk_plan.json"));
  });
});
