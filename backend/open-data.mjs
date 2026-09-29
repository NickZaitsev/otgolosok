import { comparable } from "./domain.mjs";
import { withRetry } from "./retry.mjs";

// Moscow open data (data.mos.ru) as an extra source for places the web search cannot identify.
// The generation pipeline never calls the portal: an offline import stores matched records locally.

export const OPEN_DATA_PORTAL = Object.freeze({ name: "Портал открытых данных Правительства Москвы", url: "https://data.mos.ru" });
export const OPEN_DATA_DATASETS = Object.freeze({
  2801: Object.freeze({ kind: "plaque", title: "Мемориальные доски города Москвы" }),
  60869: Object.freeze({ kind: "sculpture", title: "Перечень скульптур под открытым небом, расположенных на территории учреждений, подведомственных Департаменту культуры города Москвы" }),
  530: Object.freeze({ kind: "heritage", title: "Объекты культурного наследия" }),
});
export const OPEN_DATA_API = "https://apidata.mos.ru/v1";
export const PLAQUE_RADIUS_M = 80;
export const SCULPTURE_RADIUS_M = 1500;
// A heritage record carries the object's outline: a plaque on a listed wall or a monument in a listed park sits on
// or next to it, while the next building along the street is usually farther.
export const HERITAGE_RADIUS_M = 25;

const EMPTY = /^(?:не\s+установлен[аоы]?|нет\s+данных|отсутству\S*|[-—–])$/iu;
const PLAQUE_NOISE = /^(?:мемориальн|памятн|доска|доск)/u;
const SCULPTURE_PREFIX = /^(?:скульптурная композиция|скульптура|композиция|памятник|монумент|бюст)\s+/u;
const HERITAGE_NOISE = /^(?:мемориальн|памятн|доска|доск|памятник)/u;
const AUTHOR_MARK = /(?<![а-я])(?:арх|ск|скульп|скульпт|скульптор|скульпторы|архитектор|архитекторы|арх-ры|инж|инженер|инженеры|худ|художник|художники)(?:[.:]|\s)/u;
const PAGE = 500;

const clean = value => {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value !== "string") return "";
  const trimmed = value.replace(/\s+/g, " ").trim();
  return EMPTY.test(trimmed) ? "" : trimmed;
};
const key = value => comparable(value).replace(/["'`]/g, "").replace(/\s+/g, " ").trim();
const words = value => key(value).split(/[\s,.:;!?()—–-]+/u).filter(Boolean);
const stem = token => token.slice(0, Math.max(4, token.length - 3));

/** Great-circle distance in metres. */
export function distanceMeters(a, b) {
  const rad = value => value * Math.PI / 180, dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  return 2 * 6371000 * Math.asin(Math.sqrt(Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2));
}

/** Outline rings and points of a GeoJSON geometry, as [lon, lat] pairs. */
function shape(geometry) {
  if (!geometry) return { rings: [], points: [] };
  if (geometry.type === "Point") return { rings: [], points: [geometry.coordinates] };
  if (geometry.type === "Polygon") return { rings: geometry.coordinates, points: [] };
  if (geometry.type === "MultiPolygon") return { rings: geometry.coordinates.flat(), points: [] };
  if (geometry.type === "GeometryCollection") {
    const parts = (geometry.geometries ?? []).map(shape);
    return { rings: parts.flatMap(part => part.rings), points: parts.flatMap(part => part.points) };
  }
  return { rings: [], points: [] };
}
const inMoscow = ({ lat, lon }) => Number.isFinite(lat) && Number.isFinite(lon) && lat > 55 && lat < 56.2 && lon > 36.7 && lon < 38.3;

/** Distance in metres from a point to an outline: 0 inside a ring. Local flat projection, fine at tens of metres. */
export function distanceToShape(location, { rings, points }) {
  const kx = 111320 * Math.cos(location.lat * Math.PI / 180), ky = 111320;
  const xy = ([lon, lat]) => [(lon - location.lon) * kx, (lat - location.lat) * ky];
  let best = Infinity;
  for (const ring of rings) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = xy(ring[i]), [xj, yj] = xy(ring[j]);
      if ((yi > 0) !== (yj > 0) && 0 < (xj - xi) * (0 - yi) / (yj - yi) + xi) inside = !inside;
      const dx = xj - xi, dy = yj - yi, t = dx || dy ? Math.max(0, Math.min(1, -(xi * dx + yi * dy) / (dx * dx + dy * dy))) : 0;
      best = Math.min(best, Math.hypot(xi + t * dx, yi + t * dy));
    }
    if (inside) return 0;
  }
  for (const item of points) best = Math.min(best, Math.hypot(...xy(item)));
  return best;
}

