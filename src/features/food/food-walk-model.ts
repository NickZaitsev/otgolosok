import { nearestStop, type RouteMatch } from "./route-proximity";
import { parseOpeningHours, parsedOpeningHoursStatus, type ParsedHours } from "./opening-hours";
import type { FoodPlace } from "./types";

export type RouteFoodPlace = FoodPlace & RouteMatch;
const ordered = (places: RouteFoodPlace[]) => [...places].sort((a, b) => a.alongM - b.alongM || a.id.localeCompare(b.id));
export function splitRouteFood(places: RouteFoodPlace[], fromM: number) {
  const sorted = ordered(places);
  return { ahead: sorted.filter(p => p.alongM >= fromM), behind: sorted.filter(p => p.alongM < fromM) };
}
export function groupRouteFood(places: RouteFoodPlace[], stops: Array<{ alongM: number }>) {
  const groups: Array<{ stop: number | null; places: RouteFoodPlace[] }> = [];
  for (const place of ordered(places)) {
    const stop = nearestStop(place.alongM, stops);
    let group = groups.at(-1);
    if (!group || group.stop !== stop) { group = { stop, places: [] }; groups.push(group); }
    group.places.push(place);
  }
  return groups;
}
/** Scoped to the mounted screen: equal OSM strings share one table, including unknown strings. */
export function createFoodHoursCache(parse = parseOpeningHours) {
  const schedules = new Map<string | null, ParsedHours | null>();
  return (value: string | null, now: Date) => {
    if (!schedules.has(value)) schedules.set(value, parse(value));
    return parsedOpeningHoursStatus(schedules.get(value)!, value, now);
  };
}
export function foodWebsite(value: string | null): string | null {
  if (!value) return null;
  try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) ? url.href : null; } catch { return null; }
}
export function foodPhone(value: string | null): string | null {
  // OSM lists several numbers with ";" or ","; the first one is the main line.
  const cleaned = (value ?? "").split(/[;,]/)[0].replace(/[\s().-]/g, "");
  return /^\+?\d+$/.test(cleaned) ? `tel:${cleaned}` : null;
}
