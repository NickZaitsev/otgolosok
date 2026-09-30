import { featureFilter, validateStyleMin } from "@maplibre/maplibre-gl-style-spec";
import { expect, it } from "vitest";
import { contentSecurityPolicy } from "../../../scripts/content-security-policy.mjs";
import { LAND_MIN_ZOOM, MAP_TILES_ORIGIN, mapStyle } from "./map-style";

it("passes the MapLibre style specification", () => {
  expect(validateStyleMin(mapStyle).map(error => error.message)).toEqual([]);
});

it("stays flat and icon-free", () => {
  expect(mapStyle).not.toHaveProperty("sprite");
  expect(mapStyle.layers.map(layer => layer.type)).not.toContain("fill-extrusion");
  expect(mapStyle.layers.filter(layer => "layout" in layer && layer.layout && "icon-image" in layer.layout)).toEqual([]);
});

it("uses only data that owes no credit beyond OpenStreetMap", () => {
  // Below z11 VersaTiles "land" carries ESA WorldCover classes, which need their own attribution.
  const land = mapStyle.layers.filter(layer => "source-layer" in layer && layer["source-layer"] === "land");
  expect(land.length).toBeGreaterThan(0);
  expect(LAND_MIN_ZOOM).toBeGreaterThanOrEqual(11);
  for (const layer of land) expect(layer.minzoom).toBe(LAND_MIN_ZOOM);
});

it("fetches tiles and glyphs only from the origin the CSP allows", () => {
  const urls = [mapStyle.glyphs, ...Object.values(mapStyle.sources).flatMap(source => source.tiles)];
  for (const url of urls) expect(new URL(url.replace(/[{}]/g, "")).origin).toBe(MAP_TILES_ORIGIN);
  expect(contentSecurityPolicy([])).toContain(`connect-src 'self' ${MAP_TILES_ORIGIN};`);
});

it.each([
  ["river", "Москва", true],
  ["canal", "канал имени Москвы", true],
  ["stream", "Кожевнический вражек", false],
  ["ditch", "Канава", false],
  ["drain", "Сток", false],
])("names a waterway of kind %s only if it is a river or canal", (kind, name, named) => {
  const labels = mapStyle.layers.filter(layer => "source-layer" in layer && layer["source-layer"] === "water_lines_labels");
  expect(labels.length).toBeGreaterThan(0);
  const feature = { type: 2 as const, properties: { kind, name } };
  const shown = labels.some(layer => "filter" in layer && featureFilter(layer.filter).filter({ zoom: 16 }, feature));
  expect(shown).toBe(named);
});
