import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const radians = (degrees) => degrees * Math.PI / 180;
const mercatorY = (latitude) => Math.log(Math.tan(Math.PI / 4 + radians(latitude) / 2));

export function createProjection(bounds, size) {
  const [west, south, east, north] = bounds;
  const spanX = radians(east - west);
  const spanY = mercatorY(north) - mercatorY(south);
  const scale = Math.min(size / spanX, size / spanY);
  return {
    project: ([lon, lat]) => [
      (size - spanX * scale) / 2 + radians(lon - west) * scale,
      (size - spanY * scale) / 2 + (mercatorY(north) - mercatorY(lat)) * scale,
    ],
    metersToPixels: (meters) => meters * scale / (6378137 * Math.cos(radians((north + south) / 2))),
  };
}

const escape = (text) => String(text).replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;",
})[character]);
const number = (value) => value.toFixed(2);

export function renderMap(map, route) {
  const poi = route.pois[0];
  const { project, metersToPixels } = createProjection(map.bounds, map.size);
  const path = (rings, closed = true) => rings.map((ring) => ring.map((point, index) =>
    `${index ? "L" : "M"}${project(point).map(number).join(",")}`,
  ).join("") + (closed ? "Z" : "")).join("");
  const layers = ["park", "water", "building", "rail", "road", "bridge"];
  const visibleFeatures = map.features.filter((feature) => {
    const points = feature.rings.flat();
    const xs = points.map(([lon]) => lon);
    const ys = points.map(([, lat]) => lat);
    return Math.max(...xs) >= map.bounds[0] && Math.min(...xs) <= map.bounds[2] && Math.max(...ys) >= map.bounds[1] && Math.min(...ys) <= map.bounds[3];
  });
  const geometry = layers.map((kind) => `<g class="${kind}">${visibleFeatures.filter((feature) => feature.kind === kind).map((feature) => {
    const roadWidth = ["primary", "secondary"].includes(feature.road_class) ? 3.5 : 2;
    const width = kind === "road" || kind === "bridge" ? ` stroke-width="${roadWidth}"` : "";
    return `<path data-osm="${escape(feature.id)}" d="${path(feature.rings, !["rail", "road", "bridge"].includes(kind))}"${width}/>`;
  }).join("")}</g>`).join("\n");
  const label = (location, lines, options = {}) => {
    const [x, y] = project(location);
    const { dx = 0, dy = 0, angle = 0, className = "label", anchor = "middle" } = options;
    return `<text class="${className}" text-anchor="${anchor}" transform="translate(${number(x + dx)} ${number(y + dy)}) rotate(${angle})">${lines.map((line, index) => `<tspan x="0" dy="${index ? 14 : 0}">${escape(line)}</tspan>`).join("")}</text>`;
  };
  const landmarks = map.landmarks.map((landmark) => {
    const [x, y] = project(landmark.location);
    return `<circle cx="${number(x)}" cy="${number(y)}" r="3" class="landmark"/>` + label(landmark.location, landmark.label, {
      dy: landmark.id === "relation/7253185" ? 19 : -26,
    });
  }).join("\n");
  const steps = route.walk?.steps ?? [{ id: poi.id, location: poi.location, title: poi.name }];
  const markers = steps.map((step, index) => {
    const [x, y] = project([step.location.lon, step.location.lat]);
    return `<g data-step="${escape(step.id)}" data-lat="${step.location.lat}" data-lon="${step.location.lon}" transform="translate(${number(x)} ${number(y)})"><circle r="12" fill="#a8301b" stroke="#fbf8f2" stroke-width="3"/><text y="3.5" text-anchor="middle" fill="#fffdf8" font-family="Arial,sans-serif" font-size="10" font-weight="bold">${index + 1}</text></g>`;
  }).join("\n");
  const walkingPath = route.walk ? `<path class="walk-path-halo" d="${path([route.walk.path.coordinates], false)}"/><path id="walking-path" d="${path([route.walk.path.coordinates], false)}"/>` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400" role="img" aria-labelledby="title desc">
<title id="title">${escape(route.title)}</title>
<desc id="desc">Карта по данным OpenStreetMap. Север сверху. Пешеходный путь от 2-го Кожевнического переулка, 12с10 до Дербеневской набережной, 7с22. Весь путь на западном берегу Москвы-реки.</desc>
<metadata>${escape(JSON.stringify({ attribution: map.attribution, license: map.license, retrieved_at: map.retrieved_at, bounds: map.bounds, projection: "Web Mercator", poi: { id: poi.id, location: poi.location } }))}</metadata>
<style>
  .park{fill:#e2e9dc;stroke:none}.water{fill:#a8cfca;stroke:none;fill-rule:evenodd}
  .building{fill:#e5dfd3;stroke:#d6cfc2;stroke-width:.35;fill-rule:evenodd}
  .rail{fill:none;stroke:#b6ad9f;stroke-width:.6}
  .road,.bridge{fill:none;stroke:#fffdf8;stroke-linecap:round;stroke-linejoin:round}
  .bridge{stroke:#71695d}
  .label,.street,.water-name{font-family:Arial,sans-serif;font-size:12px;fill:#403b34;paint-order:stroke;stroke:#f5f1e8;stroke-width:3px;stroke-linejoin:round}
  .street{font-size:10px}.water-name{font-size:12px;font-style:italic;fill:#255c59;stroke:#a8cfca}
  .landmark{fill:#57504a;stroke:#f5f1e8;stroke-width:2}
  .poi-label{font-family:Georgia,serif;font-size:14px;font-weight:bold;fill:#8e2818;paint-order:stroke;stroke:#f5f1e8;stroke-width:4px;stroke-linejoin:round}
  .walk-path-halo,#walking-path{fill:none;stroke-linecap:round;stroke-linejoin:round}.walk-path-halo{stroke:#fffdf8;stroke-width:7}#walking-path{stroke:#a8301b;stroke-width:3}
</style>
<rect width="400" height="400" fill="#f5f1e8"/>
${geometry}
${walkingPath}
${label([37.6465, 55.7263], ["2-й Кожевнический пер."], { angle: -10, className: "street", anchor: "start" })}
${label([37.6499, 55.7240], ["Дербеневская ул."], { angle: -72, dx: 10, className: "street" })}
${label([37.6580, 55.7244], ["Москва-река"], { angle: 77, dx: -17, className: "water-name" })}
${landmarks}
${markers}
${label([steps[0].location.lon, steps[0].location.lat], ["Старт · 12с10"], { dy: -22, className: "poi-label" })}
${label([steps.at(-1).location.lon, steps.at(-1).location.lat], ["Финиш · 7с22"], { dy: 29, className: "poi-label" })}
<g transform="translate(377 17)" fill="#57504a" font-family="Arial,sans-serif" font-size="11" text-anchor="middle"><text>С</text><path d="M0 7V25M-4 12L0 7L4 12" fill="none" stroke="#57504a" stroke-width="1.5"/></g>
<g transform="translate(17 374)"><rect x="-6" y="-14" width="${number(metersToPixels(200) + 12)}" height="30" fill="#f5f1e8" fill-opacity=".92"/><path d="M0 0V5H${number(metersToPixels(200))}V0" fill="none" stroke="#57504a" stroke-width="1.5"/><text x="0" y="-4" font-family="Arial,sans-serif" font-size="10" fill="#57504a">200 м</text></g>
</svg>\n`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const map = JSON.parse(await readFile(new URL("../public/data/maps/paveletskaya.json", import.meta.url), "utf8"));
  const route = JSON.parse(await readFile(new URL("../public/data/routes/paveletskaya.json", import.meta.url), "utf8"));
  await writeFile(new URL("../public/data/maps/paveletskaya.svg", import.meta.url), renderMap(map, route));
  console.log(`Map: ${map.features.length} OSM features; walking path and markers from route data`);
}