function point(feature, cells) {
  const coordinates = feature?.geometry?.type === "Point" ? feature.geometry.coordinates : null;
  const [lon, lat] = Array.isArray(coordinates) ? coordinates : [Number(cells.Longitude_WGS84), Number(cells.Latitude_WGS84)];
  return Number.isFinite(lat) && Number.isFinite(lon) && lat > 55 && lat < 56.2 && lon > 36.7 && lon < 38.3 ? { lat, lon } : null;
}

/**
 * One portal row with its GeoJSON feature → a record with only meaningful fields.
 * Placeholders such as «не установлен» are dropped: they are not facts.
 */
export function normalizeOpenDataRecord(datasetId, row, feature = null) {
  const dataset = OPEN_DATA_DATASETS[datasetId];
  if (!dataset || !row?.Cells || row.global_id == null) return null;
  const cells = row.Cells, fields = {};
  for (const [name, value] of Object.entries(cells)) {
    if (["Photo", "global_id", "geoData", "geodata_center", "Longitude_WGS84", "Latitude_WGS84", "ID", "AISID"].includes(name)) continue;
    if (name === "Authors" && Array.isArray(value)) {
      const authors = value.map(item => ({ name: clean(item?.AuthorsName), profession: clean(item?.Profession) })).filter(item => item.name);
      if (authors.length) fields.Authors = authors;
    } else if (clean(value)) fields[name] = clean(value);
  }
  if (dataset.kind === "heritage") {
    const name = fields.ObjectName || fields.ObjectNameOnDoc, outline = shape(feature?.geometry);
    const vertices = [...outline.rings.flat(), ...outline.points];
    const center = vertices.length ? { lon: vertices.reduce((sum, item) => sum + item[0], 0) / vertices.length, lat: vertices.reduce((sum, item) => sum + item[1], 0) / vertices.length } : null;
    if (!name) return null;
    // The outline is only for matching: matchOpenData drops it, so the stored record stays small.
    return { datasetId: Number(datasetId), recordId: String(row.global_id), kind: dataset.kind, name, location: center && inMoscow(center) ? center : null, fields, outline };
  }
  const name = dataset.kind === "plaque" ? fields.Name : fields.SculpName;
  if (!name) return null;
  return { datasetId: Number(datasetId), recordId: String(row.global_id), kind: dataset.kind, name, location: point(feature, cells), fields };
}

