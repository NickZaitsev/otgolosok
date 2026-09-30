import { validateStyleMin } from "@maplibre/maplibre-gl-style-spec";
import { expect, it } from "vitest";
import { contentSecurityPolicy } from "../../../scripts/content-security-policy.mjs";
import { MAP_TILES_ORIGIN, mapStyle } from "./map-style";

it("passes the MapLibre style specification", () => {
  expect(validateStyleMin(mapStyle).map(error => error.message)).toEqual([]);
});

it("stays flat and icon-free", () => {
  expect(mapStyle).not.toHaveProperty("sprite");
  expect(mapStyle.layers.map(layer => layer.type)).not.toContain("fill-extrusion");
  expect(mapStyle.layers.filter(layer => "layout" in layer && layer.layout && "icon-image" in layer.layout)).toEqual([]);
});

it("uses only data that owes no credit beyond OpenStreetMap", () => {
  // VersaTiles builds "land" partly from ESA WorldCover, which needs its own attribution.
  expect(mapStyle.layers.map(layer => "source-layer" in layer ? layer["source-layer"] : null)).not.toContain("land");
});

it("fetches tiles and glyphs only from the origin the CSP allows", () => {
  const urls = [mapStyle.glyphs, ...Object.values(mapStyle.sources).flatMap(source => source.tiles)];
  for (const url of urls) expect(new URL(url.replace(/[{}]/g, "")).origin).toBe(MAP_TILES_ORIGIN);
  expect(contentSecurityPolicy([])).toContain(`connect-src 'self' ${MAP_TILES_ORIGIN};`);
});
