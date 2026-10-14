import { createHash } from "node:crypto";
import { CITIES, regionCityAt } from "./cities.mjs";
import { PAGE_STYLE, escapeHtml, isIndexablePlace, normalizedText, placeSharePath, shareDescription } from "./place-share.mjs";

/**
 * The HTML catalog of published stories: `/places` lists the cities, `/places/<city>` and `/places/<city>/<n>` list
 * their stories in pages of PAGE_SIZE with plain links. The map and the sitemap are not a way in for a person or a
 * crawler that arrives without scripts; this is: every story is reachable by following links from `/places`.
 */
export const PAGE_SIZE = 50;
const SITE = "Отголосок";
const PATH = /^\/places(?:\/([a-z]+)(?:\/([2-9]|[1-9]\d{1,5}))?)?$/;

const STYLE = `${PAGE_STYLE}
.entries{list-style:none;padding:0;margin:0 0 32px}.entries li{margin:0 0 24px;font-size:18px}
.entries a{font:600 20px/1.3 Georgia,"Times New Roman",serif}.entries p{margin:4px 0 0;font-size:16px}.entries .place{margin:2px 0 0;font-size:14px}
.pager{display:flex;justify-content:space-between;gap:16px;margin:0 0 24px}.pager a{font-weight:600}
.cities li{font-size:20px}`;
const STYLE_HASH = createHash("sha256").update(STYLE).digest("base64");
/** The catalog pages carry no script and no counter: style by hash, nothing else. */
export const CATALOG_PAGE_CSP = ["default-src 'none'", `style-src 'sha256-${STYLE_HASH}'`, "img-src 'self'", "frame-ancestors 'none'", "base-uri 'none'", "form-action 'none'"].join("; ");

/** @typedef {{id: string, name?: unknown, address?: unknown, lat?: unknown, lon?: unknown, verification?: unknown, story?: {title?: unknown, paragraphs?: unknown} | null}} CatalogSource */
/** @typedef {{id: string, href: string, title: string, subject: string | undefined, description: string}} CatalogEntry */
/** @typedef {{city: import("./cities.mjs").City, entries: CatalogEntry[]}} CatalogCity */

/** @param {number} total */
export const pageCount = total => Math.max(1, Math.ceil(total / PAGE_SIZE));

/** `/places/moscow` for page 1, `/places/moscow/3` after it. @param {string} cityId @param {number} page */
export const cityCatalogPath = (cityId, page = 1) => `/places/${cityId}${page > 1 ? `/${page}` : ""}`;

/**
 * Cities with their indexable stories, ordered by title and then id so a story keeps its page between builds. A city
 * without stories is left out: its page would be empty. A place outside every city's region has no catalog page.
 * @param {CatalogSource[]} places @returns {CatalogCity[]}
 */
export function buildCatalog(places) {
  /** @type {Map<string, CatalogEntry[]>} */
  const byCity = new Map();
  for (const place of places) {
    const href = placeSharePath(place.id), city = regionCityAt(place.lat, place.lon);
    if (!href || !city || !isIndexablePlace(place)) continue;
    const title = normalizedText(place.story?.title) ?? normalizedText(place.name);
    if (!title) continue;
    const name = normalizedText(place.name), address = normalizedText(place.address);
    const subject = name && !title.toLocaleLowerCase("ru").includes(name.toLocaleLowerCase("ru")) ? name : undefined;
    const entry = { id: place.id, href, title, subject: [subject, address].filter(Boolean).join(" · ") || undefined, description: shareDescription(place.story, "") };
    byCity.set(city.id, [...(byCity.get(city.id) ?? []), entry]);
  }
  return CITIES.flatMap(city => {
    const entries = byCity.get(city.id);
    return entries?.length ? [{ city, entries: entries.sort((a, b) => a.title.localeCompare(b.title, "ru") || a.id.localeCompare(b.id)) }] : [];
  });
}

/** Every catalog URL path: the index, and each page of each city. @param {CatalogCity[]} catalog */
export const catalogPaths = catalog => ["/places", ...catalog.flatMap(({ city, entries }) =>
  Array.from({ length: pageCount(entries.length) }, (_, index) => cityCatalogPath(city.id, index + 1)))];

