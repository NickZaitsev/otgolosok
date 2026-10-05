/**
 * Links to a catalog place. The map URL names the place by its id, never by coordinates: `/?place=osm:node:123`.
 * The shared link `/place/node/123` is served by the backend with Open Graph tags and leads to the map URL
 * (backend/place-share.mjs keeps the same mapping).
 */
export const PLACE_PARAM = "place";

const PLACE_ID = /^osm:(node|way|relation):([1-9]\d{0,18})$/;

/** The only public place id format; the value goes into an API path, so nothing else is accepted. */
export function isPlaceId(value: unknown): value is string {
  return typeof value === "string" && PLACE_ID.test(value);
}

/** null without the parameter; `invalid` for a damaged link. */
export function readPlaceParam(params: Pick<URLSearchParams, "get">): { id: string } | { invalid: true } | null {
  const value = params.get(PLACE_PARAM);
  if (value === null) return null;
  return isPlaceId(value) ? { id: value } : { invalid: true };
}

/** Colons are legal in a query: the id stays readable instead of `osm%3Anode%3A123`. */
export function placeMapUrl(id: string): string {
  return `/?${PLACE_PARAM}=${id}`;
}

/** `/place/node/123`: no colons, so messengers do not percent-encode the shared link. */
export function placeSharePath(id: string): string {
  const match = PLACE_ID.exec(id);
  if (!match) throw new Error(`Not a place id: ${id}`);
  return `/place/${match[1]}/${match[2]}`;
}

export function placeShareUrl(id: string, origin: string): string {
  return `${origin}${placeSharePath(id)}`;
}
