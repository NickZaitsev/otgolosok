import { describe, expect, it } from "vitest";
import routeData from "../../../public/data/routes/paveletskaya.json";
import type { Route } from "./types";
import { applyPublishedRoute } from "./published-route";

const route = routeData as Route;

describe("published walk narration", () => {
  it("accepts a walk containing POIs without an optional notes array", () => {
    const base: Route = { ...route, notes: undefined, walk: { ...route.walk!, steps: route.walk!.steps.filter(step => route.pois.some(poi => poi.id === step.content_id)) } };
    const publication = structuredClone(base);
    publication.walk!.steps[0].title = "Новый заголовок";
    expect(applyPublishedRoute(base, publication).walk!.steps[0].title).toBe("Новый заголовок");
  });
  it("updates matching text and audio together while preserving geometry and evidence", () => {
    const publication = structuredClone(route);
    const step = publication.walk!.steps[0];
    step.title = "Новая редакция";
    step.transition = "Начинаем прогулку.";
    step.audio = { ...step.audio!, url: `/api/story-audio/${"a".repeat(64)}.mp3`, duration_sec: 65, voice: "kirill" };
    const content = [...publication.pois, ...publication.notes!].find(item => item.id === step.content_id)!;
    content.story.paragraphs[0].text = "Уточнённый рассказ о месте.";
    const result = applyPublishedRoute(route, publication);
    expect(result.walk!.steps[0].audio?.url).toBe(step.audio.url);
    expect(result.walk!.steps[0].duration_sec).toBe(65);
    expect(result.walk!.steps[0].title).toBe("Новая редакция");
    const updated = [...result.pois, ...result.notes!].find(item => item.id === step.content_id)!;
    expect(updated.story.paragraphs[0].text).toBe(content.story.paragraphs[0].text);
    expect(result.walk!.path).toBe(route.walk!.path);
    expect(updated.sources).toBe([...route.pois, ...route.notes!].find(item => item.id === step.content_id)!.sources);
    expect(route.walk!.steps[0].audio?.voice).not.toBe("kirill");
  });

  it("keeps the complete bundled version for malformed or mismatched publications", () => {
    for (const change of [
      (value: Route) => { value.id = "other"; },
      (value: Route) => { value.walk!.steps.reverse(); },
      (value: Route) => { value.walk!.steps[0].audio!.url = "https://untrusted.example/audio.mp3"; },
      (value: Route) => { value.walk!.steps[0].audio!.duration_sec = -1; },
      (value: Route) => { value.notes![0].story.paragraphs[0].fact_ids = []; },
      (value: Route) => { value.walk!.steps.pop(); },
    ]) {
      const invalid = structuredClone(route);
      change(invalid);
      expect(applyPublishedRoute(route, invalid)).toBe(route);
    }
    expect(applyPublishedRoute(route, null)).toBe(route);
  });
});
