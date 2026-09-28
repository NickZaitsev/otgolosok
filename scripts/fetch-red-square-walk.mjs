// Данные рекламного ролика «Красная площадь и Варварка»: опубликованные истории
// otgolosok.online, пешеходный маршрут Valhalla и подложка карты из OpenStreetMap.
// Результат — video/red-square/walk.json; рендер работает только с ним, без сети.
//
//   node scripts/fetch-red-square-walk.mjs
import {writeFile} from "node:fs/promises";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT = join(root, "video/red-square/walk.json");
const SITE = "https://otgolosok.online";
const ROUTER = "https://valhalla1.openstreetmap.de/route";
const OVERPASS = "https://overpass-api.de/api/interpreter";
const USER_AGENT = "otgolosok-video/1.0 (+https://otgolosok.online)";

/** Остановки по порядку: id опубликованной истории и короткая подпись для карты. */
export const STOPS = Object.freeze([
  {id: "osm:node:583204619", label: "Нулевой километр"},
  {id: "osm:relation:5963922", label: "Исторический музей"},
  {id: "osm:relation:7624254", label: "Казанский собор"},
  {id: "osm:relation:3330565", label: "ГУМ"},
  {id: "osm:relation:3226496", label: "Лобное место"},
  {id: "osm:relation:3030568", label: "Собор Василия Блаженного"},
  {id: "osm:relation:19079948", label: "Храм Варвары"},
  {id: "osm:relation:19075670", label: "Старый Английский двор"},
  {id: "osm:relation:19077852", label: "Палаты бояр Романовых"},
  {id: "osm:relation:1555621", label: "Парк «Зарядье»"},
]);

/** Кадр карты: 1080×1350 px, запад–восток ≈ 1,3 км вокруг Красной площади и Варварки. */
export const VIEW = Object.freeze({width: 1080, height: 1350, west: 37.6135, east: 37.6345, centerLat: 55.7538});

const radians = (degrees) => (degrees * Math.PI) / 180;
const mercatorY = (lat) => Math.log(Math.tan(Math.PI / 4 + radians(lat) / 2));

/** Проекция Меркатора в пиксели кадра и обратно границы кадра в градусах. */
export function projection(view = VIEW) {
  const scale = view.width / radians(view.east - view.west);
  const centerY = mercatorY(view.centerLat);
  const project = (lon, lat) => [radians(lon - view.west) * scale, view.height / 2 - (mercatorY(lat) - centerY) * scale];
  const latAt = (y) => (2 * Math.atan(Math.exp(centerY + (view.height / 2 - y) / scale)) - Math.PI / 2) * 180 / Math.PI;
  const metersPerPixel = (6378137 * Math.cos(radians(view.centerLat))) / scale;
  return {project, bounds: {south: latAt(view.height), north: latAt(0), west: view.west, east: view.east}, metersPerPixel};
}

/**
 * Упрощение ломаной (Дуглас — Пекер) с допуском в пикселях.
 * @param {[number, number][]} points
 */
export function simplify(points, tolerance) {
  if (points.length < 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop();
    const [ax, ay] = points[first];
    const [bx, by] = points[last];
    const length = Math.hypot(bx - ax, by - ay);
    let worst = -1;
    let index = -1;
    for (let current = first + 1; current < last; current += 1) {
      const [px, py] = points[current];
      const distance = length === 0 ? Math.hypot(px - ax, py - ay) : Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / length;
      if (distance > worst) {
        worst = distance;
        index = current;
      }
    }
    if (worst > tolerance) {
      keep[index] = 1;
      stack.push([first, index], [index, last]);
    }
  }
  return points.filter((_, index) => keep[index]);
}

