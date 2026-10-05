import { expect, it } from "vitest";
import { cellsForRoute, distanceToRoute, formatNearbyStop, formatRouteDistance, placesAlongRoute } from "./route-proximity";
import { foodCellKey } from "./food-cells";
import { foodPlace } from "./test-fixtures";
const origin = { lat: 55.75, lon: 37.6 };
const at = (x: number, y: number) => ({ lat: origin.lat + y / 111320, lon: origin.lon + x / (111320 * Math.cos(origin.lat * Math.PI / 180)) });

it.each([
  [500, 100, 100, 500], [-50, 0, 50, 0], [1100, 0, 100, 1000], [0, 0, 0, 0], [500, 0, 0, 500],
])("projects (%s,%s) onto a segment including its endpoints", (x, y, distance, along) => {
  const result = distanceToRoute(at(x, y), [at(0, 0), at(1000, 0)]);
  expect(result.distanceM).toBeCloseTo(distance, 1);
  expect(result.alongM).toBeCloseTo(along, 1);
  expect(result.vertex).toBe(0);
});
it("accumulates length and ignores zero-length segments", () => {
  const result = distanceToRoute(at(1000, 300), [at(0, 0), at(1000, 0), at(1000, 0), at(1000, 500)]);
  expect(result.distanceM).toBeCloseTo(0);
  expect(result.alongM).toBeCloseTo(1300, 1);
  expect(result.vertex).toBe(2);
});
it("handles empty and one-point geometry", () => {
  expect(distanceToRoute(origin, []).distanceM).toBe(Infinity);
  expect(distanceToRoute(at(0, 50), [origin])).toEqual({ distanceM: expect.closeTo(50), alongM: 0, vertex: 0 });
  expect(placesAlongRoute([foodPlace()], [])).toEqual([]);
});
it("filters at the radius and sorts by route position", () => {
  const places = [["osm:node:1", 900, 149], ["osm:node:2", 200, 150], ["osm:node:3", 100, 151]].map(([id, x, y]) => ({ ...foodPlace(id as string), ...at(x as number, y as number) }));
  const result = placesAlongRoute(places, [at(0, 0), at(1000, 0)], { maxDistanceM: 150.000001 });
  expect(result.map(p => p.id)).toEqual(["osm:node:2", "osm:node:1"]);
  expect(result[0].distanceM).toBeCloseTo(150, 4);
  expect(placesAlongRoute(places, [at(0, 0), at(1000, 0)], { maxDistanceM: -1 })).toEqual([]);
});
it("takes the earliest loop passage within 15m of the best, at its local minimum", () => {
  const geometry = [at(0, 10), at(200, 10), at(300, 100), at(200, 0), at(0, 0)], point = at(100, 0);
  expect(distanceToRoute(point, geometry).distanceM).toBeCloseTo(0);
  const loop = distanceToRoute(point, geometry, { mode: "loop" });
  expect(loop.distanceM).toBeCloseTo(10);
  expect(loop.alongM).toBeCloseTo(100, 1);
  expect(placesAlongRoute([{ ...foodPlace(), ...point }], geometry, { mode: "loop" })[0].alongM).toBeCloseTo(100, 1);
  expect(placesAlongRoute([{ ...foodPlace(), ...point }], geometry, { mode: "loop", maxDistanceM: 5 })[0].distanceM).toBeCloseTo(0);
});
it("selects the same local minimum on a densely sampled first passage", () => {
  const geometry = [...Array.from({ length: 201 }, (_, i) => at(i, 10)), at(200, 100), at(200, 0), at(0, 0)];
  expect(distanceToRoute(at(100, 0), geometry, { mode: "loop" }).alongM).toBeCloseTo(100, 1);
});
it("matches the exhaustive projection for dense, diagonal and corner-crossing routes", () => {
  const geometry = Array.from({ length: 400 }, (_, i) => at(i * 10, 100 * Math.sin(i / 20)));
  const places = Array.from({ length: 70 }, (_, i) => ({ ...foodPlace(`osm:node:${i}`), ...at(i * 60, (i % 7 - 3) * 80) }));
  const expected = places.map(p => ({ ...p, ...distanceToRoute(p, geometry) })).filter(p => p.distanceM <= 150).sort((a, b) => a.alongM - b.alongM);
  const actual = placesAlongRoute(places, geometry);
  expect(actual.map(p => p.id)).toEqual(expected.map(p => p.id));
  actual.forEach((p, i) => { expect(p.distanceM).toBeCloseTo(expected[i].distanceM, 8); expect(p.alongM).toBeCloseTo(expected[i].alongM, 8); });
});
it("bounds candidate checks for 2000 places × 12000 vertices", () => {
  const geometry = Array.from({ length: 12000 }, (_, i) => at(i * 8100 / 11999, 0));
  const places = Array.from({ length: 2000 }, (_, i) => ({ ...foodPlace(`osm:node:${i}`), ...at(i * 4, i % 2 ? 60 : 600) }));
  const stats = { checkedPairs: 0, bboxRejected: 0 };
  const result = placesAlongRoute(places, geometry, { stats });
  expect(result).toHaveLength(1000);
  expect(stats.bboxRejected).toBe(1000);
  expect(stats.checkedPairs).toBeGreaterThan(0);
  expect(stats.checkedPairs).toBeLessThan(2000 * 12000 / 10);
});
it.each([
  [[], []], [[{ lat: 55.751, lon: 37.601 }], ["1115:752"]],
  [[{ lat: -0.025, lon: -0.025 }], ["-1:-1"]], [[{ lat: 90, lon: 180 }], ["1799:3599"]],
])("route cells with zero buffer: %j", (geometry, keys) => expect(cellsForRoute(geometry, 0.05, 0)).toEqual(keys));
it("includes both sides of grid lines and the whole segment rather than just its vertices", () => {
  const geometry = [{ lat: 55.75, lon: 37.6 }, { lat: 55.75, lon: 37.75 }];
  const cells = cellsForRoute(geometry, 0.05, 150);
  expect(cells).toContain("1114:751");
  for (let i = 0; i <= 100; i += 1) expect(cells).toContain(foodCellKey(55.75, 37.6 + i * 0.0015));
  expect(new Set(cells).size).toBe(cells.length);
  expect(cellsForRoute(geometry, 0)).toEqual([]);
});
it("formats straight-line distance and nearest stop, with ties going to the earlier stop", () => {
  expect(formatRouteDistance(79.8)).toBe("≈ 80 м от маршрута");
  expect(formatNearbyStop(150, [{ alongM: 100 }, { alongM: 200 }])).toBe("рядом с остановкой 1");
  expect(formatNearbyStop(180, [{ alongM: 100 }, { alongM: 200 }])).toBe("рядом с остановкой 2");
  expect(formatNearbyStop(0, [])).toBeNull();
});
