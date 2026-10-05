import { expect, it } from "vitest";
import type { MapViewport } from "../explore/catalog-bounds";
import { visibleFoodPlaces } from "./food-viewport";
import { foodPlace } from "./test-fixtures";

const bounds = { south: 55.75, north: 55.76, west: 37.6, east: 37.62 };
const viewport: MapViewport = { required: bounds, buffered: { south: 55.7, north: 55.8, west: 37.5, east: 37.7 }, center: { lat: 55.755, lon: 37.61 }, zoom: 15 };

it.each([14, 14.99, 15, 15.01, 19])("порог масштаба %s", zoom => {
  expect(visibleFoodPlaces([foodPlace()], { ...viewport, zoom })).toHaveLength(zoom < 15 ? 0 : 1);
});
it.each([
  [55.75, 37.6, true], [55.76, 37.62, true], [55.755, 37.61, true],
  [55.74999, 37.61, false], [55.76001, 37.61, false], [55.755, 37.59999, false], [55.755, 37.62001, false],
  [55.79, 37.61, false],
] as const)("границы области %s, %s", (lat, lon, included) => {
  expect(visibleFoodPlaces([foodPlace("osm:node:1", lat, lon)], viewport)).toHaveLength(included ? 1 : 0);
});
it.each([0, 1, 299, 300, 301, 1600])("ближайшие 300 из %s без мутации исходного массива", count => {
  const places = Array.from({ length: count }, (_, i) => foodPlace(`osm:node:${i + 1}`, viewport.center.lat + i * .000001, viewport.center.lon)).reverse();
  const original = [...places];
  expect(visibleFoodPlaces(places, viewport).map(p => p.id)).toEqual(Array.from({ length: Math.min(count, 300) }, (_, i) => `osm:node:${i + 1}`));
  expect(places).toEqual(original);
});
it("учитывает масштаб долготы и детерминированно разрешает равные расстояния", () => {
  const places = [foodPlace("osm:node:3", 55.756, 37.61), foodPlace("osm:node:2", 55.755, 37.611), foodPlace("osm:node:1", 55.755, 37.611)];
  expect(visibleFoodPlaces(places, viewport).map(p => p.id)).toEqual(["osm:node:1", "osm:node:2", "osm:node:3"]);
  expect(visibleFoodPlaces(places, null)).toEqual([]);
});