/** @param {string} pathname @returns {{kind: "index"} | {kind: "city", cityId: string, page: number} | null} */
export function parseCatalogPath(pathname) {
  const match = PATH.exec(pathname);
  if (!match) return null;
  return match[1] ? { kind: "city", cityId: match[1], page: match[2] ? Number(match[2]) : 1 } : { kind: "index" };
}

/** @param {{title: string, description: string, canonical: string, body: string}} page */
const layout = ({ title, description, canonical, body }) => `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<link rel="icon" href="/icon.svg" type="image/svg+xml">
<meta name="description" content="${escapeHtml(description)}">
<link rel="canonical" href="${escapeHtml(canonical)}">
<meta property="og:site_name" content="${SITE}">
<meta property="og:locale" content="ru_RU">
<meta property="og:type" content="website">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:url" content="${escapeHtml(canonical)}">
<style>${STYLE}</style>
</head>
<body>
<main>
<a class="brand" href="/">Отголосок</a>
${body}
<footer>«Отголосок» — аудиоистории, которые звучат рядом с местом событий. <a href="/">Карта историй</a></footer>
</main>
</body>
</html>
`;

/** `/places`: the cities that have stories. @param {{origin: string, catalog: CatalogCity[]}} input */
export function renderCatalogIndex({ origin, catalog }) {
  const list = catalog.length
    ? `<ul class="entries cities">${catalog.map(({ city, entries }) => `<li><a href="${cityCatalogPath(city.id)}">${escapeHtml(city.name)}</a> <span class="publisher">· ${entries.length} ${plural(entries.length)}</span></li>`).join("")}</ul>`
    : "<p>Истории пока не опубликованы.</p>";
  return layout({
    title: `Каталог аудиоисторий — ${SITE}`, canonical: `${origin}/places`,
    description: "Аудиоистории о домах, улицах и событиях: короткие рассказы с источниками, которые можно послушать рядом с местом.",
    body: `<h1>Каталог историй</h1>\n<p class="place">Выберите город: в каждой истории есть текст, источники и запись для прослушивания.</p>\n${list}`,
  });
}

/**
 * One page of a city's list; the caller has checked that `page` exists.
 * @param {{origin: string, city: import("./cities.mjs").City, entries: CatalogEntry[], page: number}} input
 */
export function renderCityCatalogPage({ origin, city, entries, page }) {
  const pages = pageCount(entries.length), from = (page - 1) * PAGE_SIZE;
  const shown = entries.slice(from, from + PAGE_SIZE);
  const link = (/** @type {number} */ number, /** @type {string} */ label) => `<a href="${cityCatalogPath(city.id, number)}">${label}</a>`;
  const pager = pages > 1 ? `<nav class="pager" aria-label="Страницы каталога"><span>${page > 1 ? link(page - 1, "← Назад") : ""}</span><span>Страница ${page} из ${pages}</span><span>${page < pages ? link(page + 1, "Далее →") : ""}</span></nav>\n` : "";
  const suffix = page > 1 ? `, страница ${page}` : "";
  return layout({
    title: `Аудиоистории: ${city.name}${suffix} — ${SITE}`, canonical: origin + cityCatalogPath(city.id, page),
    description: `Каталог аудиоисторий: ${city.name}. ${entries.length} ${plural(entries.length)} с текстом, источниками и записью${suffix}.`,
    body: `<p class="place"><a href="/places">Каталог историй</a> · ${escapeHtml(city.name)}</p>\n<h1>Истории: ${escapeHtml(city.name)}</h1>\n${pager}<ul class="entries">${shown.map(entry =>
      `<li><a href="${escapeHtml(entry.href)}">${escapeHtml(entry.title)}</a>${entry.subject ? `<p class="place">${escapeHtml(entry.subject)}</p>` : ""}${entry.description ? `<p>${escapeHtml(entry.description)}</p>` : ""}</li>`).join("\n")}</ul>\n${pager}`,
  });
}

/** 1 история, 2 истории, 5 историй. @param {number} count */
function plural(count) {
  const last = count % 10, tens = count % 100;
  return tens >= 11 && tens <= 14 ? "историй" : last === 1 ? "история" : last >= 2 && last <= 4 ? "истории" : "историй";
}