/** Декодирование polyline6 из ответа Valhalla в [lon, lat]. */
export function decodePolyline6(encoded) {
  const points = [];
  let index = 0;
  let lat = 0;
  let lon = 0;
  const next = () => {
    let result = 0;
    let shift = 0;
    let byte;
    do {
      if (index >= encoded.length) throw new Error("Оборванная polyline6");
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (index < encoded.length) {
    lat += next();
    lon += next();
    points.push([lon / 1e6, lat / 1e6]);
  }
  return points;
}

const round = (value) => Math.round(value * 10) / 10;
const pathData = (points, closed) => points.map(([x, y], index) => `${index ? "L" : "M"}${round(x)} ${round(y)}`).join("") + (closed ? "Z" : "");

function polygonArea(points) {
  let area = 0;
  points.forEach(([x, y], index) => {
    const [nx, ny] = points[(index + 1) % points.length];
    area += x * ny - nx * y;
  });
  return Math.abs(area) / 2;
}

/** Внешние кольца отношения-мультиполигона, склеенные из отдельных линий. */
function outerRings(relation) {
  const pieces = relation.members.filter((member) => member.type === "way" && member.role !== "inner" && member.geometry?.length).map((member) => member.geometry.map(({lon, lat}) => [lon, lat]));
  const rings = [];
  const same = (a, b) => a[0] === b[0] && a[1] === b[1];
  while (pieces.length) {
    let ring = pieces.shift();
    let grown = true;
    while (!same(ring[0], ring.at(-1)) && grown) {
      grown = false;
      for (let index = 0; index < pieces.length; index += 1) {
        const piece = pieces[index];
        if (same(ring.at(-1), piece[0])) ring = [...ring, ...piece.slice(1)];
        else if (same(ring.at(-1), piece.at(-1))) ring = [...ring, ...piece.slice(0, -1).reverse()];
        else continue;
        pieces.splice(index, 1);
        grown = true;
        break;
      }
    }
    rings.push(ring);
  }
  return rings;
}

/**
 * Слои подложки из ответа Overpass: здания по отдельности (для поочерёдного
 * появления), вода, парки, крупные и мелкие улицы, стены Кремля и Китай-города.
 */
export function mapLayers(elements, view = VIEW) {
  const {project} = projection(view);
  const toPixels = (ring) => ring.map(([lon, lat]) => project(lon, lat));
  const inside = (points) => points.some(([x, y]) => x > -200 && x < view.width + 200 && y > -200 && y < view.height + 200);
  const shapes = [];
  for (const element of elements) {
    const tags = element.tags ?? {};
    const rings = element.type === "relation" ? outerRings(element) : element.geometry ? [element.geometry.map(({lon, lat}) => [lon, lat])] : [];
    for (const ring of rings) {
      const points = toPixels(ring);
      if (points.length > 1 && inside(points)) shapes.push({tags, points, id: `${element.type}/${element.id}`});
    }
  }
  const kind = ({tags}) => {
    if (tags.building) return "building";
    if (tags.natural === "water" || tags.waterway === "riverbank") return "water";
    if (tags.leisure === "park" || tags.leisure === "garden") return "park";
    if (tags.barrier === "city_wall" || tags.historic === "citywalls") return "wall";
    if (["primary", "secondary", "tertiary"].includes(tags.highway)) return "major";
    if (tags.highway) return "minor";
    return null;
  };
  const group = (name) => shapes.filter((shape) => kind(shape) === name);
  const merged = (name, closed, tolerance) => group(name).map(({points}) => pathData(simplify(points, tolerance), closed)).join("");
  const buildings = group("building")
    .map(({points}) => ({points: simplify(points, 0.6), area: polygonArea(points)}))
    .filter(({points, area}) => points.length >= 3 && area >= 20)
    .map(({points, area}) => {
      const cx = points.reduce((sum, [x]) => sum + x, 0) / points.length;
      const cy = points.reduce((sum, [, y]) => sum + y, 0) / points.length;
      return {d: pathData(points, true), c: [round(cx), round(cy)], a: Math.round(area)};
    });
  return {water: merged("water", true, 1), parks: merged("park", true, 1), walls: merged("wall", false, 0.8), major: merged("major", false, 0.8), minor: merged("minor", false, 0.8), buildings};
}

/** Проверка ответа сайта: все остановки опубликованы, у каждой есть текст. */
export function pickStops(places) {
  return STOPS.map(({id, label}) => {
    const place = places.find((item) => item.id === id);
    if (!place) throw new Error(`История ${id} («${label}») не найдена среди опубликованных`);
    const paragraphs = place.story?.paragraphs?.map(({text}) => text).filter(Boolean) ?? [];
    if (paragraphs.length === 0) throw new Error(`У истории «${label}» нет текста`);
    return {id, label, name: place.name, lat: place.location.lat, lon: place.location.lon, title: place.story.title, paragraphs};
  });
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/** JSON-запрос с повторами на сетевых ошибках, 429 и 5xx: 1, 2, 4 с. */
async function fetchJson(url, init = {}, attempts = 4) {
  for (let attempt = 1; ; attempt += 1) {
    let retryable = true;
    try {
      const response = await fetch(url, {...init, headers: {"user-agent": USER_AGENT, accept: "application/json", ...init.headers}, signal: AbortSignal.timeout(90_000)});
      if (response.ok) return await response.json();
      retryable = response.status === 429 || response.status >= 500;
      throw new Error(`${new URL(url).host} ответил ${response.status}`);
    } catch (error) {
      if (!retryable || attempt >= attempts) throw error;
      await sleep(1000 * 2 ** (attempt - 1));
    }
  }
}

async function loadPlaces() {
  const places = [];
  for (let offset = 0; ; offset += 100) {
    const page = await fetchJson(`${SITE}/api/content/places?limit=100&offset=${offset}&status=ready&lat=55.7540&lon=37.6240&radius=1200`);
    places.push(...page.places);
    if (!page.hasMore) return places;
  }
}

async function main() {
  const places = await loadPlaces();
  const stops = pickStops(places);
  const trip = (await fetchJson(ROUTER, {
    method: "POST",
    headers: {"content-type": "application/json"},
    body: JSON.stringify({costing: "pedestrian", locations: stops.map(({lat, lon}) => ({lat, lon, type: "break"}))}),
  })).trip;
  const {project, bounds} = projection();
  const {south, west, north, east} = bounds;
  const box = `(${south.toFixed(5)},${west},${north.toFixed(5)},${east})`;
  const query = `[out:json][timeout:90];(way["building"]${box};relation["building"]${box};way["highway"~"^(primary|secondary|tertiary|pedestrian|residential|unclassified|living_street|footway)$"]${box};` +
    `way["natural"="water"]${box};relation["natural"="water"]${box};way["leisure"~"^(park|garden)$"]${box};relation["leisure"~"^(park|garden)$"]${box};way["historic"="citywalls"]${box};);out geom;`;
  const osm = await fetchJson(OVERPASS, {method: "POST", headers: {"content-type": "application/x-www-form-urlencoded"}, body: new URLSearchParams({data: query})});

  const route = simplify(trip.legs.flatMap((leg, index) => decodePolyline6(leg.shape).slice(index ? 1 : 0)).map(([lon, lat]) => project(lon, lat)), 0.7).map(([x, y]) => [round(x), round(y)]);
  const data = {
    title: "Красная площадь и Варварка",
    fetchedAt: new Date().toISOString().slice(0, 10),
    attribution: "Карта © участники OpenStreetMap · маршрут Valhalla · истории otgolosok.online",
    distanceM: Math.round(trip.summary.length * 1000),
    walkMin: Math.round(trip.summary.time / 60),
    view: {width: VIEW.width, height: VIEW.height},
    stops: stops.map((stop) => {
      const [x, y] = project(stop.lon, stop.lat);
      return {...stop, x: round(x), y: round(y)};
    }),
    route,
    layers: mapLayers(osm.elements),
  };
  await writeFile(OUTPUT, `${JSON.stringify(data)}\n`);
  console.log(`${OUTPUT}: ${data.stops.length} остановок, ${data.distanceM} м, ${data.walkMin} мин, зданий ${data.layers.buildings.length}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error("Не удалось собрать данные ролика:", error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
