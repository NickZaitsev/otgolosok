import type { ExpressionSpecification, StyleSpecification } from "maplibre-gl";

/** Tiles, glyphs: the only origin the basemap talks to (see the CSP connect-src). */
export const MAP_TILES_ORIGIN = "https://tiles.versatiles.org";

// VersaTiles serves OSM in the Shortbread schema (CC0), so only © OpenStreetMap is owed.
// VersaTiles fills the "land" layer with ESA WorldCover classes up to about z9, which needs its own credit;
// from z11 it holds OSM landuse only, so greenery is drawn from LAND_MIN_ZOOM on.
// No sprite: the map carries no POI icons, only streets, water, buildings and names.
// Colours follow Yandex Maps: neutral light ground, bright blue water, fresh green parks,
// white side streets and grey-blue main roads, grey buildings.
const ground = "#f4f3f0";
const street = "#ffffff";
const casing = "#dadce0";
const mainStreet = "#c8cfd8";
const mainCasing = "#aab4c0";
const water = "#8fd3f7";
const label = "#333333";
const muted = "#8e8e8e";

export const LAND_MIN_ZOOM = 12;
const lawn = ["park", "garden", "grass", "village_green", "recreation_ground", "meadow", "playground", "allotments", "cemetery"];
const woods = ["forest", "wood", "scrub", "orchard"];

const drivable = ["motorway", "trunk", "primary", "secondary", "tertiary", "unclassified", "residential", "living_street", "pedestrian", "service"];
const major = ["motorway", "trunk", "primary"];
const middle = ["secondary", "tertiary"];
const narrow = ["pedestrian", "service", "living_street"];
const main = [...major, ...middle];
const footways = ["footway", "path", "steps", "cycleway", "track"];

const streetWidth = (scale: number): ExpressionSpecification => ["interpolate", ["exponential", 1.6], ["zoom"],
  12, ["match", ["get", "kind"], major, 2.5 * scale, 0.5 * scale],
  18, ["match", ["get", "kind"], major, 30 * scale, middle, 22 * scale, narrow, 9 * scale, 15 * scale]];

const byRank = (mainColor: string, sideColor: string): ExpressionSpecification =>
  ["match", ["get", "kind"], main, mainColor, sideColor];

const aboveGround: ExpressionSpecification = ["!=", ["get", "tunnel"], true];

export const mapStyle = {
  version: 8,
  name: "Отголосок",
  sources: {
    osm: { type: "vector", tiles: [`${MAP_TILES_ORIGIN}/tiles/osm/{z}/{x}/{y}`], minzoom: 0, maxzoom: 14 },
  },
  glyphs: `${MAP_TILES_ORIGIN}/assets/glyphs/{fontstack}/{range}.pbf`,
  layers: [
    { id: "background", type: "background", paint: { "background-color": ground } },
    { id: "lawn", type: "fill", source: "osm", "source-layer": "land", minzoom: LAND_MIN_ZOOM,
      filter: ["in", ["get", "kind"], ["literal", lawn]], paint: { "fill-color": "#d3efb3" } },
    { id: "woods", type: "fill", source: "osm", "source-layer": "land", minzoom: LAND_MIN_ZOOM,
      filter: ["in", ["get", "kind"], ["literal", woods]], paint: { "fill-color": "#bfe39a" } },
    { id: "hospital", type: "fill", source: "osm", "source-layer": "sites", minzoom: 14,
      filter: ["==", ["get", "kind"], "hospital"], paint: { "fill-color": "#f9dfe7" } },
    { id: "campus", type: "fill", source: "osm", "source-layer": "sites", minzoom: 14,
      filter: ["in", ["get", "kind"], ["literal", ["school", "college", "university"]]], paint: { "fill-color": "#e6e4f5" } },
    { id: "water", type: "fill", source: "osm", "source-layer": "water_polygons", paint: { "fill-color": water } },
    { id: "waterway", type: "line", source: "osm", "source-layer": "water_lines", filter: aboveGround,
      paint: { "line-color": water, "line-width": ["interpolate", ["linear"], ["zoom"], 12, 1, 18, 4] } },
    { id: "street-area", type: "fill", source: "osm", "source-layer": "street_polygons", minzoom: 15, filter: aboveGround,
      paint: { "fill-color": "#f9f9f9" } },
    { id: "rail", type: "line", source: "osm", "source-layer": "streets",
      filter: ["all", ["==", ["get", "kind"], "rail"], aboveGround],
      paint: { "line-color": "#c4c4c4", "line-width": ["interpolate", ["linear"], ["zoom"], 13, 0.5, 18, 2] } },
    { id: "footway", type: "line", source: "osm", "source-layer": "streets", minzoom: 15,
      filter: ["all", ["in", ["get", "kind"], ["literal", footways]], aboveGround],
      layout: { "line-cap": "round" },
      paint: { "line-color": street, "line-width": ["interpolate", ["linear"], ["zoom"], 15, 1, 19, 3] } },
    { id: "street-casing", type: "line", source: "osm", "source-layer": "streets",
      filter: ["all", ["in", ["get", "kind"], ["literal", drivable]], aboveGround],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": byRank(mainCasing, casing), "line-width": streetWidth(1.15) } },
    { id: "street", type: "line", source: "osm", "source-layer": "streets",
      filter: ["all", ["in", ["get", "kind"], ["literal", drivable]], aboveGround],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": byRank(mainStreet, street), "line-width": streetWidth(1) } },
    { id: "building", type: "fill", source: "osm", "source-layer": "buildings", minzoom: 14,
      paint: { "fill-color": "#e2ded8", "fill-outline-color": "#d0cac1" } },
    { id: "housenumber", type: "symbol", source: "osm", "source-layer": "addresses", minzoom: 17.5,
      layout: { "text-field": ["get", "housenumber"], "text-font": ["noto_sans_regular"], "text-size": 11 },
      paint: { "text-color": muted, "text-halo-color": ground, "text-halo-width": 1 } },
    // Only sizeable water bodies are named: stream and ditch labels ("Кожевнический вражек") are noise on a walk map.
    { id: "water-name", type: "symbol", source: "osm", "source-layer": "water_polygons_labels",
      filter: [">", ["get", "way_area"], 50_000],
      layout: { "text-field": ["get", "name"], "text-font": ["noto_sans_regular"], "text-size": 13, "text-letter-spacing": 0.08 },
      paint: { "text-color": "#2f78b0", "text-halo-color": water, "text-halo-width": 1 } },
    { id: "street-name", type: "symbol", source: "osm", "source-layer": "street_labels", minzoom: 14,
      filter: ["in", ["get", "kind"], ["literal", drivable]],
      layout: { "text-field": ["get", "name"], "text-font": ["noto_sans_regular"],
        "text-size": ["interpolate", ["linear"], ["zoom"], 14, 12, 18, 16], "symbol-placement": "line", "text-max-angle": 30 },
      paint: { "text-color": label, "text-halo-color": street, "text-halo-width": 2.5 } },
  ],
} satisfies StyleSpecification;
