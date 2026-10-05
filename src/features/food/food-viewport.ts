import type { CatalogBounds, MapViewport } from "../explore/catalog-bounds";
import type { FoodPlace } from "./types";

export const FOOD_MIN_ZOOM = 15;
export const FOOD_MARKER_LIMIT = 300;
export const FOOD_TOGGLE_KEY = "otgolosok:around:food:v1";

/** Required bounds include half a zoom step of margin, rather than the story prefetch area. */
export function visibleFoodPlaces(places: FoodPlace[], viewport: MapViewport | null): FoodPlace[] {
  if (!viewport || viewport.zoom < FOOD_MIN_ZOOM) return [];
  const { required: bounds, center } = viewport;
  const scale = Math.cos(center.lat * Math.PI / 180);
  const distance = (p: FoodPlace) => (p.lat - center.lat) ** 2 + ((p.lon - center.lon) * scale) ** 2;
  return places.filter(p => foodInBounds(p, bounds))
    .sort((a, b) => distance(a) - distance(b) || a.id.localeCompare(b.id)).slice(0, FOOD_MARKER_LIMIT);
}
export function foodInBounds(place: FoodPlace, bounds: CatalogBounds): boolean {
  return place.lat >= bounds.south && place.lat <= bounds.north && place.lon >= bounds.west && place.lon <= bounds.east;
}
