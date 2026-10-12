// Shared, dependency-free wire contract for walk documents and public views.
import { cityAt, cityByName } from "./cities.mjs";
export const MAX_WALK_STOPS = 40;
const invalid = () => Object.assign(new Error("Некорректные данные прогулки."), { code: "BAD_REQUEST" });
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const fields = (value, allowed) => object(value) && Object.keys(value).every(key => allowed.includes(key));
const string = (value, limit, empty = false) => typeof value === "string" && value.length <= limit && (empty || value.trim().length > 0) && !/[\p{Cc}\p{Cf}<>]/u.test(value);
const uuid = value => typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
/** Coordinates a walk may use: inside a covered city (see cities.mjs). @param {unknown} lat @param {unknown} lon */
export const inWalkBounds = (lat, lon) => cityAt(lat, lon) !== null;
const point = value => fields(value, ["lat", "lon"]) && inWalkBounds(value.lat, value.lon);
const place = value => fields(value, ["address", "location"]) && string(value.address, 180) && point(value.location);
const reference = value => value === null || (fields(value, ["kind", "id"]) && ((value.kind === "job" && uuid(value.id)) || (value.kind === "osm" && /^osm:(node|way|relation):\d+$/.test(value.id)) || (value.kind === "catalog" && /^[a-z0-9][a-z0-9-]{0,127}$/.test(value.id))));
// placeId: the map catalog place at the stop, independent of its story; the walk shows that place's photo.
const stop = value => fields(value, ["id", "place", "storyRef", "placeId", "transition", "nextHint", "triggerLocation"]) && (uuid(value.id) || /^[a-z0-9][a-z0-9-]{0,127}$/.test(value.id)) && place(value.place) && reference(value.storyRef) && (value.placeId === undefined || (typeof value.placeId === "string" && /^osm:(node|way|relation):\d+$/.test(value.placeId))) && string(value.transition, 1200, true) && string(value.nextHint, 1200, true) && (value.triggerLocation === undefined || point(value.triggerLocation));
const geometry = value => Array.isArray(value) && value.length >= 2 && value.length <= 12000 && value.every(point);
export const MAX_ROUTE_TUNNELS = 500;
/**
 * Covered stretches of a route: every segment between vertices a..b of its geometry runs through a tunnel.
 * Absent is valid; producers merge touching ranges, so pairs are sorted and separated by at least one segment.
 * @param {unknown} value
 * @param {number} geometryLength
 */
export function validTunnels(value, geometryLength) {
  if (value === undefined) return true;
  if (!Array.isArray(value) || value.length > MAX_ROUTE_TUNNELS) return false;
  let previous = -1;
  for (const pair of value) {
    if (!Array.isArray(pair) || pair.length !== 2) return false;
    const [a, b] = pair;
    if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b) || a <= previous || a < 0 || b <= a || b > geometryLength - 1) return false;
    previous = b;
  }
  return true;
}
const route = value => value === null || (fields(value, ["geometry", "distanceM", "walkingMinutes", "attribution", "tunnels"]) && geometry(value.geometry) && validTunnels(value.tunnels, value.geometry.length) && Number.isFinite(value.distanceM) && value.distanceM > 0 && value.distanceM <= 8100 && Number.isFinite(value.walkingMinutes) && value.walkingMinutes > 0 && value.walkingMinutes <= 90 && string(value.attribution, 2000));
const storyUrl = value => typeof value === "string" && value.length <= 2000 && /^https:\/\/[^\s<>]+$/i.test(value);
const story = value => value === null || (fields(value, ["title", "address", "paragraphs", "sources", "facts", "checkedAt"]) && string(value.title, 180) && string(value.address, 180) &&
  Array.isArray(value.paragraphs) && value.paragraphs.length > 0 && value.paragraphs.length <= 100 && value.paragraphs.every(item => fields(item, ["text", "factIds"]) && string(item.text, 6000) && Array.isArray(item.factIds) && item.factIds.length <= 100 && item.factIds.every(id => string(id, 128))) &&
  Array.isArray(value.sources) && value.sources.length <= 100 && value.sources.every(item => fields(item, ["id", "title", "url", "publisher"]) && string(item.id, 128) && string(item.title, 500) && storyUrl(item.url) && string(item.publisher, 500, true)) &&
  Array.isArray(value.facts) && value.facts.length <= 100 && value.facts.every(item => fields(item, ["id", "claim", "sourceIds"]) && string(item.id, 128) && string(item.claim, 2000) && Array.isArray(item.sourceIds) && item.sourceIds.length <= 100 && item.sourceIds.every(id => string(id, 128))) &&
  (value.checkedAt === undefined || (typeof value.checkedAt === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.checkedAt))));
