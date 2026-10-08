import type { ReviewSummary } from "../reviews/model";
import { localeTag, type Locale } from "@/lib/i18n/locale";
import { translate } from "@/lib/i18n/translate";

/** One entry of the public «Топ прогулок»: no launch counts and no author by design. */
export type TopWalk = {
  kind: "catalog" | "shared";
  /** Catalog slug or share token. */
  id: string;
  title: string;
  walkingMinutes: number;
  distanceM: number;
  stopCount: number;
  rating: ReviewSummary;
  preview: Array<[number, number]> | null;
  startMetro: MetroStation | null;
  endMetro: MetroStation | null;
};

export type MetroStation = { name: string; distanceM: number };

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
export function validateWalkCard(item: Record<string, unknown>): Pick<TopWalk, "title" | "walkingMinutes" | "distanceM" | "stopCount" | "rating"> {
  if (typeof item.title !== "string" || !item.title.trim()) throw new TypeError("Нет названия прогулки.");
  if (!Number.isSafeInteger(item.stopCount) || (item.stopCount as number) < 0) throw new TypeError("Неверное число историй.");
  const rating = record(item.rating);
  if (!Number.isSafeInteger(rating.count) || (rating.count as number) < 0) throw new TypeError("Неверное число оценок.");
  const count = rating.count as number;
  if (count === 0 ? rating.average !== null : typeof rating.average !== "number" || rating.average < 1 || rating.average > 5) throw new TypeError("Неверная средняя оценка.");
  return {
    title: item.title,
    walkingMinutes: positive(item.walkingMinutes), distanceM: positive(item.distanceM), stopCount: item.stopCount as number,
    rating: { average: rating.average as number | null, count },
  };
}

function preview(value: unknown): TopWalk["preview"] {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value) || value.length < 2 || value.length > 80 || !value.every(point =>
    Array.isArray(point) && point.length === 2 && point.every(coordinate => typeof coordinate === "number" && Number.isFinite(coordinate) && coordinate >= 0 && coordinate <= 100))) throw new TypeError("Неверная схема маршрута.");
  return value as Array<[number, number]>;
}

function metro(value: unknown): MetroStation | null {
  if (value === undefined || value === null) return null;
  const station = record(value);
  if (typeof station.name !== "string" || !station.name.trim() || station.name.length > 100 || !Number.isSafeInteger(station.distanceM) || (station.distanceM as number) < 0 || (station.distanceM as number) > 1500) throw new TypeError("Неверная станция метро.");
  return { name: station.name, distanceM: station.distanceM as number };
}

function validateTopWalk(raw: unknown): TopWalk {
  const item = record(raw);
  if (item.kind !== "catalog" && item.kind !== "shared") throw new TypeError("Неверный вид прогулки.");
  const id = item.id;
  if (typeof id !== "string" || !(item.kind === "catalog" ? CATALOG_WALK_ID : WALK_UUID).test(id)) throw new TypeError("Неверный идентификатор прогулки.");
  return { kind: item.kind, id, ...validateWalkCard(item), preview: preview(item.preview), startMetro: metro(item.startMetro), endMetro: metro(item.endMetro) };
}

export function validateTopWalks(value: unknown): TopWalk[] {
  const walks = record(value).walks;
  if (!Array.isArray(walks)) throw new TypeError("Ожидался список прогулок.");
  return walks.map(validateTopWalk);
}

export function topWalkHref(walk: Pick<TopWalk, "kind" | "id">) {
  return walk.kind === "catalog" ? `/walk?catalog=${encodeURIComponent(walk.id)}` : `/walk?share=${encodeURIComponent(walk.id)}`;
}

export function filterTopWalks(walks: TopWalk[], start: string, end: string): TopWalk[] {
  return walks.filter(walk => (!start || walk.startMetro?.name === start) && (!end || walk.endMetro?.name === end));
}

const storyWords: Record<string, string> = { one: "история", few: "истории", many: "историй", other: "истории" };

export function storyCountLabel(count: number, locale: Locale = "ru") {
  if (locale === "en") return translate(locale, count === 1 ? "{count} история" : "{count} историй", { count });
  if (locale === "zh") return translate(locale, "{count} историй", { count });
  const word = storyWords[new Intl.PluralRules(localeTag[locale]).select(count)];
  return `${count} ${word}`;
}

/** «45 мин · 3,2 км · 6 историй». */
export function formatTopWalkMeta(walk: Pick<TopWalk, "walkingMinutes" | "distanceM" | "stopCount">, locale: Locale = "ru") {
  const km = (walk.distanceM / 1000).toLocaleString(localeTag[locale], { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return translate(locale, "{minutes} мин · {distance} км · {stories}", {
    minutes: Math.round(walk.walkingMinutes), distance: km, stories: storyCountLabel(walk.stopCount, locale),
  });
}
