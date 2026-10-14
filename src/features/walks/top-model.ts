import type { ReviewSummary } from "../reviews/model";
import { localeTag, type Locale } from "@/lib/i18n/locale";
import { translate } from "@/lib/i18n/translate";

export type MetroLine = { id: string; name: string; color: string };
export type MetroStation = { name: string; distanceM: number; lines: MetroLine[] };
/**
 * A metro filter option: the filter value (a station name or a zone such as {@link INSIDE_CIRCLE}) with its lines.
 * A zone shows `label` instead of the value and `hint` under it.
 */
export type MetroOption = { name: string; lines: MetroLine[]; insideCircle?: boolean; label?: string; hint?: string };
/** Filter value for every station on or inside the Circle line; station names never start with «@». */
export const INSIDE_CIRCLE = "@circle";
export const CIRCLE_LINE: MetroLine = { id: "5", name: "Кольцевая", color: "#915133" };
export type MapPreview = {
  zoom: number;
  tiles: Array<{ x: number; y: number; left: number; top: number }>;
  points: Array<[number, number]>;
};
export type TopDuration = "" | "up-to-30" | "31-to-60" | "61-to-90";
export type TopFilters = { start: string; end: string; duration: TopDuration };

/** White or black metro letter chosen for WCAG text contrast on the line color. */
export function metroTextColor(hex: string) {
  const channels = [1, 3, 5].map(position => parseInt(hex.slice(position, position + 2), 16) / 255)
    .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  const luminance = channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  return luminance > 0.179 ? "#000000" : "#ffffff";
}

/** One public walk. Rank belongs to the unfiltered top. */
export type TopWalk = {
  kind: "catalog" | "shared";
  id: string;
  title: string;
  travelMode?: "driving";
  totalMinutes?: number;
  walkingMinutes: number;
  distanceM: number;
  stopCount: number;
  rating: ReviewSummary;
  rank: number;
  preview: Array<[number, number]> | null;
  mapPreview: MapPreview | null;
  startMetro: MetroStation | null;
  endMetro: MetroStation | null;
};
export type TopWalkPage = {
  walks: TopWalk[];
  total: number;
  nextOffset: number | null;
  filters: { starts: string[]; ends: string[]; stations: MetroOption[] };
};

export const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Ожидался объект.");
  return value as Record<string, unknown>;
};
const positive = (value: unknown) => {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) throw new TypeError("Ожидалось положительное число.");
  return value;
};
export const CATALOG_WALK_ID = /^[a-z0-9][a-z0-9-]{0,127}$/;
export const WALK_UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

/** Fields every walk card shares; the caller validates kind and id. */
export function validateWalkCard(item: Record<string, unknown>): Pick<TopWalk, "title" | "walkingMinutes" | "distanceM" | "stopCount" | "rating" | "travelMode" | "totalMinutes"> {
  if (typeof item.title !== "string" || !item.title.trim()) throw new TypeError("Нет названия прогулки.");
  if (!Number.isSafeInteger(item.stopCount) || (item.stopCount as number) < 0) throw new TypeError("Неверное число историй.");
  if (item.travelMode !== undefined && item.travelMode !== "driving") throw new TypeError("Неверный режим поездки.");
  if (item.travelMode === "driving") positive(item.totalMinutes);
  const rating = record(item.rating);
  if (!Number.isSafeInteger(rating.count) || (rating.count as number) < 0) throw new TypeError("Неверное число оценок.");
  const count = rating.count as number;
  if (count === 0 ? rating.average !== null : typeof rating.average !== "number" || rating.average < 1 || rating.average > 5) throw new TypeError("Неверная средняя оценка.");
  return {
    ...(item.travelMode === "driving" ? {travelMode: "driving" as const, totalMinutes: positive(item.totalMinutes)} : {}),
    title: item.title,
    walkingMinutes: positive(item.walkingMinutes), distanceM: positive(item.distanceM), stopCount: item.stopCount as number,
    rating: { average: rating.average as number | null, count },
  };
}

function points(value: unknown, max: number): Array<[number, number]> {
  if (!Array.isArray(value) || value.length < 2 || value.length > 80 || !value.every(point =>
    Array.isArray(point) && point.length === 2 && point.every(coordinate => typeof coordinate === "number" && Number.isFinite(coordinate) && coordinate >= 0 && coordinate <= max))) throw new TypeError("Неверная схема маршрута.");
  return value as Array<[number, number]>;
}