const locales = new Set(["ru", "en", "zh"]);
const audio = value => value === null || (fields(value, ["url", "sha256", "durationSec", "language"]) && typeof value.url === "string" && /^\/(?:audio\/walk\/[a-zA-Z0-9-]+\.mp3|api\/story-audio\/[a-f0-9]{64}\.mp3)$/.test(value.url) && typeof value.sha256 === "string" && /^[a-f0-9]{64}$/.test(value.sha256) && Number.isFinite(value.durationSec) && value.durationSec > 0 && value.durationSec <= 7200 && (value.language === undefined || locales.has(value.language)));
const fallbackReasons = new Set(["missing", "draft", "stale"]);
const localization = value => value === null || fields(value, ["requestedLocale", "contentLocale", "fallbackReason"]) && locales.has(value.requestedLocale) && locales.has(value.contentLocale)
  && (value.fallbackReason === null || fallbackReasons.has(value.fallbackReason))
  && (value.requestedLocale === value.contentLocale ? value.fallbackReason === null : value.contentLocale === "ru" && value.fallbackReason !== null);

/** @typedef {{lat:number,lon:number}} Coordinates */
/** @typedef {{address:string,location:Coordinates}} WalkPlace */
/** @typedef {{version:2,id:string,title:string,description:string,city:string,mode:'open'|'loop',minutes:number,start:WalkPlace|null,stops:Array<{id:string,place:WalkPlace,storyRef:null|{kind:'job'|'osm'|'catalog',id:string},placeId?:string,transition:string,nextHint:string,triggerLocation?:Coordinates}>,route:null|{geometry:Coordinates[],distanceM:number,walkingMinutes:number,attribution:string,tunnels?:Array<[number,number]>},fieldChecked:boolean}} WalkDocument */
/** @typedef {{document:WalkDocument,sourceDocument?:WalkDocument,documentLocalization?:null|{requestedLocale:'ru'|'en'|'zh',contentLocale:'ru'|'en'|'zh',fallbackReason:null|'missing'|'draft'|'stale'},revision:number,contentVersion:string,requestedLocale?:'ru'|'en'|'zh',chapters:Array<{id:string,status:string,story:object|null,audio:object|null,localization?:null|{requestedLocale:'ru'|'en'|'zh',contentLocale:'ru'|'en'|'zh',fallbackReason:null|'missing'|'draft'|'stale'}}>}} WalkView */

export function validateWalkDocument(value) {
  if (!fields(value, ["version", "id", "title", "description", "city", "mode", "minutes", "start", "destination", "stops", "route", "fieldChecked"]) || value.version !== 2 || !(uuid(value.id) || /^[a-z0-9][a-z0-9-]{0,127}$/.test(value.id)) || !string(value.title, 120) || !string(value.description, 1000, true) || cityByName(value.city) === null || !["open", "loop"].includes(value.mode) || ![15, 30, 60, 90].includes(value.minutes) || !(value.start === null || place(value.start)) || (value.destination != null && (value.mode !== "open" || !place(value.destination))) || !Array.isArray(value.stops) || value.stops.length > MAX_WALK_STOPS || !value.stops.every(stop) || (value.start === null && value.stops.length !== 0) || new Set(value.stops.map(item => item.id)).size !== value.stops.length || !route(value.route) || (value.route !== null && (value.start === null || (value.stops.length === 0 && !value.destination))) || typeof value.fieldChecked !== "boolean" || JSON.stringify(value).length > 100000 || !inOneCity(value)) throw invalid();
  return value;
}

// Every coordinate of a walk lies in the city it names: a route never leaves its city.
function inOneCity(value) {
  const city = cityByName(value.city);
  const points = [value.start?.location, value.destination?.location, ...value.stops.flatMap(item => [item.place.location, item.triggerLocation]), ...(value.route?.geometry ?? [])];
  return points.every(item => item === undefined || cityAt(item.lat, item.lon) === city);
}

