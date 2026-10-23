import { describe, expect, it } from "vitest";
import { mobileFlutterPath, mutate, stableJson, verdict, type Mutation } from "@/lib/mobile-export/snapshot";
import { isPlan, parseDraft, readResearchJob, validStops } from "./model";

// The Dart port (mobile-flutter/lib/features/walk_builder/model.dart) must accept and reject exactly these samples.
const uuid = (digit: string) => `${digit.repeat(8)}-${digit.repeat(4)}-4${digit.repeat(3)}-8${digit.repeat(3)}-${digit.repeat(12)}`;
const start = { address: "Москва, Арбат, 1", location: { lat: 55.7515, lon: 37.5925 } };
const stop = { address: "Москва, Арбат, 10", location: { lat: 55.752, lon: 37.593 }, contentId: "osm:way:1" };
const far = { address: "Москва, Тверская, 1", location: { lat: 55.757, lon: 37.613 } };
const plan = () => ({ stops: [{ ...stop }], geometry: [start.location, stop.location, start.location], distanceM: 400, walkingMinutes: 6, attribution: "© OpenStreetMap contributors" });
const draft = () => ({ version: 1, title: "Моя прогулка", start, mode: "loop", travelMode: "walking", minutes: 30, stops: [{ ...stop }], route: plan(),
  jobs: [{ place: { ...stop }, id: uuid("a"), stage: "ready" }, { place: { ...stop }, id: uuid("a"), stage: "voicing" }], submitting: null });
const request = () => ({ start, destination: null, mode: "loop", minutes: 30 });
const job = () => ({ id: uuid("b"), stage: "researching", revision: 3, request: request(), phase: "research", progress: { checked: 2, total: 3, accepted: 1 },
  route: null, stories: [{ place: { ...stop }, id: uuid("c"), stage: "ready" }], error: null, canRetry: false });


const planCases: Array<[string, Mutation]> = [
  ["valid", () => undefined],
  ["address of five letters", p => { p.stops[0].address = "Арбат"; }],
  ["address with a control character", p => { p.stops[0].address = "Москва,\u0007 Арбат"; }],
  ["stop outside Moscow", p => { p.stops[0].location = { lat: 55.79, lon: 49.1 }; }],
  ["bad content id", p => { p.stops[0].contentId = "way:1"; }],
  ["walking distance over 8100", p => { p.distanceM = 8101; }],
  ["walking minutes over 90", p => { p.walkingMinutes = 91; }],
  ["empty attribution", p => { p.attribution = ""; }],
  ["invalid tunnels", p => { p.tunnels = [[0, 3]]; }],
];

const draftCases: Array<[string, Mutation]> = [
  ["valid with duplicate jobs collapsed", () => undefined],
  ["empty start", d => { d.start = null; d.stops = []; d.route = null; }],
  ["open walk with destination", d => { d.mode = "open"; d.destination = { ...far }; d.route = null; }],
  ["driving minutes", d => { d.travelMode = "driving"; d.minutes = 120; d.route = null; }],
  ["walking draft with 120 minutes", d => { d.minutes = 120; }],
  ["destination on a loop", d => { d.destination = { ...far }; }],
  ["route stops differ", d => { d.route.stops[0].address = "Москва, Арбат, 11"; }],
  ["route longer than the budget", d => { d.route.walkingMinutes = 31; }],
  ["unknown job stage", d => { d.jobs[0].stage = "done"; }],
  ["research on a driving draft", d => { d.travelMode = "driving"; d.minutes = 60; d.route = null; d.research = { request: request(), id: null, stops: [], recoveryToken: uuid("d") }; }],
  ["valid research", d => { d.research = { request: request(), id: uuid("b"), stops: [], recoveryToken: uuid("d") }; d.researchApplied = false; }],
  ["title longer than 120", d => { d.title = "т".repeat(121); }],
];

const jobCases: Array<[string, Mutation]> = [
  ["valid", () => undefined],
  ["complete with a route", j => { j.stage = "ready"; j.phase = "complete"; j.progress = { checked: 3, total: 3, accepted: 1 }; j.route = plan(); }],
  ["route over the requested minutes", j => { j.route = { ...plan(), walkingMinutes: 31 }; }],
  ["progress over 3", j => { j.progress.total = 4; }],
  ["accepted above checked", j => { j.progress.accepted = 3; }],
  ["four stories", j => { j.stories = Array(4).fill(j.stories[0]); }],
  ["unknown phase", j => { j.phase = "waiting"; }],
  ["error without message", j => { j.error = { code: "FAILED" }; }],
  ["request with 120 minutes", j => { j.request.minutes = 120; }],
];

const stopCases = [
  { name: "one stop", stops: [stop], destination: null },
  { name: "no stops without destination", stops: [], destination: null },
  { name: "destination only", stops: [], destination: far },
  { name: "first stop at the start", stops: [{ ...start }, far], destination: null },
  { name: "two stops 3 m apart", stops: [far, { ...far, location: { lat: far.location.lat + 0.00003, lon: far.location.lon } }], destination: null },
  { name: "41 stops", stops: Array.from({ length: 41 }, (_, index) => ({ ...far, location: { lat: 55.757 + index * 0.0001, lon: 37.613 } })), destination: null },
];

describe("walk builder fixtures for the mobile app", () => {
  it("exports plan, draft, research job and stop verdicts", async () => {
    const plans = planCases.map(([name, change]) => { const input = mutate(plan, change); return { name, input, valid: isPlan(input) }; });
    const drafts = [verdict("missing draft", null, () => parseDraft(null)), verdict("not json", "{", raw => parseDraft(raw as string)),
      ...draftCases.map(([name, change]) => verdict(name, JSON.stringify(mutate(draft, change)), raw => parseDraft(raw as string)))];
    const jobs = jobCases.map(([name, change]) => verdict(name, mutate(job, change), value => readResearchJob(value)));
    const stops = stopCases.map(item => ({ ...item, start, valid: validStops(start, item.stops, item.destination) }));
    expect(plans.filter(item => item.valid).map(item => item.name)).toEqual(["valid"]);
    expect(drafts.find(item => item.name === "valid with duplicate jobs collapsed")?.valid).toBe(true);
    expect(jobs.filter(item => item.valid).map(item => item.name)).toEqual(["valid", "complete with a route"]);
    expect(stops.filter(item => item.valid).map(item => item.name)).toEqual(["one stop", "destination only", "first stop at the start"]);
    await expect(stableJson({ plans, drafts, jobs, stops })).toMatchFileSnapshot(mobileFlutterPath("test/fixtures/api/walk_builder.json"));
  });
});
