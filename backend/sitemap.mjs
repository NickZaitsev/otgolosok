import { isIndexablePlace, placeSharePath } from "./place-share.mjs";

/** Pages of the static site worth a search result; the rest need a session, an id or are service pages. */
const STATIC_PATHS = ["/", "/trends"];
// sitemaps.org: one file holds at most 50 000 URLs.
const URL_LIMIT = 50_000;

/** @param {string} value */
const escape = value => value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char] ?? char);

/**
 * `/sitemap.xml`: the static pages and every published place whose story may go to search (see isIndexablePlace),
 * dated by its latest approved text.
 * @param {{origin: string, places: {id: string, updatedAt?: unknown, verification?: unknown, story?: {paragraphs?: unknown} | null}[]}} input
 */
export function renderSitemap({ origin, places }) {
  const entries = STATIC_PATHS.map(path => ({ loc: origin + path, lastmod: undefined }));
  for (const place of places) {
    const path = placeSharePath(place.id);
    if (!path || !isIndexablePlace(place)) continue;
    const date = typeof place.updatedAt === "string" && !Number.isNaN(Date.parse(place.updatedAt)) ? new Date(place.updatedAt).toISOString().slice(0, 10) : undefined;
    entries.push({ loc: origin + path, lastmod: date });
  }
  if (entries.length > URL_LIMIT) throw new Error(`Sitemap holds ${entries.length} URLs, more than ${URL_LIMIT}: split it into a sitemap index.`);
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.map(entry => `<url><loc>${escape(entry.loc)}</loc>${entry.lastmod ? `<lastmod>${entry.lastmod}</lastmod>` : ""}</url>`).join("\n")}
</urlset>
`;
}
