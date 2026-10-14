import { isIndexablePlace, placeSharePath } from "./place-share.mjs";

/**
 * Pages of the static site worth a search result; the rest need a session, an id or are service pages. /trends is
 * left out until its walk list is in the exported HTML: today it loads from the closed /api/.
 */
const STATIC_PATHS = ["/"];
// sitemaps.org: one file holds at most 50 000 URLs.
const URL_LIMIT = 50_000;

/** @param {string} value */
const escape = value => value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char] ?? char);

/**
 * `/sitemap.xml`: the static pages and every published place whose story may go to search (see isIndexablePlace).
 * No lastmod: the store knows when a text was generated, not when it was approved or its photo and recording changed.
 * @param {{origin: string, places: {id: string, verification?: unknown, story?: {paragraphs?: unknown} | null}[]}} input
 */
export function renderSitemap({ origin, places }) {
  const entries = STATIC_PATHS.map(path => origin + path);
  for (const place of places) {
    const path = placeSharePath(place.id);
    if (!path || !isIndexablePlace(place)) continue;
    entries.push(origin + path);
  }
  if (entries.length > URL_LIMIT) throw new Error(`Sitemap holds ${entries.length} URLs, more than ${URL_LIMIT}: split it into a sitemap index.`);
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.map(loc => `<url><loc>${escape(loc)}</loc></url>`).join("\n")}
</urlset>
`;
}
