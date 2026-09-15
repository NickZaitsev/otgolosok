import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import routeData from "../../../public/data/routes/paveletskaya.json";
import mapData from "../../../public/data/maps/paveletskaya.json";
import { createProjection, renderMap } from "../../../scripts/build-map.mjs";
import { chapterTriggerConfig, getWalkChapters, nextChapterTarget } from "./walk-plan";
import type { Route } from "./types";

const route = routeData as Route;
const walk = route.walk!;

function inRing([x, y]: number[], ring: number[][]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function inWater(point: number[]) {
  return mapData.features.filter((feature) => feature.kind === "water")
    .some((feature) => feature.rings.reduce((inside, ring) => inside !== inRing(point, ring), false));
}

describe("The short walk", () => {
  it("resolves all four chapters once, in walking order", () => {
    const chapters = getWalkChapters(route);
    expect(chapters).toHaveLength(walk.steps.length);
    expect(chapters.map((chapter) => chapter.id)).toEqual(["kozhevniki", "derbenevskaya", "housing", "zindel"]);
    expect(new Set(chapters.map((chapter) => chapter.content_id)).size).toBe(4);
    expect(chapters.at(-1)?.content).toBe(route.pois[0]);
  });

  it("counts transitions within the one-minute note budget", () => {
    for (const chapter of getWalkChapters(route)) {
      const text = [...chapter.content.story.paragraphs.map((paragraph) => paragraph.text), chapter.transition, chapter.next_hint].join(" ");
      const isNote = route.notes!.some((note) => note.id === chapter.content_id);
      expect(text.trim().split(/\s+/).length).toBeLessThanOrEqual(isNote ? 110 : 240);
      expect(chapter.duration_sec).toBeGreaterThan(0);
      expect(chapter.duration_sec).toBeLessThanOrEqual(isNote ? 60 : 120);
    }
  });

  it("keeps the requested buildings and the pedestrian route explicit", () => {
    expect(walk.start.address).toBe("2-й Кожевнический переулок, 12с10");
    expect(walk.finish.address).toBe("Дербеневская набережная, 7с22");
    expect(walk.path.costing).toBe("pedestrian");
    expect(walk.path.coordinates.length).toBeGreaterThan(20);
    expect(walk.field_checked).toBe(false);
    expect(route.distance_km * 1000).toBe(walk.distance_m);
  });

  it("ships a distinct, complete recording matching each visible chapter and its transitions", () => {
    const chapters = getWalkChapters(route);
    expect(new Set(chapters.map((chapter) => chapter.audio?.url)).size).toBe(4);
    for (const chapter of chapters) {
      const audio = chapter.audio!;
      expect(audio, chapter.id).toBeDefined();
      expect(audio.url).toMatch(/^\/audio\/walk\/[a-z0-9-]+\.mp3$/);
      const bytes = readFileSync(resolve("public", audio.url.slice(1)));
      expect(bytes.byteLength).toBeGreaterThan(100_000);
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(audio.audio_sha256);
      const text = [chapter.transition, ...chapter.content.story.paragraphs.map((paragraph) => paragraph.text), chapter.next_hint].filter(Boolean).join("\n\n");
      expect(createHash("sha256").update(text).digest("hex"), `${chapter.id}: regenerate audio after editing the narrative`).toBe(audio.script_sha256);
      expect(audio.synthetic).toBe(true);
      expect(audio.duration_sec).toBeGreaterThan(30);
      expect(audio.duration_sec).toBeLessThanOrEqual(chapter.id === "zindel" ? 120 : 60);
      expect(chapter.duration_sec).toBe(Math.ceil(audio.duration_sec));
    }
  });
});

describe("Geographic map", () => {
  it("retains closed river polygons and OSM attribution", () => {
    expect(mapData.license).toBe("https://www.openstreetmap.org/copyright");
    const rivers = mapData.features.filter((feature) => feature.kind === "water");
    expect(rivers.length).toBeGreaterThan(0);
    for (const feature of rivers) {
      for (const ring of feature.rings) expect(ring[0]).toEqual(ring.at(-1));
    }
    expect(inWater([37.658, 55.724])).toBe(true);
  });

  it("keeps the entire short walk on land, without crossing the river", () => {
    const points = walk.path.coordinates;
    for (let i = 0; i < points.length; i++) {
      expect(inWater(points[i]), `path vertex ${i}`).toBe(false);
      if (i > 0) {
        const midpoint = points[i].map((value, axis) => (value + points[i - 1][axis]) / 2);
        expect(inWater(midpoint), `path segment ${i}`).toBe(false);
      }
    }
  });

  it("preserves north, east and equal ground scale on both axes", () => {
    const { project, metersToPixels } = createProjection(mapData.bounds, 400);
    const lat = 55.724;
    const origin = project([37.65, lat]);
    const north = project([37.65, lat + 0.001]);
    const east = project([37.65 + 0.001 / Math.cos(lat * Math.PI / 180), lat]);
    expect(north[1]).toBeLessThan(origin[1]);
    expect(east[0]).toBeGreaterThan(origin[0]);
    expect((origin[1] - north[1]) / (east[0] - origin[0])).toBeCloseTo(1, 3);
    expect(metersToPixels(200)).toBeGreaterThan(50);
  });

  it("derives every marker and the route line from the walk data", () => {
    const svg = renderMap(mapData, route);
    expect(svg).toContain('id="walking-path"');
    for (const step of walk.steps) {
      expect(svg).toContain(`data-step="${step.id}" data-lat="${step.location.lat}" data-lon="${step.location.lon}"`);
    }
    expect(svg).not.toMatch(/NaN|Infinity|stroke-dasharray|route-drift/);
  });
});

describe("Chapter triggers", () => {
  const chapters = getWalkChapters(route);
  const fallback = { enterM: 35, exitM: 60, minFixes: 3, windowSize: 5, maxAccuracyM: 50 };
  const finish = walk.finish.location;

  it("listens for the stop of the chapter that plays next", () => {
    for (let index = 0; index < chapters.length - 1; index += 1) {
      const next = chapters[index + 1];
      expect(nextChapterTarget(chapters, index, finish)).toEqual(next.trigger_location ?? next.location);
    }
  });

  it("listens from the street for a stop set back from the route", () => {
    const housing = chapters.findIndex((chapter) => chapter.id === "housing");
    expect(chapters[housing].trigger_location).toBeDefined();
    expect(nextChapterTarget(chapters, housing - 1, finish)).toEqual(chapters[housing].trigger_location);
    expect(nextChapterTarget(chapters, housing - 1, finish)).not.toEqual(chapters[housing].location);
  });

  it("falls back to the finish on the last chapter and outside the walk", () => {
    expect(nextChapterTarget(chapters, chapters.length - 1, finish)).toEqual(finish);
    expect(nextChapterTarget([], 0, finish)).toEqual(finish);
  });

  it("uses the shared trigger until a stop is checked on the ground", () => {
    expect(chapterTriggerConfig(chapters, 0, fallback)).toBe(fallback);
  });

  it("prefers a field-checked trigger declared on the next stop", () => {
    const checked = [chapters[0], { ...chapters[1], trigger: { enter_m: 20, exit_m: 45, min_fixes: 4, max_accuracy_m: 25 } }];
    expect(chapterTriggerConfig(checked, 0, fallback)).toEqual({ enterM: 20, exitM: 45, minFixes: 4, windowSize: 5, maxAccuracyM: 25 });
  });
});