// The stable UUID is assigned by the owner of the local/account record. Neither
// legacy job IDs nor the address label alone identify a route stop.
export function migrateLegacyDraft(value, walkId) {
  if (!object(value) || value.version !== 1 || !uuid(walkId) || !(value.start === null || place(value.start)) || !Array.isArray(value.stops) || value.stops.length > MAX_WALK_STOPS || !value.stops.every(place) || (value.start === null && value.stops.length !== 0) || !["open", "loop"].includes(value.mode) || ![30, 60, 90].includes(value.minutes) || !Array.isArray(value.jobs) || value.jobs.length > 100) throw invalid();
  const hash = (index) => {
    // A UUIDv5-shaped deterministic ID; migration is stable across retries.
    // The input is already bounded by validateWalkDocument below.
    let seed = 2166136261;
    for (const letter of `${walkId}:${index}`) seed = Math.imul(seed ^ letter.charCodeAt(0), 16777619);
    const part = (seed >>> 0).toString(16).padStart(8, "0");
    return `${part}-${walkId.slice(9, 13)}-5${walkId.slice(15, 18)}-8${walkId.slice(20, 23)}-${walkId.slice(24)}`;
  };
  const link = selected => {
    const job = value.jobs.find(item => item?.place?.address === selected.address && item?.place?.location?.lat === selected.location.lat && item?.place?.location?.lon === selected.location.lon && uuid(item.id));
    return job ? { kind: "job", id: job.id } : null;
  };
  const locations = value.start ? [value.start, ...value.stops] : [];
  const includeStart = Boolean(value.start && link(value.start));
  const stops = (includeStart ? locations : value.stops).map((item, index) => ({ id: hash(index), place: item, storyRef: link(item), transition: "", nextHint: "" }));
  const savedRoute = value.route;
  const converted = { version: 2, id: walkId, title: value.title || "Моя прогулка", description: "", city: (value.start ? cityAt(value.start.location.lat, value.start.location.lon) : null)?.name ?? "Москва", mode: value.mode, minutes: value.minutes, start: value.start, ...(value.destination ? {destination:value.destination} : {}), stops,
    route: savedRoute ? { geometry: savedRoute.geometry, distanceM: savedRoute.distanceM, walkingMinutes: savedRoute.walkingMinutes, attribution: savedRoute.attribution, ...(savedRoute.tunnels === undefined ? {} : { tunnels: savedRoute.tunnels }) } : null,
    fieldChecked: false };
  return validateWalkDocument(converted);
}

const statuses = new Set(["not_requested", "preparing", "text_ready", "ready", "failed", "review_required", "insufficient_evidence", "unavailable"]);
const canonical = value => Array.isArray(value) ? value.map(canonical)
  : object(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const immutableDocument = value => canonical({ ...value, title: "", description: "", stops: value.stops.map(item => ({ ...item, transition: "", nextHint: "" })) });
export function validateWalkView(value) {
  const document = validateWalkDocument(value?.document);
  const sourceDocument = value?.sourceDocument === undefined ? undefined : validateWalkDocument(value.sourceDocument);
  const requestedLocale = value?.requestedLocale ?? "ru";
  if (!fields(value, ["document", "sourceDocument", "documentLocalization", "revision", "contentVersion", "requestedLocale", "chapters"]) || !locales.has(requestedLocale) || !Number.isSafeInteger(value.revision) || value.revision < 0 || !string(value.contentVersion, 120)
      || value.documentLocalization !== undefined && value.documentLocalization !== null && (!localization(value.documentLocalization) || value.documentLocalization.requestedLocale !== requestedLocale)
      || sourceDocument !== undefined && (requestedLocale === "ru" || !value.documentLocalization || value.documentLocalization.contentLocale !== requestedLocale || value.documentLocalization.fallbackReason !== null
        || JSON.stringify(immutableDocument(sourceDocument)) !== JSON.stringify(immutableDocument(document)) || JSON.stringify(sourceDocument) === JSON.stringify(document))
      || !Array.isArray(value.chapters) || value.chapters.length !== document.stops.length || value.chapters.some((item, index) => {
    if (!fields(item, ["id", "status", "story", "audio", "localization"]) || item.id !== document.stops[index].id || !statuses.has(item.status) || !story(item.story) || !audio(item.audio) || (item.audio !== null && item.story === null)) return true;
    if (requestedLocale !== "ru" && (!item.localization || !localization(item.localization) || item.localization.requestedLocale !== requestedLocale)) return true;
    if (item.localization != null && (!localization(item.localization) || item.localization.requestedLocale !== requestedLocale)) return true;
    const contentLocale = item.localization?.contentLocale ?? "ru";
    return item.audio !== null && (item.audio.language ?? "ru") !== contentLocale;
  }) || JSON.stringify(value).length > (sourceDocument ? 300000 : 200000)) throw invalid();
  return value;
}