// Letters of the given name and patronymic that follow the surname: «Клечковскому Всеволоду Маврикиевичу» and «Астахову Д.В.».
function lettersAfter(text, surnameStem) {
  // Lower-casing and ё→е keep string length, so the index is valid in the original text.
  const at = text.toLocaleLowerCase("ru").replace(/ё/g, "е").search(new RegExp(`(?<![а-яa-z])${surnameStem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "u"));
  if (at < 0) return [];
  const rest = text.slice(at).replace(/^[^\s.,]+/u, "").split(/[,;(]/u)[0];
  return [...rest.matchAll(/(?<![А-Яа-яЁё])[А-ЯЁ]/gu)].map(match => match[0]);
}

/** A plaque names the place when every significant name word is on the plaque and OSM initials agree with it. */
export function plaqueNamesPlace(record, place) {
  const tokens = words(place.name).filter(token => token.length >= 4 && !PLAQUE_NOISE.test(token));
  if (!tokens.length) return false;
  const text = key(`${record.fields.Name ?? ""} ${record.fields.Text ?? ""}`);
  if (!tokens.every(token => text.includes(stem(token)))) return false;
  const initials = [...place.name.matchAll(/(?<![А-Яа-яЁё])([А-ЯЁ])\./gu)].map(match => match[1]);
  if (!initials.length) return true;
  const letters = lettersAfter(record.fields.Name ?? "", stem(tokens[0]));
  // Nothing to compare (a plaque to several people or without the given name): the surname decides.
  if (letters.length < initials.length) return true;
  return initials.every((letter, index) => letter === letters[index]);
}

/**
 * A heritage record names the place by its own title (not the ensemble's): every significant word of the OSM name
 * starts a word of the title. A one-word name without initials must open the title or stand in quotes, since «Охотник»
 * also starts «охотничье хозяйство». Initials must be in the title, before the surname («Бюст М.И.Авербаха») or as the
 * given name and patronymic after it («Могила Доватора Льва Михайловича»); without them the match is refused.
 */
export function heritageNamesPlace(record, place) {
  const tokens = words(place.name).filter(token => token.length >= 3 && !HERITAGE_NOISE.test(token) && !/^[а-яё]$/u.test(token));
  if (!tokens.length) return false;
  const titles = [record.fields.ObjectName, record.fields.ObjectNameOnDoc].filter(Boolean);
  const titleWords = titles.flatMap(words);
  if (!tokens.every(token => titleWords.some(word => word.startsWith(stem(token))))) return false;
  const initials = [...place.name.matchAll(/(?<![А-Яа-яЁё])([А-ЯЁ])\./gu)].map(match => match[1]);
  if (tokens.length === 1 && !initials.length) {
    const [token] = tokens;
    const opens = titles.some(title => words(title)[0]?.startsWith(stem(token)));
    const quoted = titles.some(title => [...comparable(title).matchAll(/"([^"]+)"/gu)].some(match => words(match[1])[0]?.startsWith(stem(token))));
    if (!opens && !quoted) return false;
  }
  if (!initials.length) return true;
  const surname = stem(tokens.at(-1));
  return titles.some(title => {
    const lower = title.toLocaleLowerCase("ru").replace(/ё/g, "е");
    // Authors follow the subject: «Надгробие Я.Н.Федоренко, 1949 г., ск. Е.В.Вучетич» is not Vuchetich's grave.
    const authors = lower.search(AUTHOR_MARK), subject = authors < 0 ? title : title.slice(0, authors);
    const compact = subject.toLocaleLowerCase("ru").replace(/ё/g, "е").replace(/\s+/gu, "");
    // «Театр им. Е.Б.Вахтангова» is a building named after the person, not a monument or a plaque to him.
    const named = `${initials.map(letter => `${letter.toLocaleLowerCase("ru")}\\.`).join("")}${surname}`;
    const before = new RegExp(`(?<!им\\.|имени)${named}`, "u").test(compact);
    const after = lettersAfter(subject, surname);
    return before || (after.length >= initials.length && initials.every((letter, index) => letter === after[index]));
  });
}

/** A sculpture names the place when titles match without quotes and generic prefixes such as «Памятник». */
export function sculptureNamesPlace(record, place) {
  const title = value => key(value).replace(SCULPTURE_PREFIX, "");
  return Boolean(title(place.name)) && title(place.name) === title(record.name);
}

/**
 * Matches portal records to catalog places. A record with several candidate places, or a place claimed by
 * several records, is ambiguous and left to an editor. Sculpture coordinates are coarse (median 313 m off
 * the OSM point in 2026), so sculptures match by title within a wide radius.
 * @param {ReturnType<typeof normalizeOpenDataRecord>[]} records
 * @param {{id: string, name: string, location: {lat: number, lon: number}, tags: Record<string, string>}[]} places
 */
export function matchOpenData(records, places) {
  const memorials = places.filter(place => place.tags?.historic === "memorial");
  const artworks = places.filter(place => place.tags?.tourism === "artwork" || place.tags?.historic === "memorial");
  const byPlace = new Map();
  let unmatched = 0, ambiguousRecords = 0;
  for (const record of records) {
    if (!record?.location) { unmatched++; continue; }
    const { outline, ...stored } = record;
    let candidates, rule;
    if (record.kind === "heritage") {
      // The outline's bounding box widened by the radius first: the exact distance walks every outline edge.
      const vertices = [...outline.rings.flat(), ...outline.points], lats = vertices.map(item => item[1]), lons = vertices.map(item => item[0]);
      const dLat = HERITAGE_RADIUS_M / 111320, dLon = dLat / Math.cos(record.location.lat * Math.PI / 180);
      const [south, north, west, east] = [Math.min(...lats) - dLat, Math.max(...lats) + dLat, Math.min(...lons) - dLon, Math.max(...lons) + dLon];
      candidates = places.filter(({ location: { lat, lon } }) => lat >= south && lat <= north && lon >= west && lon <= east)
        .map(place => ({ place, distanceM: distanceToShape(place.location, outline) }))
        .filter(item => item.distanceM <= HERITAGE_RADIUS_M && heritageNamesPlace(record, item.place));
      rule = "heritage-title-25m";
    } else {
      const plaque = record.kind === "plaque";
      const radius = plaque ? PLAQUE_RADIUS_M : SCULPTURE_RADIUS_M;
      candidates = (plaque ? memorials : artworks).map(place => ({ place, distanceM: distanceMeters(record.location, place.location) }))
        .filter(item => item.distanceM <= radius && (plaque ? plaqueNamesPlace(record, item.place) : sculptureNamesPlace(record, item.place)));
      rule = plaque ? "plaque-name-80m" : "sculpture-title-1500m";
    }
    if (!candidates.length) { unmatched++; continue; }
    if (candidates.length > 1) { ambiguousRecords++; continue; }
    const [{ place, distanceM }] = candidates;
    byPlace.set(place.id, [...(byPlace.get(place.id) ?? []), { placeId: place.id, record: stored, match: { rule, distanceM: Math.round(distanceM) } }]);
  }
  const matches = [], ambiguousPlaces = [];
  for (const [placeId, items] of byPlace) {
    if (items.length === 1) matches.push(items[0]);
    else ambiguousPlaces.push(placeId);
  }
  return { matches, unmatched, ambiguousRecords, ambiguousPlaces };
}

const sentence = value => /[.!?…»"]$/u.test(value) ? value : `${value}.`;

/** The record as a plain Russian source text: one field per sentence, so every fact has an exact quote. */
export function renderOpenDataSource(record) {
  const f = record.fields, parts = [];
  const add = (label, value) => { if (value) parts.push(sentence(label ? `${label}: ${value}` : value)); };
  if (record.kind === "plaque") {
    add("", f.Name);
    add("Надпись", f.Text ? `«${f.Text.replace(/^[«"]|[»"]$/gu, "")}»` : "");
    add("Место установки", f.Location);
    add("Описание места установки", f.LocationInfo);
    add("Дата установки", [f.InstallationDate, f.InstallationComment].filter(Boolean).join(", "));
    add("Вид доски", f.Form);
    add("Описание внешнего вида", f.Details);
    add("Материал изготовления", f.Material);
    add("Авторы", (f.Authors ?? []).map(item => item.profession ? `${item.name} (${item.profession})` : item.name).join(", "));
  } else if (record.kind === "heritage") {
    add("Наименование объекта культурного наследия по документам", f.ObjectNameOnDoc);
    add("Общепринятое наименование", f.ObjectName);
    add("Входит в ансамбль", f.EnsembleNameOnDoc || f.EnsembleName);
    add("Местоположение", f.Addresses);
    add("Вид объекта", f.ObjectType);
    add("Охранный статус", [f.SecurityStatus, f.Category].filter(Boolean).join(", "));
    add("Номер в едином государственном реестре объектов культурного наследия", f.USRCHONumber);
  } else {
    add("Наименование скульптуры", f.SculpName);
    add("Автор", f.Author);
    add("Год изготовления", f.ManufactYear);
    add("Материал изготовления", f.Material);
    add("Описание", f.Description);
    add("Месторасположение", f.LocationPlace);
  }
  return parts.join(" ");
}

/** A pipeline source with the attribution the portal licence requires (a link to the portal). */
export function openDataSource(item, id) {
  const dataset = OPEN_DATA_DATASETS[item.datasetId];
  return { id, url: `${OPEN_DATA_PORTAL.url}/opendata/${item.datasetId}`, title: `${OPEN_DATA_PORTAL.name}: ${dataset?.title ?? `набор ${item.datasetId}`}`,
    publisher: "data.mos.ru", text: renderOpenDataSource(item.record),
    openData: { datasetId: item.datasetId, recordId: item.record.recordId, datasetVersion: item.datasetVersion } };
}

/**
 * Downloads a dataset: metadata, rows and GeoJSON features (rows carry no geometry), paging by 500.
 * Transient failures are retried; 4xx fail at once. The key never appears in errors.
 * @param {number} datasetId
 * @param {{apiKey: string, fetchImpl?: typeof fetch, retry?: object}} options
 */
export async function fetchOpenDataset(datasetId, { apiKey, fetchImpl = fetch, retry = {} }) {
  if (!OPEN_DATA_DATASETS[datasetId]) throw new Error(`Unsupported dataset ${datasetId}`);
  if (!apiKey) throw new Error("DATA_MOS_API_KEY is not set");
  /** @param {string} path @returns {Promise<any>} */
  const get = path => withRetry(async () => {
    const url = `${OPEN_DATA_API}${path}${path.includes("?") ? "&" : "?"}api_key=${encodeURIComponent(apiKey)}`;
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(60000) });
    if (!response.ok) throw Object.assign(new Error(`data.mos.ru ${path.split("?")[0]} answered HTTP ${response.status}`), { status: response.status });
    return response.json();
  }, retry);
  const pages = async path => {
    const items = [];
    for (let skip = 0; ; skip += PAGE) {
      const page = await get(`${path}?$top=${PAGE}&$skip=${skip}`), list = Array.isArray(page) ? page : page?.features ?? [];
      items.push(...list);
      if (list.length < PAGE) return items;
    }
  };
  const meta = await get(`/datasets/${datasetId}`);
  const rows = await pages(`/datasets/${datasetId}/rows`), features = await pages(`/datasets/${datasetId}/features`);
  const featureById = new Map(features.map(feature => [String(feature?.properties?.attributes?.global_id), feature]));
  const records = rows.map(row => normalizeOpenDataRecord(datasetId, row, featureById.get(String(row.global_id)))).filter(Boolean);
  return { datasetId, caption: meta?.Caption ?? OPEN_DATA_DATASETS[datasetId].title, datasetVersion: `${meta?.VersionNumber ?? "?"} ${meta?.VersionDate ?? ""}`.trim(),
    itemsCount: Number(meta?.ItemsCount ?? rows.length), records };
}
