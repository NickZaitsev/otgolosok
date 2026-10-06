import { computeWalkEntry } from "../../../backend/walk-entry.mjs";
import type { Coordinates } from "../tour/types";
import type { LocalWalkItem } from "./local-store";
import type { WalkDocument } from "./model";
import { CATALOG_WALK_ID, record, validateWalkCard, WALK_UUID, type TopWalk } from "./top-model";

/** Must match NEARBY_RADIUS_M in backend/walk-nearby.mjs. */
export const NEARBY_RADIUS_M = 500;
/** Must match NEARBY_LIMIT in backend/walk-nearby.mjs. */
export const NEARBY_LIMIT = 5;

/**
 * A walk that passes near the chosen point. `own` is the user's account walk, `local` a walk
 * saved in this browser; both are the user's own («Ваша»). New responses describe the remaining
 * route from `entryStopId`; fields omitted by an older backend remain valid.
 */
export type NearbyWalk = Omit<TopWalk, "kind"> & {
  kind: "catalog" | "shared" | "own" | "local";
  startDistanceM: number;
  entryStopId?: string;
  audioMinutes?: number;
  audioComplete?: boolean;
  /** Address where an open walk ends; null for a loop back to the start. */
  finish: string | null;
};
/** The walk open in the builder, which is never suggested to itself. */
export type EditingWalk = { kind: "account" | "local"; id: string };

const ACCOUNT_ID = new RegExp(WALK_UUID.source, "i");
const SERVER_ID = { catalog: CATALOG_WALK_ID, shared: WALK_UUID, own: ACCOUNT_ID } as const;

function validateNearbyWalk(raw: unknown): NearbyWalk {
  const item = record(raw);
  // `local` walks exist only in this browser, so the server never sends them.
  if (item.kind !== "catalog" && item.kind !== "shared" && item.kind !== "own") throw new TypeError("Неверный вид прогулки.");
  const id = item.id;
  if (typeof id !== "string" || !SERVER_ID[item.kind].test(id)) throw new TypeError("Неверный идентификатор прогулки.");
  if (!Number.isSafeInteger(item.startDistanceM) || (item.startDistanceM as number) < 0) throw new TypeError("Неверное расстояние до старта.");
  const finish = item.finish;
  if (finish !== null && (typeof finish !== "string" || !finish.trim() || finish.length > 180)) throw new TypeError("Неверный адрес финиша.");
  const entryStopId = item.entryStopId;
  if (entryStopId !== undefined && (typeof entryStopId !== "string" || !(ACCOUNT_ID.test(entryStopId) || CATALOG_WALK_ID.test(entryStopId)))) {
    throw new TypeError("Неверная точка начала прогулки.");
  }
  const audioMinutes = item.audioMinutes;
  if (audioMinutes !== undefined && (!Number.isSafeInteger(audioMinutes) || (audioMinutes as number) < 0)) throw new TypeError("Неверная длительность озвучки.");
  const audioComplete = item.audioComplete;
  if (audioComplete !== undefined && typeof audioComplete !== "boolean") throw new TypeError("Неверный статус озвучки.");
  if ((audioMinutes === undefined) !== (audioComplete === undefined)) throw new TypeError("Неполные данные об озвучке.");
  return {
    kind: item.kind, id, ...validateWalkCard(item), startDistanceM: item.startDistanceM as number, finish,
    ...(entryStopId === undefined ? {} : { entryStopId }),
    ...(audioMinutes === undefined ? {} : { audioMinutes: audioMinutes as number }),
    ...(audioComplete === undefined ? {} : { audioComplete }),
  };
}

export function validateNearbyWalks(value: unknown): NearbyWalk[] {
  const walks = record(value).walks;
  if (!Array.isArray(walks)) throw new TypeError("Ожидался список прогулок.");
  return walks.map(validateNearbyWalk);
}

const HREF_PARAM = { catalog: "catalog", shared: "share", own: "id", local: "local" } as const;

