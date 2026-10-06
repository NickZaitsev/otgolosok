import { distanceMeters } from "@/lib/geo/distance";
import type { Coordinates } from "../tour/types";
import type { LocalWalkItem } from "./local-store";
import { CATALOG_WALK_ID, record, validateWalkCard, WALK_UUID, type TopWalk } from "./top-model";

/** Must match NEARBY_RADIUS_M in backend/walk-nearby.mjs. */
export const NEARBY_RADIUS_M = 500;
/** Must match NEARBY_LIMIT in backend/walk-nearby.mjs. */
export const NEARBY_LIMIT = 5;

/**
 * A walk that starts near the draft's start. `own` is the user's account walk, `local` a walk
 * saved in this browser; both are the user's own («Ваша»). Only the rounded start distance is
 * known for other people's walks.
 */
export type NearbyWalk = Omit<TopWalk, "kind"> & { kind: "catalog" | "shared" | "own" | "local"; startDistanceM: number };
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
  return { kind: item.kind, id, ...validateWalkCard(item), startDistanceM: item.startDistanceM as number };
}

export function validateNearbyWalks(value: unknown): NearbyWalk[] {
  const walks = record(value).walks;
  if (!Array.isArray(walks)) throw new TypeError("Ожидался список прогулок.");
  return walks.map(validateNearbyWalk);
}

const HREF_PARAM = { catalog: "catalog", shared: "share", own: "id", local: "local" } as const;

export function nearbyWalkHref(walk: Pick<NearbyWalk, "kind" | "id">) {
  return `/walk?${HREF_PARAM[walk.kind]}=${encodeURIComponent(walk.id)}`;
}

export const isOwnNearbyWalk = (walk: Pick<NearbyWalk, "kind">) => walk.kind === "own" || walk.kind === "local";

/** «старт рядом» below 50 m, otherwise «старт в 350 м» rounded to 50 m. */
export function formatStartDistance(meters: number) {
  if (meters < 50) return "старт рядом";
  return `старт в ${(Math.round(meters / 50) * 50).toLocaleString("ru-RU")} м`;
}

/** Built walks of this browser that start within the radius, newest first. */
export function localNearbyWalks(items: LocalWalkItem[], start: Coordinates, exclude: string | null): NearbyWalk[] {
  return items.flatMap(({ document, updatedAt }) => {
    const location = document.start?.location;
    if (!document.route || !location || document.id === exclude) return [];
    const distance = distanceMeters(start, location);
    if (!(distance <= NEARBY_RADIUS_M)) return [];
    return [{ updatedAt: updatedAt ?? "", walk: { kind: "local" as const, id: document.id, title: document.title,
      walkingMinutes: document.route.walkingMinutes, distanceM: document.route.distanceM, stopCount: document.stops.length,
      rating: { average: null, count: 0 }, startDistanceM: Math.round(distance) } }];
  }).sort((a, b) => a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0).map(item => item.walk);
}

/** Server suggestions first, without the walk being edited; local walks fill the slots left. */
export function mergeNearby(server: NearbyWalk[], local: NearbyWalk[], exclude: EditingWalk | null, limit = NEARBY_LIMIT): NearbyWalk[] {
  const shown = server.filter(walk => !(exclude?.kind === "account" && walk.kind === "own" && walk.id.toLowerCase() === exclude.id.toLowerCase()));
  return [...shown, ...local].slice(0, limit);
}
