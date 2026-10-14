import test from "node:test";
import assert from "node:assert/strict";
import { computeWalkEntry } from "./walk-entry.mjs";

const EARTH_RADIUS_M = 6_371_000;
const METRES_PER_DEGREE = EARTH_RADIUS_M * Math.PI / 180;
const BASE = { lat: 55.75, lon: 37.61 };
const at = (x, y) => ({
  lat: BASE.lat + y / METRES_PER_DEGREE,
  lon: BASE.lon + x / (METRES_PER_DEGREE * Math.cos(BASE.lat * Math.PI / 180)),
});
const stop = (id, location, triggerLocation) => ({
  id,
  place: { address: id, location },
  ...(triggerLocation ? { triggerLocation } : {}),
});
const walk = (geometry, stops, distanceM = 2000, walkingMinutes = 20) => ({
  route: { geometry, distanceM, walkingMinutes },
  stops,
});

test("entry in the middle returns only the remaining route and stops", () => {
  const geometry = [at(0, 0), at(0, 2000)];
  const result = computeWalkEntry(walk(geometry, [stop("past", at(0, 500)), stop("next", at(0, 1500)), stop("last", at(0, 1900))]), at(100, 1000));

  assert.ok(result);
  assert.equal(result.entryStopId, "next");
  assert.equal(result.entryIndex, 1);
  assert.equal(result.stopCount, 2);
  assert.equal(result.startDistanceM, 100);
  assert.ok(Math.abs(result.routeOffsetM - 1000) < 0.1);
  assert.ok(Math.abs(result.distanceM - 1000) < 0.1);
  assert.ok(Math.abs(result.walkingMinutes - 10) < 0.01);
  assert.equal(result.geometry.length, 2);
  assert.deepEqual(result.geometry[0], result.location);
  assert.deepEqual(result.geometry[1], geometry[1]);
});

test("triggerLocation determines stop progress and stops before entry are skipped", () => {
  const geometry = [at(0, 0), at(0, 1000)];
  const result = computeWalkEntry(walk(geometry, [
    stop("past", at(0, 900), at(0, 200)),
    stop("next", at(0, 100), at(0, 800)),
  ], 1000, 10), at(0, 500));

  assert.ok(result);
  assert.equal(result.entryStopId, "next");
  assert.equal(result.entryIndex, 1);
  assert.equal(result.stopCount, 1);
});

test("the distance boundary is inclusive", () => {
  const document = walk([at(0, 0), at(0, 1000)], [stop("next", at(0, 800))], 1000, 10);
  assert.ok(computeWalkEntry(document, at(500, 500), 500));
  assert.equal(computeWalkEntry(document, at(500.1, 500), 500), null);
});

test("ordered stop projections choose the later occurrence on a loop", () => {
  const geometry = [at(0, 0), at(100, 100), at(200, 0), at(0, 300), at(100, 100), at(200, 200)];
  const result = computeWalkEntry(walk(geometry, [
    stop("turn", at(0, 300)),
    stop("after-loop", at(100, 100)),
    stop("finish", at(200, 200)),
  ], 600, 12), at(50, 200));

  assert.ok(result);
  assert.equal(result.entryStopId, "after-loop");
  assert.equal(result.entryIndex, 1);
  assert.equal(result.stopCount, 2);
  assert.ok(result.routeOffsetM > 700 && result.routeOffsetM < 850);
});

test("equal projections at a self-crossing choose the earliest route occurrence", () => {
  const geometry = [at(0, 0), at(100, 100), at(0, 200), at(100, 100), at(200, 200)];
  const result = computeWalkEntry(walk(geometry, [stop("turn", at(0, 200)), stop("later", at(100, 100))]), at(100, 100));

  assert.ok(result);
  assert.ok(result.routeOffsetM < 150);
  assert.equal(result.entryStopId, "turn");
});

test("a sub-metre encoding difference does not discard the stop at the entry", () => {
  const geometry = [at(0, 0), at(0, 1000)];
  const result = computeWalkEntry(walk(geometry, [stop("last", at(0, 800))], 1000, 10), at(0, 800.5));
  assert.ok(result);
  assert.equal(result.entryStopId, "last");
});

test("finished walks and invalid inputs have no entry", async t => {
  const geometry = [at(0, 0), at(0, 1000)];
  const document = walk(geometry, [stop("last", at(0, 800))], 1000, 10);
  /** @type {Array<[string, any, {lat:number, lon:number}, number]>} */
  const cases = [
    ["past the last stop", document, at(0, 802), 500],
    ["at the route end", walk(geometry, [stop("last", at(0, 1000))], 1000, 10), at(0, 1000), 500],
    ["missing route", { ...document, route: null }, at(0, 500), 500],
    ["bad origin", document, { lat: Number.NaN, lon: BASE.lon }, 500],
    ["too far from the path", document, at(501, 500), 500],
    ["zero-length geometry", walk([at(0, 0), at(0, 0)], [stop("last", at(0, 0))]), at(0, 0), 500],
  ];
  for (const [name, candidate, origin, radiusM] of cases) await t.test(name, () => {
    assert.equal(computeWalkEntry(candidate, origin, radiusM), null);
  });
});

test("автомобильную поездку нельзя начинать как пешеходную с середины", () => {
  const document = walk([at(0,0), at(0,2000)], [stop("next", at(0,1500))]);
  assert.equal(computeWalkEntry({...document, travelMode:"driving"}, at(0,1000)), null);
  assert.equal(computeWalkEntry({...document, route:{...document.route,car:{}}}, at(0,1000)), null);
});
