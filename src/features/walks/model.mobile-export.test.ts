import { describe, expect, it } from "vitest";
import { carWalkDocument } from "../../../backend/test-fixtures/car-walk.mjs";
import { mobileFlutterPath, mutate, stableJson, verdict, type Mutation } from "@/lib/mobile-export/snapshot";
import { validateWalkDocument, validateWalkView, type WalkDocument, type WalkView } from "./model";

// The Dart port (mobile-flutter/lib/core/api/walk_view.dart) must accept and reject exactly these samples.
const hash = (letter: string) => letter.repeat(64);
const start = { address: "Москва, Арбат, 1", location: { lat: 55.7515, lon: 37.5925 } };
const stops = [{ lat: 55.752, lon: 37.593 }, { lat: 55.753, lon: 37.595 }];

function walkDocument(): WalkDocument {
  return {
    version: 2, id: "arbat-test", title: "Арбат", description: "Короткая прогулка", city: "Москва", mode: "loop", minutes: 30, start,
    stops: stops.map((location, index) => ({ id: `stop-${index + 1}`, place: { address: `Москва, Арбат, ${index + 10}`, location }, storyRef: null,
      transition: "", nextHint: "" })),
    route: { geometry: [start.location, ...stops, start.location], distanceM: 600, walkingMinutes: 9, attribution: "© OpenStreetMap contributors" },
    fieldChecked: false,
  };
}

function walkView(): WalkView {
  const document = walkDocument();
  return {
    document, revision: 2, contentVersion: "v2",
    chapters: document.stops.map((stop, index) => index === 0 ? {
      id: stop.id, status: "ready" as const,
      story: { title: "Дом с башней", address: stop.place.address, paragraphs: [{ text: "Текст рассказа.", factIds: ["f1"] }],
        sources: [{ id: "s1", title: "Архив", url: "https://example.org/archive", publisher: "" }], facts: [{ id: "f1", claim: "Факт.", sourceIds: ["s1"] }] },
      audio: { url: `/api/story-audio/${hash("a")}.mp3`, sha256: hash("a"), durationSec: 61 },
    } : { id: stop.id, status: "preparing" as const, story: null, audio: null }),
  };
}

const english = (view: WalkView): WalkView => ({
  ...view, requestedLocale: "en", documentLocalization: { requestedLocale: "en", contentLocale: "ru", fallbackReason: "missing" },
  chapters: view.chapters.map(chapter => ({ ...chapter, localization: { requestedLocale: "en", contentLocale: "ru", fallbackReason: "missing" } })),
});


const documentCases: Array<[string, Mutation]> = [
  ["valid loop", () => undefined],
  ["valid open with destination", d => { d.mode = "open"; d.destination = { address: "Москва, Арбат, 40", location: { lat: 55.754, lon: 37.597 } }; }],
  ["valid catalog uuid id", d => { d.id = "11111111-1111-4111-8111-111111111111"; }],
  ["valid trigger location", d => { d.stops[0].triggerLocation = { lat: 55.7521, lon: 37.5931 }; }],
  ["valid without route", d => { d.route = null; }],
  ["valid tunnels", d => { d.route.tunnels = [[0, 1]]; }],
  ["version 1", d => { d.version = 1; }],
  ["unknown field", d => { d.extra = true; }],
  ["bad id", d => { d.id = "Arbat Test"; }],
  ["empty title", d => { d.title = " "; }],
  ["unknown city", d => { d.city = "Тверь"; }],
  ["minutes 45", d => { d.minutes = 45; }],
  ["destination on a loop", d => { d.destination = { address: "Москва, Арбат, 40", location: { lat: 55.754, lon: 37.597 } }; }],
  ["duplicate stop ids", d => { d.stops[1].id = d.stops[0].id; }],
  ["stop outside the city", d => { d.stops[1].place.location = { lat: 55.79, lon: 49.1 }; }],
  ["route geometry of one point", d => { d.route.geometry = [start.location]; }],
  ["route too long", d => { d.route.distanceM = 8101; }],
  ["walking minutes 0", d => { d.route.walkingMinutes = 0; }],
  ["tunnels out of order", d => { d.route.tunnels = [[1, 2], [0, 1]]; }],
  ["fieldChecked not boolean", d => { d.fieldChecked = "no"; }],
  ["stops without a start", d => { d.start = null; d.route = null; }],
];

const viewCases: Array<[string, Mutation]> = [
  ["valid", () => undefined],
  ["unknown field", v => { v.extra = 1; }],
  ["negative revision", v => { v.revision = -1; }],
  ["chapter count mismatch", v => { v.chapters.pop(); }],
  ["chapter id mismatch", v => { v.chapters[0].id = "other"; }],
  ["unknown status", v => { v.chapters[0].status = "done"; }],
  ["audio without story", v => { v.chapters[0].story = null; }],
  ["audio url outside the API", v => { v.chapters[0].audio.url = "https://cdn.example.org/a.mp3"; }],
  ["audio over two hours", v => { v.chapters[0].audio.durationSec = 7201; }],
  ["audio language differs from content", v => { v.chapters[0].audio.language = "en"; }],
  ["source url not https", v => { v.chapters[0].story.sources[0].url = "http://example.org"; }],
  ["empty paragraphs", v => { v.chapters[0].story.paragraphs = []; }],
  ["bad checkedAt", v => { v.chapters[0].story.checkedAt = "2026-1-1"; }],
  ["invalid document", v => { v.document.version = 1; }],
];

const englishCases: Array<[string, Mutation]> = [
  ["valid english fallback", () => undefined],
  ["chapter without localization", v => { delete v.chapters[1].localization; }],
  ["localization for another locale", v => { v.chapters[0].localization.requestedLocale = "zh"; }],
  ["fallback without reason", v => { v.documentLocalization.fallbackReason = null; }],
  ["fallback to english", v => { v.documentLocalization = { requestedLocale: "en", contentLocale: "en", fallbackReason: "missing" }; }],
  ["unknown locale", v => { v.requestedLocale = "de"; }],
];

describe("walk API fixtures for the mobile app", () => {
  it("exports walk document and walk view verdicts", async () => {
    const documents = [
      ...documentCases.map(([name, change]) => verdict(name, mutate(walkDocument, change), validateWalkDocument)),
      verdict("valid car walk", carWalkDocument(), validateWalkDocument),
      verdict("car walk over its minutes", mutate(carWalkDocument, d => { d.minutes = 15; }), validateWalkDocument),
      verdict("car walk with a broken total", mutate(carWalkDocument, d => { d.route.car.totalMinutes = 40; }), validateWalkDocument),
    ];
    const views = [
      ...viewCases.map(([name, change]) => verdict(name, mutate(walkView, change), validateWalkView)),
      ...englishCases.map(([name, change]) => verdict(name, mutate(() => english(walkView()), change), validateWalkView)),
    ];
    expect(documents.filter(item => item.valid).map(item => item.name))
      .toEqual(["valid loop", "valid open with destination", "valid catalog uuid id", "valid trigger location", "valid without route", "valid tunnels", "valid car walk"]);
    expect(views.filter(item => item.valid).map(item => item.name)).toEqual(["valid", "valid english fallback"]);
    await expect(stableJson({ documents, views })).toMatchFileSnapshot(mobileFlutterPath("test/fixtures/api/walk_view.json"));
  });
});
