import type { ExpressionSpecification, LayerSpecification, LineLayerSpecification, StyleSpecification } from "maplibre-gl";

/** Tiles, glyphs: the only origin the basemap talks to (see the CSP connect-src). */
export const MAP_TILES_ORIGIN = "https://tiles.versatiles.org";

// VersaTiles serves OSM in the Shortbread schema (CC0), so only © OpenStreetMap is owed.
// At low zooms VersaTiles fills the "land" layer with ESA WorldCover classes, which need their own credit.
// Each green layer starts above the zooms where ESA emits any of its kinds, so only OSM landuse is drawn.
// No sprite: the map carries no POI icons, only streets, water, buildings and names.
// Colours follow Yandex Maps: neutral light ground, bright blue water, fresh green parks,
// white side streets and grey-blue main roads, grey buildings.
const ground = "#f4f3f0";
const street = "#ffffff";
const casing = "#dadce0";
const mainStreet = "#c8cfd8";
const mainCasing = "#aab4c0";
const motorway = "#f6ab94";
const motorwayCasing = "#e5896e";
const water = "#8fd3f7";
const label = "#333333";
const muted = "#8e8e8e";

/** The highest zoom at which VersaTiles emits each ESA WorldCover kind (versatiles-org/landcover-vectors, config.ts). */
export const ESA_LANDCOVER_MAX_ZOOM: Record<string, number> = {
  forest: 6, farmland: 9, residential: 9, bare_rock: 9, heath: 9, scrub: 10, grassland: 10, marsh: 10, swamp: 10,
};
const lawn = ["park", "garden", "grass", "village_green", "recreation_ground", "meadow", "playground", "allotments", "cemetery"];
const woods = ["forest", "wood", "orchard"];

const drivable = ["motorway", "trunk", "primary", "secondary", "tertiary", "unclassified", "residential", "living_street", "pedestrian", "service"];
const major = ["motorway", "trunk", "primary"];
const middle = ["secondary", "tertiary"];
const narrow = ["pedestrian", "service", "living_street"];
const main = [...major, ...middle];
const side = drivable.filter(kind => !main.includes(kind));
const footways = ["footway", "path", "steps", "cycleway", "track"];

const streetWidth = (scale: number): ExpressionSpecification => ["interpolate", ["exponential", 1.6], ["zoom"],
  10, ["match", ["get", "kind"], major, 1.5 * scale, 0.6 * scale],
  12, ["match", ["get", "kind"], major, 2.5 * scale, middle, 1.2 * scale, 0.5 * scale],
  18, ["match", ["get", "kind"], major, 30 * scale, middle, 22 * scale, narrow, 9 * scale, 15 * scale]];

const byRank = (motorwayColor: string, mainColor: string, sideColor: string): ExpressionSpecification =>
  ["match", ["get", "kind"], "motorway", motorwayColor, main.filter(kind => kind !== "motorway"), mainColor, sideColor];

const aboveGround: ExpressionSpecification = ["!=", ["get", "tunnel"], true];

const greenLayer = (id: string, kinds: string[], color: string): LayerSpecification => ({
  id, type: "fill", source: "osm", "source-layer": "land",
  minzoom: Math.max(0, ...kinds.map(kind => (ESA_LANDCOVER_MAX_ZOOM[kind] ?? -1) + 1)),
  filter: ["in", ["get", "kind"], ["literal", kinds]], paint: { "fill-color": color },
});

const streetLayers = (id: string, kinds: string[], minzoom: number): LayerSpecification[] => {
  const common: Omit<LineLayerSpecification, "id" | "paint"> = { type: "line", source: "osm", "source-layer": "streets", minzoom,
    filter: ["all", ["in", ["get", "kind"], ["literal", kinds]], aboveGround],
    layout: { "line-cap": "round", "line-join": "round" } };
  return [
    { ...common, id: `${id}-street-casing`, paint: { "line-color": byRank(motorwayCasing, mainCasing, casing), "line-width": streetWidth(1.15) } },
    { ...common, id: `${id}-street`, paint: { "line-color": byRank(motorway, mainStreet, street), "line-width": streetWidth(1) } },
  ];
};

const streetName = (id: string, kinds: string[], minzoom: number): LayerSpecification => ({
  id, type: "symbol", source: "osm", "source-layer": "street_labels", minzoom,
  filter: ["in", ["get", "kind"], ["literal", kinds]],
  layout: { "text-field": ["get", "name"], "text-font": ["noto_sans_regular"],
    "text-size": ["interpolate", ["linear"], ["zoom"], 12, 11, 18, 16], "symbol-placement": "line", "text-max-angle": 30 },
  paint: { "text-color": label, "text-halo-color": street, "text-halo-width": 2.5 },
});

const waterText = "#2f78b0";

