import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { Route } from "./types";

const dataDirectory = resolve("public/data/routes");
const routes = readdirSync(dataDirectory)
  .filter((name) => name.endsWith(".json"))
  .map((name) => JSON.parse(readFileSync(resolve(dataDirectory, name), "utf8")) as Route);

// These checks protect the citation chain when new cards replace hand-authored
// content. They validate structure and provenance, not historical truth.
for (const route of routes) {
  describe(`Route content: ${route.id}`, () => {
    it("keeps notes distinct from stops and associates them with an existing place", () => {
      const items = [...route.pois, ...(route.notes ?? [])];
      expect(new Set(items.map((item) => item.id)).size).toBe(items.length);
      for (const note of route.notes ?? []) {
        expect(route.pois.some((poi) => poi.id === note.related_poi_id)).toBe(true);
        expect(note.place.trim()).not.toBe("");
        expect(["street_name", "everyday_life"]).toContain(note.kind);
      }
    });
  });

  const entries = [
    ...route.pois.map((content) => ({ content, format: "story" })),
    ...(route.notes ?? []).map((content) => ({ content, format: "note" })),
  ];
  for (const { content: poi, format } of entries) {
    describe(`Content: ${poi.id}`, () => {
      it("uses unique source, fact and paragraph identifiers", () => {
        for (const items of [poi.sources, poi.facts, poi.story.paragraphs]) {
          expect(items.every((item) => item.id.trim().length > 0)).toBe(true);
          expect(new Set(items.map((item) => item.id)).size).toBe(items.length);
        }
      });

      it("has readable source URLs and dated provenance", () => {
        expect(poi.sources.length).toBeGreaterThan(0);
        for (const source of poi.sources) {
          expect(new URL(source.url).protocol).toBe("https:");
          expect(source.title.trim()).not.toBe("");
          expect(source.publisher.trim()).not.toBe("");
          expect(source.checked_at).toMatch(/^\d{4}-\d{2}-\d{2}$/);
          expect(Number.isNaN(Date.parse(source.checked_at))).toBe(false);
        }
      });

      it("backs every verified fact with an existing source and a passage locator", () => {
        const sourceIds = new Set(poi.sources.map((source) => source.id));
        for (const fact of poi.facts) {
          expect(["verified", "legend", "unverified"]).toContain(fact.confidence);
          expect(fact.claim.trim()).not.toBe("");
          if (fact.confidence === "verified") expect(fact.evidence.length).toBeGreaterThan(0);
          for (const evidence of fact.evidence) {
            expect(sourceIds.has(evidence.source_id), `${fact.id}: missing source`).toBe(true);
            expect(evidence.locator.trim()).not.toBe("");
            expect(evidence.summary.trim()).not.toBe("");
          }
        }
      });

      it("only uses supported facts in a ready historical script", () => {
        if (poi.story.text_status !== "ready") return;
        expect(poi.story.paragraphs.length).toBeGreaterThan(0);
        const verifiedIds = new Set(poi.facts.filter((fact) => fact.confidence === "verified").map((fact) => fact.id));
        for (const paragraph of poi.story.paragraphs) {
          expect(paragraph.text.trim()).not.toBe("");
          expect(paragraph.fact_ids.length).toBeGreaterThan(0);
          for (const id of paragraph.fact_ids) {
            expect(verifiedIds.has(id), `${paragraph.id}: unsupported fact ${id}`).toBe(true);
          }
        }
      });

      it("keeps the script within the duration and word budget for its format", () => {
        if (poi.story.text_status !== "ready") return;
        const words = poi.story.paragraphs.flatMap((paragraph) => paragraph.text.trim().split(/\s+/));
        expect(words.length).toBeGreaterThanOrEqual(format === "note" ? 60 : 160);
        expect(words.length).toBeLessThanOrEqual(format === "note" ? 110 : 240);
        expect(poi.story.duration_sec).toBeGreaterThanOrEqual(format === "note" ? 30 : 90);
        expect(poi.story.duration_sec).toBeLessThanOrEqual(format === "note" ? 60 : 120);
        expect(poi.story.revision).toBeGreaterThan(0);
        expect(poi.story.checked_at).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      });

      it("never presents an estimate as a measured audio recording", () => {
        if (!poi.story.audio_url) {
          expect(poi.story.duration_is_estimate).toBe(true);
          return;
        }
        expect(poi.story.audio_url).toMatch(/^\/audio\/[a-zA-Z0-9_/-]+\.(mp3|m4a|wav|ogg)$/);
        expect(existsSync(resolve("public", poi.story.audio_url.slice(1)))).toBe(true);
        expect(poi.story.duration_is_estimate).toBe(false);
      });
    });
  }
}
