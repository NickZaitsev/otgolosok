import {readFile, writeFile} from "node:fs/promises";
import {resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {createProjection} from "../../scripts/build-map.mjs";

/**
 * Данные ролика «Прогулка по центру»: подложка карты, пешеходный путь и остановки.
 *
 * Остановки — опубликованные истории otgolosok.online: названия, текст, источники
 * и озвучка в ролике те же, что услышит слушатель. `label` — только короткая
 * подпись для экрана. Путь ищется по пешеходному графу OSM (Дейкстра), а не
 * рисуется от руки.
 *
 * Запуск: node scripts/build-centre-walk-video.mjs [overpass.json ...]
 * Без аргументов выгрузка OSM скачивается из OVERPASS_URL (по умолчанию overpass-api.de).
 */

export const SITE = "https://otgolosok.online";

export const CENTRE_STOPS = [
  {id: "osm:relation:7314898", label: "Храм Христа Спасителя"},
  {id: "osm:relation:2421978", label: "Пушкинский музей"},
  {id: "osm:relation:5969167", label: "Дом Пашкова"},
  {id: "osm:relation:3062892", label: "Манеж"},
  {id: "osm:relation:5963922", label: "Исторический музей"},
  {id: "osm:relation:3330565", label: "ГУМ"},
  {id: "osm:relation:3030568", label: "Собор Василия Блаженного"},
  {id: "osm:relation:19077852", label: "Палаты бояр Романовых"},
];

// Квадрат ~2,3 × 2,3 км вокруг Красной площади и Волхонки.
export const CENTRE_BOUNDS = [37.599, 55.7404, 37.635, 55.7607];
const SIZE = 1000;

const QUERY = `[out:json][timeout:120];(
way["highway"~"^(primary|secondary|tertiary|pedestrian|residential|unclassified|living_street|footway|path|steps|service)$"](55.738,37.590,55.768,37.640);
relation["natural"="water"](55.73,37.58,55.77,37.65);
relation["building"](55.738,37.590,55.768,37.640);
way["natural"="water"](55.73,37.58,55.77,37.65);
way["leisure"~"park|garden"](55.738,37.590,55.768,37.640);
way["building"](55.738,37.590,55.768,37.640);
way["barrier"="city_wall"](55.738,37.590,55.768,37.640);
);out geom;`;

const WALKABLE = /^(primary|secondary|tertiary|pedestrian|residential|unclassified|living_street|footway|path|steps|service)$/;
const MAJOR = /^(primary|secondary|tertiary)$/;

function haversine(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371008.8 * Math.asin(Math.sqrt(h));
}

/** Пешеходный граф: узлы OSM и рёбра вдоль доступных дорог и тротуаров. */
export function walkGraph(elements) {
  const nodes = new Map();
  const edges = new Map();
  // К остановке подходим с улицы или тротуара, а не из внутреннего двора.
  const entrances = new Set();
  const link = (from, to, meters) => {
    if (!edges.has(from)) edges.set(from, []);
    edges.get(from).push([to, meters]);
  };
  for (const way of elements) {
    const tags = way.tags ?? {};
    if (way.type !== "way" || !WALKABLE.test(tags.highway ?? "") || ["private", "no"].includes(tags.access) || tags.foot === "no") continue;
    const street = Boolean(tags.name) || tags.footway === "sidewalk" || tags.highway === "pedestrian";
    way.nodes.forEach((id, index) => {
      nodes.set(id, way.geometry[index]);
      if (street) entrances.add(id);
      if (index === 0) return;
      const previous = way.nodes[index - 1];
      const meters = haversine(way.geometry[index - 1], way.geometry[index]);
      link(previous, id, meters);
      link(id, previous, meters);
    });
  }
  return {nodes, edges, entrances};
}

/**
 * Убирает петли и заходы «туда и обратно» на стыках участков: если путь
 * возвращается в пройденную точку, всё между двумя визитами вырезается.
 */
export function dropLoops(points) {
  const result = [];
  const seen = new Map();
  for (const point of points) {
    const key = `${point.lat},${point.lon}`;
    if (seen.has(key)) {
      const index = seen.get(key);
      for (const dropped of result.splice(index + 1)) seen.delete(`${dropped.lat},${dropped.lon}`);
      continue;
    }
    seen.set(key, result.length);
    result.push(point);
  }
  return result;
}

function nearestNode({nodes, edges, entrances}, point) {
  let best = {id: null, meters: Infinity};
  for (const [id, location] of nodes) {
    if (!edges.has(id) || !entrances.has(id)) continue;
    const meters = haversine(point, location);
    if (meters < best.meters) best = {id, meters};
  }
  if (best.meters > 150) throw new Error(`Нет пешеходного пути ближе 150 м к ${point.lat},${point.lon}`);
  return best.id;
}

/** Кратчайший путь между узлами графа; возвращает точки и длину в метрах. */
export function shortestWalk(graph, from, to) {
  const distance = new Map([[from, 0]]);
  const previous = new Map();
  const done = new Set();
  // Граф небольшой, поэтому хватает простой очереди с выбором минимума.
  const queue = new Map([[from, 0]]);
  while (queue.size) {
    let current = null;
    let currentDistance = Infinity;
    for (const [id, value] of queue) if (value < currentDistance) [current, currentDistance] = [id, value];
    queue.delete(current);
    if (current === to) break;
    done.add(current);
    for (const [next, meters] of graph.edges.get(current) ?? []) {
      if (done.has(next)) continue;
      const candidate = currentDistance + meters;
      if (candidate < (distance.get(next) ?? Infinity)) {
        distance.set(next, candidate);
        previous.set(next, current);
        queue.set(next, candidate);
      }
    }
  }
  if (!distance.has(to)) throw new Error("Остановки не связаны пешеходным графом OSM");
  const path = [to];
  while (path[0] !== from) path.unshift(previous.get(path[0]));
  return {points: path.map((id) => graph.nodes.get(id)), meters: distance.get(to)};
}

/** Склеивает части мультиполигона в замкнутые кольца по совпадающим концам. */
function rings(parts) {
  const open = parts.map((part) => [...part]);
  const closed = [];
  const same = (a, b) => a.lat === b.lat && a.lon === b.lon;
  while (open.length) {
    const ring = open.shift();
    let grown = true;
    while (!same(ring[0], ring.at(-1)) && grown) {
      grown = false;
      for (let index = 0; index < open.length; index += 1) {
        const part = open[index];
        if (same(ring.at(-1), part[0])) ring.push(...part.slice(1));
        else if (same(ring.at(-1), part.at(-1))) ring.push(...part.slice(0, -1).reverse());
        else continue;
        open.splice(index, 1);
        grown = true;
        break;
      }
    }
    if (same(ring[0], ring.at(-1))) closed.push(ring);
  }
  return closed;
}

/** Опубликованная история остановки в том виде, в каком её покажет ролик. */
export function publishedStop(places, {id, label}) {
  const place = places.find((item) => item.id === id);
  if (!place || place.archived || place.textStatus !== "approved") throw new Error(`История ${id} («${label}») не опубликована`);
  const paragraph = place.story?.paragraphs?.[0]?.text;
  if (!paragraph || !place.story.sources?.length) throw new Error(`У истории «${label}» нет текста или источников`);
  return {
    id,
    label,
    name: place.name,
    address: place.story.address ?? place.address,
    location: place.location,
    title: place.story.title,
    paragraph,
    sources: place.story.sources.map(({title, publisher, url}) => ({title, publisher, url})),
    audio: place.audio ? {url: new URL(place.audio.url, SITE).href, durationSec: place.audio.durationSec} : null,
  };
}

export function buildCentreWalk(overpass, places) {
  const {project, metersToPixels} = createProjection(CENTRE_BOUNDS, SIZE);
  const xy = ({lat, lon}) => project([lon, lat]).map((value) => Number(value.toFixed(1)));
  const [west, south, east, north] = CENTRE_BOUNDS;
  const pad = 0.004;
  const visible = (points) => points.some(({lat, lon}) => lon > west - pad && lon < east + pad && lat > south - pad && lat < north + pad);
  const d = (lines, close) => lines.filter(visible).map((line) => line.map((point, index) => `${index ? "L" : "M"}${xy(point).join(",")}`).join("") + (close ? "Z" : "")).join("");

  const elements = overpass.elements;
  const ways = (test) => elements.filter((element) => element.type === "way" && test(element.tags ?? {})).map((way) => way.geometry);
  const water = [
    ...ways((tags) => tags.natural === "water"),
    ...elements.filter((element) => element.type === "relation" && element.tags?.natural === "water")
      .flatMap((relation) => rings(relation.members.filter((member) => member.type === "way" && member.role === "outer" && member.geometry).map((member) => member.geometry))),
  ];
  const layers = {
    water: d(water, true),
    park: d(ways((tags) => /^(park|garden)$/.test(tags.leisure ?? "")), true),
    building: d([
      ...ways((tags) => Boolean(tags.building)),
      ...elements.filter((element) => element.type === "relation" && element.tags?.building)
        .flatMap((relation) => rings(relation.members.filter((member) => member.type === "way" && member.role === "outer" && member.geometry).map((member) => member.geometry))),
    ], true),
    minor: d(ways((tags) => WALKABLE.test(tags.highway ?? "") && !MAJOR.test(tags.highway) && !["footway", "path", "steps", "service"].includes(tags.highway)), false),
    major: d(ways((tags) => MAJOR.test(tags.highway ?? "")), false),
    wall: d(ways((tags) => tags.barrier === "city_wall"), false),
  };

  const graph = walkGraph(elements);
  const stops = CENTRE_STOPS.map((stop) => {
    const published = publishedStop(places, stop);
    return {...published, node: nearestNode(graph, published.location)};
  });

  const walk = [];
  const legs = [];
  stops.slice(1).forEach((stop, index) => {
    const leg = shortestWalk(graph, stops[index].node, stop.node);
    legs.push(Math.round(leg.meters));
    walk.push(...(index ? leg.points.slice(1) : leg.points));
  });
  const path = dropLoops(walk);
  const onPath = path.map(xy);
  // Метка стоит на пути — в его точке, ближайшей к подходу к зданию.
  const marker = ({x, y}) => onPath.reduce((best, point) => Math.hypot(point[0] - x, point[1] - y) < Math.hypot(best[0] - x, best[1] - y) ? point : best);

  return {
    source: "© OpenStreetMap contributors, ODbL",
    osmBase: overpass.osm3s?.timestamp_osm_base ?? null,
    bounds: CENTRE_BOUNDS,
    size: SIZE,
    metersPerPixel: Number((1 / metersToPixels(1)).toFixed(3)),
    // Длина — по пути без заходов «туда и обратно».
    distanceM: Math.round(path.slice(1).reduce((sum, point, index) => sum + haversine(path[index], point), 0)),
    legsM: legs,
    stops: stops.map(({node, ...stop}) => {
      const [x, y] = marker(Object.fromEntries(["x", "y"].map((key, index) => [key, xy(graph.nodes.get(node))[index]])));
      return {...stop, x, y};
    }),
    path: path.map((point, index) => `${index ? "L" : "M"}${xy(point).join(",")}`).join(""),
    layers,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const inputs = process.argv.slice(2);
  const dumps = await Promise.all(inputs.map(async (input) => JSON.parse(await readFile(input, "utf8"))));
  const overpass = dumps.length
    ? {elements: dumps.flatMap(({elements}) => elements), osm3s: dumps[0].osm3s}
    : await fetch(process.env.OVERPASS_URL ?? "https://overpass-api.de/api/interpreter", {
      method: "POST",
      headers: {"content-type": "application/x-www-form-urlencoded", "user-agent": "otgolosok-video"},
      body: new URLSearchParams({data: QUERY}),
    }).then((response) => {
      if (!response.ok) throw new Error(`Overpass ответил ${response.status}`);
      return response.json();
    });
  const places = [];
  for (let offset = 0; ; offset += 100) {
    const response = await fetch(`${SITE}/api/content/places?limit=100&offset=${offset}&status=ready&lat=55.7500&lon=37.6150&radius=1500`, {headers: {"user-agent": "otgolosok-video"}});
    if (!response.ok) throw new Error(`${SITE} ответил ${response.status}`);
    const page = await response.json();
    places.push(...page.places);
    if (!page.hasMore) break;
  }
  const walk = {fetchedAt: new Date().toISOString().slice(0, 10), ...buildCentreWalk(overpass, places)};
  await writeFile(new URL("../src/centre-walk.json", import.meta.url), `${JSON.stringify(walk)}\n`);
  console.log(`Centre walk: ${walk.stops.length} stops, ${walk.distanceM} m (${walk.legsM.join(" + ")}), OSM base ${walk.osmBase}`);
}
