import { describe, expect, it } from "vitest";
import { mobileFlutterPath, mutate, stableJson, verdict, type Mutation } from "@/lib/mobile-export/snapshot";
import { validateNearbyWalks } from "./nearby-model";
import { validateTopWalkPage } from "./top-model";

// The Dart port (mobile-flutter/lib/core/api/walk_cards.dart) must accept and reject exactly these samples.
const uuid = "11111111-1111-4111-8111-111111111111";
const line = { id: "1", name: "Сокольническая", color: "#D41317" };
const card = () => ({ kind: "catalog", id: "arbat", title: "Арбат", walkingMinutes: 30, distanceM: 2100, stopCount: 6, rating: { average: 4.5, count: 2 } });
const topWalk = () => ({ ...card(), rank: 1, preview: [[0, 0], [50, 100]],
  mapPreview: { zoom: 15, tiles: [{ x: 19805, y: 10244, left: -12.5, top: 3 }], points: [[10, 10], [200, 120]] },
  startMetro: { name: "Арбатская", distanceM: 300, lines: [line] }, endMetro: null });
const page = () => ({ walks: [topWalk(), { ...topWalk(), kind: "shared", id: uuid, rank: 2, preview: null, mapPreview: null, startMetro: null }],
  total: 30, nextOffset: 20, filters: { starts: ["Арбатская"], ends: [], stations: [{ name: "Арбатская", lines: [line], insideCircle: true }] } });
const nearby = () => ({ ...card(), startDistanceM: 120, finish: "Москва, Арбат, 40", entryStopId: "stop-2", audioMinutes: 12, audioComplete: false });


const topCases: Array<[string, Mutation]> = [
  ["valid page", () => undefined],
  ["legacy page without total, offset and filters", p => { delete p.total; delete p.nextOffset; delete p.filters; }],
  ["stations without lines from an older server", p => { delete p.filters.stations; }],
  ["rank defaults to position", p => { delete p.walks[1].rank; }],
  ["car walk", p => { p.walks[0].travelMode = "driving"; p.walks[0].totalMinutes = 95; }],
  ["no ratings yet", p => { p.walks[0].rating = { average: null, count: 0 }; }],
  ["21 walks", p => { p.walks = Array.from({ length: 21 }, topWalk); }],
  ["unknown kind", p => { p.walks[0].kind = "own"; }],
  ["shared walk with a slug id", p => { p.walks[1].id = "arbat"; }],
  ["catalog id with capitals", p => { p.walks[0].id = "Arbat"; }],
  ["rank 0", p => { p.walks[0].rank = 0; }],
  ["average without ratings", p => { p.walks[0].rating = { average: 4, count: 0 }; }],
  ["average above 5", p => { p.walks[0].rating.average = 5.1; }],
  ["driving without total minutes", p => { p.walks[0].travelMode = "driving"; }],
  ["walking minutes 0", p => { p.walks[0].walkingMinutes = 0; }],
  ["preview point out of range", p => { p.walks[0].preview = [[0, 0], [101, 0]]; }],
  ["map preview with 5 tiles", p => { p.walks[0].mapPreview.tiles = Array(5).fill(p.walks[0].mapPreview.tiles[0]); }],
  ["map tile outside the zoom", p => { p.walks[0].mapPreview.tiles[0].x = 2 ** 15; }],
  ["metro station too far", p => { p.walks[0].startMetro.distanceM = 1501; }],
  ["metro line colour without hash", p => { p.walks[0].startMetro.lines[0].color = "D41317"; }],
  ["total below walk count", p => { p.total = 1; }],
  ["next offset past the total", p => { p.nextOffset = 31; }],
  ["insideCircle not boolean", p => { p.filters.stations[0].insideCircle = "yes"; }],
  ["not an object", p => { p.walks = null; }],
];

const nearbyCases: Array<[string, Mutation]> = [
  ["valid", () => undefined],
  ["older server without entry and audio", w => { delete w.entryStopId; delete w.audioMinutes; delete w.audioComplete; }],
  ["loop walk", w => { w.finish = null; }],
  ["own walk with an upper-case uuid", w => { w.kind = "own"; w.id = uuid.toUpperCase(); }],
  ["local walk from the server", w => { w.kind = "local"; }],
  ["shared walk with a slug", w => { w.kind = "shared"; }],
  ["negative start distance", w => { w.startDistanceM = -1; }],
  ["fractional start distance", w => { w.startDistanceM = 1.5; }],
  ["empty finish", w => { w.finish = " "; }],
  ["finish longer than 180", w => { w.finish = "д".repeat(181); }],
  ["entry stop with spaces", w => { w.entryStopId = "stop 2"; }],
  ["audio minutes without completeness", w => { delete w.audioComplete; }],
  ["audio complete not boolean", w => { w.audioComplete = 1; }],
];

describe("walk card API fixtures for the mobile app", () => {
  it("exports top page and nearby walk verdicts", async () => {
    const top = topCases.map(([name, change]) => verdict(name, mutate(page, change), validateTopWalkPage));
    const near = nearbyCases.map(([name, change]) => verdict(name, { walks: [mutate(nearby, change)] }, validateNearbyWalks));
    near.push(verdict("walks not a list", { walks: {} }, validateNearbyWalks));
    expect(top.filter(item => item.valid).length).toBe(6);
    expect(near.filter(item => item.valid).length).toBe(4);
    await expect(stableJson({ top, nearby: near })).toMatchFileSnapshot(mobileFlutterPath("test/fixtures/api/walk_cards.json"));
  });
});
