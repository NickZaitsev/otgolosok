import { foodGroup, foodIcon } from "./food-kinds";
import type { FoodKind } from "./types";

/** Only static, category-whitelisted glyphs enter Leaflet HTML; no OSM fields do. */
export function foodMarkerSvg(kind: FoodKind): string {
  return `<svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="12" fill="var(${foodGroup(kind).colorToken})"/><path d="${foodIcon(kind).glyph}" transform="translate(5.5 5.5) scale(.87)" fill="var(--on-dark)"/></svg>`;
}