export function nearbyWalkHref(walk: Pick<NearbyWalk, "kind" | "id" | "entryStopId">) {
  const href = `/walk?${HREF_PARAM[walk.kind]}=${encodeURIComponent(walk.id)}`;
  return walk.entryStopId ? `${href}&fromStop=${encodeURIComponent(walk.entryStopId)}` : href;
}

export const isOwnNearbyWalk = (walk: Pick<NearbyWalk, "kind">) => walk.kind === "own" || walk.kind === "local";

/** Where an open walk ends, as on the walk page: the chosen destination, else the last stop; null for a loop. */
export function walkFinish(document: Pick<WalkDocument, "mode" | "destination" | "stops">): string | null {
  if (document.mode === "loop") return null;
  return (document.destination ?? document.stops.at(-1)?.place)?.address ?? null;
}

/** «до Садовническая улица, 5»: the stored address without the city; «по кругу, обратно к старту» for a loop. */
export function formatFinish(finish: string | null) {
  return finish === null ? "по кругу, обратно к старту" : `до ${finish.replace(/^Москва,\s*/, "")}`;
}

/**
 * Distance to the walk's start, rounded to 50 m: from the chosen start («старт в 350 м», «старт рядом»)
 * or from the user («в 350 м от вас», «рядом с вами»).
 */
export function formatStartDistance(meters: number, origin: "start" | "you" = "start") {
  const rounded = (Math.round(meters / 50) * 50).toLocaleString("ru-RU");
  if (origin === "you") return meters < 50 ? "рядом с вами" : `в ${rounded} м от вас`;
  return meters < 50 ? "старт рядом" : `старт в ${rounded} м`;
}

const pointPlural = new Intl.PluralRules("ru");
const pointWords: Record<string, string> = { one: "точка", few: "точки", many: "точек", other: "точки" };

/** The only details needed before starting a nearby walk: remaining route, points and narration. */
export function formatNearbyWalkMeta(walk: Pick<NearbyWalk, "distanceM" | "stopCount" | "audioMinutes" | "audioComplete">) {
  const km = (walk.distanceM / 1000).toLocaleString("ru-RU", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const points = `${walk.stopCount} ${pointWords[pointPlural.select(walk.stopCount)]}`;
  let audio = "нет данных об озвучке";
  if (walk.audioMinutes !== undefined) {
    if (walk.audioMinutes === 0) audio = "Озвучка пока не готова";
    else audio = walk.audioComplete === false ? `${walk.audioMinutes} мин готовой озвучки` : `${walk.audioMinutes} мин озвучки`;
  }
  return `Осталось ${km} км · ${points} · ${audio}`;
}

/** Built walks of this browser that pass within the radius, newest first. */
export function localNearbyWalks(items: LocalWalkItem[], start: Coordinates, exclude: string | null): NearbyWalk[] {
  return items.flatMap(({ document, updatedAt }) => {
    if (document.id === exclude) return [];
    const entry = computeWalkEntry(document, start, NEARBY_RADIUS_M);
    if (!entry) return [];
    return [{ updatedAt: updatedAt ?? "", walk: { kind: "local" as const, id: document.id, title: document.title,
      walkingMinutes: entry.walkingMinutes, distanceM: entry.distanceM, stopCount: entry.stopCount,
      rating: { average: null, count: 0 }, startDistanceM: entry.startDistanceM, entryStopId: entry.entryStopId, finish: walkFinish(document) } }];
  }).sort((a, b) => a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0).map(item => item.walk);
}

/** Server suggestions first, without the walk being edited; local walks fill the slots left. */
export function mergeNearby(server: NearbyWalk[], local: NearbyWalk[], exclude: EditingWalk | null, limit = NEARBY_LIMIT): NearbyWalk[] {
  const shown = server.filter(walk => !(exclude?.kind === "account" && walk.kind === "own" && walk.id.toLowerCase() === exclude.id.toLowerCase()));
  return [...shown, ...local].slice(0, limit);
}
