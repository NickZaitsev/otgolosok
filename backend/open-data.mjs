import { comparable } from "./domain.mjs";
import { withRetry } from "./retry.mjs";

// Moscow open data (data.mos.ru) as an extra source for places the web search cannot identify.
// The generation pipeline never calls the portal: an offline import stores matched records locally.

export const OPEN_DATA_PORTAL = Object.freeze({ name: "Портал открытых данных Правительства Москвы", url: "https://data.mos.ru" });
export const OPEN_DATA_DATASETS = Object.freeze({
  2801: Object.freeze({ kind: "plaque", title: "Мемориальные доски города Москвы" }),
  60869: Object.freeze({ kind: "sculpture", title: "Перечень скульптур под открытым небом, расположенных на территории учреждений, подведомственных Департаменту культуры города Москвы" }),
});
export const OPEN_DATA_API = "https://apidata.mos.ru/v1";
export const PLAQUE_RADIUS_M = 80;
export const SCULPTURE_RADIUS_M = 1500;

const EMPTY = /^(?:не\s+установлен[аоы]?|нет\s+данных|отсутству\S*|[-—–])$/iu;
const PLAQUE_NOISE = /^(?:мемориальн|памятн|доска|доск)/u;
const SCULPTURE_PREFIX = /^(?:скульптурная композиция|скульптура|композиция|памятник|монумент|бюст)\s+/u;
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
    if (["Photo", "global_id", "geoData", "geodata_center", "Longitude_WGS84", "Latitude_WGS84", "ID"].includes(name)) continue;
    if (name === "Authors" && Array.isArray(value)) {
      const authors = value.map(item => ({ name: clean(item?.AuthorsName), profession: clean(item?.Profession) })).filter(item => item.name);
      if (authors.length) fields.Authors = authors;
    } else if (clean(value)) fields[name] = clean(value);
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
    const plaque = record.kind === "plaque";
    const radius = plaque ? PLAQUE_RADIUS_M : SCULPTURE_RADIUS_M;
    const candidates = (plaque ? memorials : artworks).map(place => ({ place, distanceM: distanceMeters(record.location, place.location) }))
      .filter(item => item.distanceM <= radius && (plaque ? plaqueNamesPlace(record, item.place) : sculptureNamesPlace(record, item.place)));
    if (!candidates.length) { unmatched++; continue; }
    if (candidates.length > 1) { ambiguousRecords++; continue; }
    const [{ place, distanceM }] = candidates;
    byPlace.set(place.id, [...(byPlace.get(place.id) ?? []), { placeId: place.id, record, match: { rule: plaque ? "plaque-name-80m" : "sculpture-title-1500m", distanceM: Math.round(distanceM) } }]);
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