export const mapStyle = {
  version: 8,
  name: "Отголосок",
  sources: {
    osm: { type: "vector", tiles: [`${MAP_TILES_ORIGIN}/tiles/osm/{z}/{x}/{y}`], minzoom: 0, maxzoom: 14 },
  },
  glyphs: `${MAP_TILES_ORIGIN}/assets/glyphs/{fontstack}/{range}.pbf`,
  layers: [
    { id: "background", type: "background", paint: { "background-color": ground } },
    greenLayer("lawn", lawn, "#d3efb3"),
    greenLayer("woods", woods, "#bfe39a"),
    // OSM scrub shares its kind with ESA shrubland, so it appears only once ESA is gone.
    greenLayer("scrub", ["scrub"], "#bfe39a"),
    { id: "hospital", type: "fill", source: "osm", "source-layer": "sites", minzoom: 14,
      filter: ["==", ["get", "kind"], "hospital"], paint: { "fill-color": "#f9dfe7" } },
    { id: "campus", type: "fill", source: "osm", "source-layer": "sites", minzoom: 14,
      filter: ["in", ["get", "kind"], ["literal", ["school", "college", "university"]]], paint: { "fill-color": "#e6e4f5" } },
    { id: "water", type: "fill", source: "osm", "source-layer": "water_polygons", paint: { "fill-color": water } },
    { id: "river", type: "line", source: "osm", "source-layer": "water_lines",
      filter: ["all", ["in", ["get", "kind"], ["literal", ["river", "canal"]]], aboveGround],
      paint: { "line-color": water, "line-width": ["interpolate", ["linear"], ["zoom"], 10, 1, 18, 4] } },
    { id: "stream", type: "line", source: "osm", "source-layer": "water_lines", minzoom: 14,
      filter: ["all", ["!", ["in", ["get", "kind"], ["literal", ["river", "canal"]]]], aboveGround],
      paint: { "line-color": water, "line-width": ["interpolate", ["linear"], ["zoom"], 14, 1, 18, 2.5] } },
    { id: "street-area", type: "fill", source: "osm", "source-layer": "street_polygons", minzoom: 15, filter: aboveGround,
      paint: { "fill-color": "#f9f9f9" } },
    { id: "rail", type: "line", source: "osm", "source-layer": "streets",
      filter: ["all", ["==", ["get", "kind"], "rail"], aboveGround],
      paint: { "line-color": "#c4c4c4", "line-width": ["interpolate", ["linear"], ["zoom"], 13, 0.5, 18, 2] } },
    { id: "footway", type: "line", source: "osm", "source-layer": "streets", minzoom: 15,
      filter: ["all", ["in", ["get", "kind"], ["literal", footways]], aboveGround],
      layout: { "line-cap": "round" },
      paint: { "line-color": street, "line-width": ["interpolate", ["linear"], ["zoom"], 15, 1, 19, 3] } },
    // Minor streets appear as the view closes in: further out they turn the city into a grey mesh.
    ...streetLayers("side", side, 13),
    ...streetLayers("tertiary", ["tertiary"], 12),
    ...streetLayers("arterial", main.filter(kind => kind !== "tertiary"), 0),
    { id: "building", type: "fill", source: "osm", "source-layer": "buildings", minzoom: 14,
      paint: { "fill-color": "#e2ded8", "fill-outline-color": "#d0cac1" } },
    { id: "housenumber", type: "symbol", source: "osm", "source-layer": "addresses", minzoom: 17.5,
      layout: { "text-field": ["get", "housenumber"], "text-font": ["noto_sans_regular"], "text-size": 11 },
      paint: { "text-color": muted, "text-halo-color": ground, "text-halo-width": 1 } },
    // Rivers and canals are named along their course; streams and ditches ("Кожевнический вражек") are not.
    { id: "river-name", type: "symbol", source: "osm", "source-layer": "water_lines_labels",
      filter: ["in", ["get", "kind"], ["literal", ["river", "canal"]]],
      layout: { "text-field": ["match", ["get", "kind"], "river", ["concat", "р. ", ["get", "name"]], ["get", "name"]],
        "text-font": ["noto_sans_regular"], "text-size": 12, "symbol-placement": "line", "symbol-spacing": 400, "text-letter-spacing": 0.05 },
      paint: { "text-color": waterText, "text-halo-color": water, "text-halo-width": 1 } },
    // Tiles carry hundreds of named ponds at city scale: only reservoirs and bays there, ponds once walking-close.
    { id: "lake-name", type: "symbol", source: "osm", "source-layer": "water_polygons_labels", maxzoom: 15,
      filter: [">", ["get", "way_area"], 3_000_000],
      layout: { "text-field": ["get", "name"], "text-font": ["noto_sans_regular"], "text-size": 12, "text-max-width": 8 },
      paint: { "text-color": waterText, "text-halo-color": water, "text-halo-width": 1 } },
    { id: "pond-name", type: "symbol", source: "osm", "source-layer": "water_polygons_labels", minzoom: 15,
      filter: [">", ["get", "way_area"], 50_000],
      layout: { "text-field": ["get", "name"], "text-font": ["noto_sans_regular"], "text-size": 13, "text-max-width": 8 },
      paint: { "text-color": waterText, "text-halo-color": water, "text-halo-width": 1 } },
    streetName("main-street-name", main, 12),
    streetName("side-street-name", side, 14),
    // District names orient at city scale and give way to street names up close.
    { id: "district-name", type: "symbol", source: "osm", "source-layer": "place_labels", minzoom: 10, maxzoom: 14,
      filter: ["==", ["get", "kind"], "suburb"],
      layout: { "text-field": ["get", "name"], "text-font": ["noto_sans_regular"], "text-size": 11,
        "text-transform": "uppercase", "text-letter-spacing": 0.08, "text-max-width": 8 },
      paint: { "text-color": muted, "text-halo-color": ground, "text-halo-width": 1.5 } },
  ],
} satisfies StyleSpecification;