function mapPreview(value: unknown): MapPreview | null {
  if (value === undefined || value === null) return null;
  const map = record(value);
  if (!Number.isSafeInteger(map.zoom) || (map.zoom as number) < 0 || (map.zoom as number) > 16 || !Array.isArray(map.tiles) || map.tiles.length < 1 || map.tiles.length > 4)
    throw new TypeError("Неверная карта маршрута.");
  const zoom = map.zoom as number, maximumTile = 2 ** zoom;
  const tiles = map.tiles.map(raw => {
    const tile = record(raw);
    if (!["x", "y", "left", "top"].every(key => typeof tile[key] === "number" && Number.isFinite(tile[key]))
      || !Number.isSafeInteger(tile.x) || !Number.isSafeInteger(tile.y) || (tile.x as number) < 0 || (tile.x as number) >= maximumTile
      || (tile.y as number) < 0 || (tile.y as number) >= maximumTile || Math.abs(tile.left as number) > 256 || Math.abs(tile.top as number) > 256)
      throw new TypeError("Неверная карта маршрута.");
    return { x: tile.x as number, y: tile.y as number, left: tile.left as number, top: tile.top as number };
  });
  return { zoom, tiles, points: points(map.points, 256) };
}

const stationName = (value: unknown) => typeof value === "string" && Boolean(value.trim()) && value.length <= 100;

function metroLines(value: unknown = []): MetroLine[] {
  if (!Array.isArray(value) || value.length > 8) throw new TypeError("Неверные линии метро.");
  return value.map(raw => {
    const line = record(raw);
    if (typeof line.id !== "string" || !/^\d{1,3}$/.test(line.id) || typeof line.name !== "string" || !line.name.trim()
      || line.name.length > 100 || typeof line.color !== "string" || !/^#[0-9a-fA-F]{6}$/.test(line.color)) throw new TypeError("Неверная линия метро.");
    return { id: line.id, name: line.name, color: line.color };
  });
}

function metro(value: unknown): MetroStation | null {
  if (value === undefined || value === null) return null;
  const station = record(value);
  if (!stationName(station.name) || !Number.isSafeInteger(station.distanceM)
    || (station.distanceM as number) < 0 || (station.distanceM as number) > 1500) throw new TypeError("Неверная станция метро.");
  return { name: station.name as string, distanceM: station.distanceM as number, lines: metroLines(station.lines) };
}

function validateTopWalk(raw: unknown, index: number): TopWalk {
  const item = record(raw);
  if (item.kind !== "catalog" && item.kind !== "shared") throw new TypeError("Неверный вид прогулки.");
  const id = item.id;
  if (typeof id !== "string" || !(item.kind === "catalog" ? CATALOG_WALK_ID : WALK_UUID).test(id)) throw new TypeError("Неверный идентификатор прогулки.");
  const rank = item.rank ?? index + 1;
  if (!Number.isSafeInteger(rank) || (rank as number) < 1) throw new TypeError("Неверное место в топе.");
  return { kind: item.kind, id, ...validateWalkCard(item), rank: rank as number,
    preview: item.preview === undefined || item.preview === null ? null : points(item.preview, 100), mapPreview: mapPreview(item.mapPreview),
    startMetro: metro(item.startMetro), endMetro: metro(item.endMetro) };
}

export function validateTopWalks(value: unknown): TopWalk[] {
  const walks = record(value).walks;
  if (!Array.isArray(walks) || walks.length > 20) throw new TypeError("Ожидался список из 20 прогулок.");
  return walks.map(validateTopWalk);
}

function stationOptions(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 1000 || !value.every(stationName)) throw new TypeError("Неверный список станций.");
  return value as string[];
}

/** Line colors of the filter options; a server without them yields bare names. */
function stationLines(value: unknown, walks: TopWalk[]): MetroOption[] {
  if (value === undefined) {
    const known = new Map(walks.flatMap(walk => [walk.startMetro, walk.endMetro]).flatMap(station => station ? [[station.name, station.lines] as const] : []));
    return [...known].map(([name, lines]) => ({ name, lines, insideCircle: false }));
  }
  if (!Array.isArray(value) || value.length > 2000) throw new TypeError("Неверный список станций.");
  return value.map(raw => {
    const station = record(raw);
    if (!stationName(station.name) || station.insideCircle !== undefined && typeof station.insideCircle !== "boolean") throw new TypeError("Неверный список станций.");
    return { name: station.name as string, lines: metroLines(station.lines), insideCircle: station.insideCircle === true };
  });
}

