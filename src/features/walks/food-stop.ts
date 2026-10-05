import { distanceToRoute } from "../food/route-proximity";
import { formatFoodCategory } from "../food/food-kinds";
import type { FoodPlace } from "../food/types";
import { routeLegCuts } from "../tour/route-legs";
import { MAX_ROUTE_TUNNELS, MAX_WALK_STOPS, validTunnels } from "../../../backend/walk-document.mjs";
import { validateWalkDocument, validateWalkView, type Coordinates, type WalkDocument, type WalkView } from "./model";
import type { Plan } from "../walk-builder/model";

/** A food stop that cannot join the walk; the message is for the walker. */
export class FoodStopError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FoodStopError";
  }
}

/**
 * Where a venue joins the walk: before stop `position` of the document, replacing the
 * path between geometry vertices `range` with a way from `from` through the venue to `to`.
 */
export type FoodStopLeg = { position: number; range: [number, number]; from: Coordinates; to: Coordinates };

// The planner keeps every pair of points at least 5 m apart; a venue this close to the line needs no new way.
const ON_ROUTE_M = 5;
// The backend rejects a leg whose ends leave a gap; the joints of a spliced leg obey the same rule.
const MAX_JOINT_GAP_M = 10;
const ROUTE_POINT = "Точка маршрута";

function distanceM(a: Coordinates, b: Coordinates) {
  const scaleX = 111320 * Math.cos(((a.lat + b.lat) / 2) * Math.PI / 180);
  return Math.hypot((b.lon - a.lon) * scaleX, (b.lat - a.lat) * 111320);
}
const pathLength = (points: Coordinates[]) => points.slice(1).reduce((sum, point, i) => sum + distanceM(points[i], point), 0);
const sameSpot = (a: Coordinates, b: Coordinates) => a.lat === b.lat && a.lon === b.lon;

/** The stop of the document that is this venue, matched by its exact coordinates. */
export function hasFoodStop(document: WalkDocument, place: Pick<FoodPlace, "lat" | "lon">) {
  return document.stops.some(stop => sameSpot(stop.place.location, place));
}

/** The leg of the walk the venue lies by: the stops around it and the stretch of path between them. */
export function foodStopLeg(document: WalkDocument, place: Pick<FoodPlace, "lat" | "lon">): FoodStopLeg {
  const geometry = document.route?.geometry;
  if (!geometry || geometry.length < 2) throw new FoodStopError("У прогулки ещё нет маршрута.");
  if (hasFoodStop(document, place)) throw new FoodStopError("Заведение уже есть в прогулке.");
  if (document.stops.length >= MAX_WALK_STOPS) throw new FoodStopError(`В прогулке уже ${MAX_WALK_STOPS} остановок — больше добавить нельзя.`);
  const cuts = routeLegCuts(geometry, document.stops.map(stop => stop.triggerLocation ?? stop.place.location));
  // The venue projects onto the segment that starts at `vertex`; the leg owning that segment takes it.
  const { vertex } = distanceToRoute({ lat: place.lat, lon: place.lon }, geometry, { mode: document.mode });
  const position = cuts.filter(cut => cut <= vertex).length;
  const a = position === 0 ? 0 : cuts[position - 1];
  const b = position === cuts.length ? geometry.length - 1 : cuts[position];
  return { position, range: [a, b], from: geometry[a], to: geometry[b] };
}

/** The /api/walk-plan request for the way through the venue; null when the venue stands on the line itself. */
export function foodLegRequest(leg: FoodStopLeg, place: FoodPlace) {
  const venue = { lat: place.lat, lon: place.lon };
  if (distanceM(leg.from, venue) < ON_ROUTE_M || distanceM(leg.to, venue) < ON_ROUTE_M) return null;
  const stop = { address: foodStopTitle(place), location: venue };
  // Ends of a leg without length (a stop at the start, a finish at the last stop) make a small loop.
  const loop = distanceM(leg.from, leg.to) < ON_ROUTE_M;
  // The leg alone is short; the largest budget keeps the planner's duration check out of the way.
  return { start: { address: ROUTE_POINT, location: leg.from }, mode: loop ? "loop" as const : "open" as const, minutes: 90 as const, stops: [stop],
    ...(loop ? {} : { destination: { address: ROUTE_POINT, location: leg.to } }) };
}

/** The stop title: the venue's name, cleaned to what a walk document accepts. */
export function foodStopTitle(place: Pick<FoodPlace, "name" | "kind">) {
  const name = Array.from(place.name.replace(/[\p{Cc}\p{Cf}<>]/gu, " ").replace(/\s+/g, " ").trim());
  const title = name.length > 180 ? `${name.slice(0, 179).join("")}…` : name.join("");
  return title || formatFoodCategory(place.kind, null);
}

