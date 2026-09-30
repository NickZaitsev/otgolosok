import { featureFilter, validateStyleMin } from "@maplibre/maplibre-gl-style-spec";
import { expect, it } from "vitest";
import { contentSecurityPolicy } from "../../../scripts/content-security-policy.mjs";
import { ESA_LANDCOVER_MAX_ZOOM, MAP_TILES_ORIGIN, mapStyle } from "./map-style";

it("passes the MapLibre style specification", () => {
  expect(validateStyleMin(mapStyle).map(error => error.message)).toEqual([]);
});

it("stays flat and icon-free", () => {
  expect(mapStyle).not.toHaveProperty("sprite");
  expect(mapStyle.layers.map(layer => layer.type)).not.toContain("fill-extrusion");
  expect(mapStyle.layers.filter(layer => "layout" in layer && layer.layout && "icon-image" in layer.layout)).toEqual([]);
});

const landLayers = mapStyle.layers.filter(layer => "source-layer" in layer && layer["source-layer"] === "land");
const drawsAt = (zoom: number, kind: string) => landLayers.some(layer =>
  (layer.minzoom ?? 0) <= zoom && "filter" in layer && featureFilter(layer.filter).filter({ zoom }, { type: 3, properties: { kind } }));

it("never draws ESA WorldCover landcover, which owes credit beyond OpenStreetMap", () => {
  for (const [kind, maxZoom] of Object.entries(ESA_LANDCOVER_MAX_ZOOM)) {
    for (let zoom = 0; zoom <= maxZoom; zoom++) expect(drawsAt(zoom, kind), `${kind} at z${zoom}`).toBe(false);
  }
});

it.each([
  [3, "park"],
  [7, "forest"],
  [10, "forest"],
  [10, "cemetery"],
  [11, "scrub"],
  [16, "garden"],
])("draws OSM greenery at z%i: %s", (zoom, kind) => {
  expect(drawsAt(zoom, kind)).toBe(true);
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