export function validateTopWalkPage(value: unknown): TopWalkPage {
  const page = record(value), walks = validateTopWalks(value);
  const total = page.total ?? walks.length, nextOffset = page.nextOffset ?? null;
  if (!Number.isSafeInteger(total) || (total as number) < walks.length || (total as number) > 1_000_000
    || nextOffset !== null && (!Number.isSafeInteger(nextOffset) || (nextOffset as number) < 1 || (nextOffset as number) > (total as number)))
    throw new TypeError("Неверная страница прогулок.");
  const filters = page.filters === undefined ? { starts: [...new Set(walks.flatMap(walk => walk.startMetro ? [walk.startMetro.name] : []))],
    ends: [...new Set(walks.flatMap(walk => walk.endMetro ? [walk.endMetro.name] : []))] } : record(page.filters);
  return { walks, total: total as number, nextOffset: nextOffset as number | null,
    filters: { starts: stationOptions(filters.starts), ends: stationOptions(filters.ends), stations: stationLines(filters.stations, walks) } };
}

export function topWalkHref(walk: Pick<TopWalk, "kind" | "id">) {
  return walk.kind === "catalog" ? `/walk?catalog=${encodeURIComponent(walk.id)}` : `/walk?share=${encodeURIComponent(walk.id)}`;
}

/** The top of one city; Moscow, the server's default, is not named, so older cached URLs stay valid. */
export function topWalksUrl(offset: number, filters: TopFilters, city = "moscow"): string {
  const params = new URLSearchParams();
  if (city !== "moscow") params.set("city", city);
  if (offset) params.set("offset", String(offset));
  if (filters.start) params.set("start", filters.start);
  if (filters.end) params.set("end", filters.end);
  if (filters.duration) params.set("duration", filters.duration);
  return `/api/top-walks${params.size ? `?${params}` : ""}`;
}

export function filterTopWalks(walks: TopWalk[], start: string, end: string, duration: TopDuration = ""): TopWalk[] {
  return walks.filter(walk => (!start || walk.startMetro?.name === start) && (!end || walk.endMetro?.name === end)
    && (!duration || duration === "up-to-30" && (walk.totalMinutes ?? walk.walkingMinutes) <= 30
      || duration === "31-to-60" && (walk.totalMinutes ?? walk.walkingMinutes) > 30 && (walk.totalMinutes ?? walk.walkingMinutes) <= 60
      || duration === "61-to-90" && (walk.totalMinutes ?? walk.walkingMinutes) > 60 && (walk.totalMinutes ?? walk.walkingMinutes) <= 90));
}

const storyWords: Record<string, string> = { one: "история", few: "истории", many: "историй", other: "истории" };

export function storyCountLabel(count: number, locale: Locale = "ru") {
  if (locale === "en") return translate(locale, count === 1 ? "{count} история" : "{count} историй", { count });
  if (locale === "zh") return translate(locale, "{count} историй", { count });
  const word = storyWords[new Intl.PluralRules(localeTag[locale]).select(count)];
  return `${count} ${word}`;
}

/** «45 мин · 3,2 км · 6 историй». */
export function formatTopWalkMeta(walk: Pick<TopWalk, "walkingMinutes" | "distanceM" | "stopCount" | "travelMode" | "totalMinutes">, locale: Locale = "ru") {
  const km = (walk.distanceM / 1000).toLocaleString(localeTag[locale], { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return translate(locale, walk.travelMode === "driving" ? "На машине · {minutes} мин · {distance} км · {stories}" : "{minutes} мин · {distance} км · {stories}", {
    minutes: Math.round(walk.totalMinutes ?? walk.walkingMinutes), distance: km, stories: storyCountLabel(walk.stopCount, locale),
  });
}

const searchKey = (text: string) => text.toLocaleLowerCase("ru").replaceAll("ё", "е").replace(/\s+/g, " ").trim();

/** Stations whose name or line matches the query, ignoring case and ё; name prefixes come first. */
export function searchMetroOptions(options: MetroOption[], query: string): MetroOption[] {
  const key = searchKey(query);
  if (!key) return options;
  const scored = options.flatMap(option => {
    const name = searchKey(option.label ?? option.name);
    const score = name.startsWith(key) ? 0 : name.split(/[\s-]/).some(word => word.startsWith(key)) ? 1 : name.includes(key) ? 2
      : option.lines.some(line => searchKey(line.name).includes(key)) || option.hint && searchKey(option.hint).includes(key) ? 3 : -1;
    return score < 0 ? [] : [{ option, score }];
  });
  return scored.sort((a, b) => a.score - b.score).map(item => item.option);
}