function spliceTunnels(old: Array<[number, number]> | undefined, leg: Array<[number, number]> | undefined, [a, b]: [number, number], legOffset: number, suffixStart: number) {
  const pieces: Array<[number, number]> = [];
  for (const [from, to] of old ?? []) {
    if (from < a && Math.min(to, a) > from) pieces.push([from, Math.min(to, a)]);
    if (to > b) {
      const start = suffixStart + Math.max(from, b) - b, end = suffixStart + to - b;
      if (end > start) pieces.push([start, end]);
    }
  }
  for (const [from, to] of leg ?? []) pieces.push([legOffset + from, legOffset + to]);
  pieces.sort((x, y) => x[0] - y[0]);
  const merged: Array<[number, number]> = [];
  for (const piece of pieces) {
    const last = merged.at(-1);
    if (last && piece[0] <= last[1]) last[1] = Math.max(last[1], piece[1]);
    else merged.push([...piece]);
  }
  return merged.length ? merged : undefined;
}

/**
 * The document with the venue as a stop without a story, its way spliced into the path in place of the
 * old leg. The rest of the path, its tunnels and every other stop stay as they were; the stop before the
 * venue loses its hint about the way on, which led past the venue to the next stop.
 */
export function insertFoodStop(document: WalkDocument, place: FoodPlace, leg: FoodStopLeg, plan: Plan | null, stopId: string): WalkDocument {
  const route = document.route;
  if (!route) throw new FoodStopError("У прогулки ещё нет маршрута.");
  let next = route;
  if (plan) {
    const old = route.geometry, [a, b] = leg.range, way = plan.geometry;
    const head = distanceM(old[a], way[0]), tail = distanceM(way.at(-1)!, old[b]);
    // Never draw an invented segment between the old path and the new way.
    if (head > MAX_JOINT_GAP_M || tail > MAX_JOINT_GAP_M) throw new FoodStopError("Не удалось соединить путь к заведению с маршрутом.");
    const prefix = old.slice(0, a + 1), body = head < 1 ? way.slice(1) : way, suffix = tail < 1 ? old.slice(b + 1) : old.slice(b);
    const geometry = [...prefix, ...body, ...suffix];
    const legOffset = head < 1 ? a : a + 1, legEnd = legOffset + way.length - 1;
    const tunnels = spliceTunnels(route.tunnels, plan.tunnels, leg.range, legOffset, tail < 1 ? legEnd : legEnd + 1);
    // The stored length is the router's; the removed share of it follows the share of the drawn line.
    const drawn = pathLength(old), removed = drawn > 0 ? pathLength(old.slice(a, b + 1)) / drawn : 0;
    const distanceKept = route.distanceM * (1 - removed), minutesKept = route.walkingMinutes * (1 - removed);
    next = {
      geometry, distanceM: Math.round(distanceKept + plan.distanceM), walkingMinutes: Math.ceil(minutesKept + plan.walkingMinutes), attribution: route.attribution,
      ...(tunnels ? { tunnels } : {}),
    };
    if (geometry.length > 12000 || next.distanceM > 8100 || next.walkingMinutes > 90) throw new FoodStopError("С этим заведением прогулка станет длиннее 90 минут.");
    if (!validTunnels(next.tunnels, geometry.length) || (next.tunnels?.length ?? 0) > MAX_ROUTE_TUNNELS) throw new FoodStopError("Не удалось соединить путь к заведению с маршрутом.");
  }
  const stops = document.stops.map((stop, i) => i === leg.position - 1 ? { ...stop, transition: "", nextHint: "" } : stop);
  stops.splice(leg.position, 0, { id: stopId, place: { address: foodStopTitle(place), location: { lat: place.lat, lon: place.lon } }, storyRef: null, transition: "", nextHint: "" });
  // A longer walk moves to the next duration the builder offers, so rebuilding it there still fits.
  const minutes = next.walkingMinutes > document.minutes ? [30, 60, 90].find(value => value >= next.walkingMinutes) ?? 90 : document.minutes;
  return validateWalkDocument({ ...document, minutes, stops, route: next });
}

/** The view of the changed document: every stop keeps its story and recording, a new one has none yet. */
export function viewWithDocument(view: WalkView, document: WalkDocument, revision: number, contentVersion: string): WalkView {
  const chapters = new Map(view.chapters.map(chapter => [chapter.id, chapter]));
  return validateWalkView({
    document, revision, contentVersion,
    chapters: document.stops.map(stop => chapters.get(stop.id) ?? { id: stop.id, status: "not_requested", story: null, audio: null }),
  });
}
