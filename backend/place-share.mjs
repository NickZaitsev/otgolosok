import { createHash } from "node:crypto";

/**
 * The shared link of a catalog place, `/place/<type>/<number>` (src/features/explore/place-link.ts keeps the same
 * mapping). The static site has one index.html, so a messenger would show the same preview for every place: this
 * page carries the place's Open Graph tags and sends people on to the map URL `/?place=osm:<type>:<number>`.
 */
export const SHARE_PATH = /^\/place\/(node|way|relation)\/([1-9]\d{0,18})$/;

const SITE = "Отголосок";
const SITE_TITLE = "Отголосок — город говорит рядом";
const SITE_DESCRIPTION = "Аудиопрогулки по Москве, которые начинаются там, где случилась история.";
const FALLBACK_IMAGE = { path: "/icons/icon-512.png", width: 512, height: 512 };
const DESCRIPTION_LIMIT = 200;
const PHOTO_PATH = /^(?:\/api\/place-images\/[a-f0-9]{64}|\/images\/places\/[a-z0-9-]+)\.jpg$/;
// Crawlers do not run scripts and stay on the tags; people are sent on. No meta refresh: crawlers follow it.
// location.replace keeps this page out of the history, so Back from the map does not bounce here again.
const REDIRECT_SCRIPT = 'location.replace(document.getElementById("open").href)';
const SCRIPT_HASH = createHash("sha256").update(REDIRECT_SCRIPT).digest("base64");
export const SHARE_PAGE_CSP = `default-src 'none'; script-src 'sha256-${SCRIPT_HASH}'; img-src 'self'; base-uri 'none'; form-action 'none'`;

/** @param {string} pathname @returns {string | null} `osm:<type>:<number>` */
export function sharePathToPlaceId(pathname) {
  const match = SHARE_PATH.exec(pathname);
  return match ? `osm:${match[1]}:${match[2]}` : null;
}

/** @param {unknown} value */
const text = value => typeof value === "string" && value.trim() ? value.replace(/\s+/g, " ").trim() : undefined;

/** @param {string} value */
const escape = value => value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char);

/**
 * The first paragraph, cut at a word boundary to fit a messenger preview; the address when there is no text.
 * @param {{paragraphs?: unknown} | null | undefined} story
 * @param {string} fallback
 */
export function shareDescription(story, fallback) {
  const paragraphs = Array.isArray(story?.paragraphs) ? story.paragraphs : [];
  const first = paragraphs.map(paragraph => text(/** @type {{text?: unknown} | null} */ (paragraph)?.text)).find(Boolean);
  if (!first) return fallback;
  if (first.length <= DESCRIPTION_LIMIT) return first;
  const cut = first.slice(0, DESCRIPTION_LIMIT - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > DESCRIPTION_LIMIT / 2 ? cut.slice(0, space) : cut).replace(/[\s.,;:!?…—-]+$/, "")}…`;
}

/**
 * @typedef {{name?: unknown, address?: unknown, text?: {story?: {title?: unknown, paragraphs?: unknown} | null} | null,
 *   photo?: {src?: unknown, width?: unknown, height?: unknown, alt?: unknown} | null}} PublishedPlace
 */

/**
 * The preview page of a shared place. An unknown or unpublished place answers 404 with the site's own tags and still
 * leads to the map, which explains that the story is gone.
 * @param {{id: string, place: PublishedPlace | null, origin: string}} input
 * @returns {{status: 200 | 404, html: string}}
 */
export function renderPlaceSharePage({ id, place, origin }) {
  const [, type, number] = /** @type {RegExpExecArray} */ (/^osm:(node|way|relation):(\d+)$/.exec(id));
  const shareUrl = `${origin}/place/${type}/${number}`;
  const mapUrl = `/?place=${id}`;
  const story = place?.text?.story ?? null;
  const name = text(place?.name);
  const title = place ? text(story?.title) ?? name ?? SITE_TITLE : SITE_TITLE;
  const description = place ? shareDescription(story, text(place.address) ?? name ?? SITE_DESCRIPTION) : "Эта история больше недоступна.";
  const photo = place?.photo;
  /** @param {unknown} value */
  const size = value => typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;
  const width = size(photo?.width), height = size(photo?.height);
  // Only the site's own photo paths: the tag points crawlers at this origin and nothing else.
  const image = typeof photo?.src === "string" && PHOTO_PATH.test(photo.src) && width && height
    ? { url: origin + photo.src, width, height, alt: text(photo.alt) ?? title }
    : { url: origin + FALLBACK_IMAGE.path, width: FALLBACK_IMAGE.width, height: FALLBACK_IMAGE.height, alt: SITE };
  const large = image.url !== origin + FALLBACK_IMAGE.path;
  const meta = (/** @type {string} */ key, /** @type {string | number} */ value) => `<meta ${key.startsWith("og:") ? "property" : "name"}="${key}" content="${escape(String(value))}">`;
  const html = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(place ? `${title} — ${SITE}` : SITE_TITLE)}</title>
${meta("description", description)}
<link rel="canonical" href="${escape(shareUrl)}">
${meta("og:site_name", SITE)}
${meta("og:locale", "ru_RU")}
${meta("og:type", "website")}
${meta("og:title", title)}
${meta("og:description", description)}
${meta("og:url", shareUrl)}
${meta("og:image", image.url)}
${meta("og:image:width", image.width)}
${meta("og:image:height", image.height)}
${meta("og:image:alt", image.alt)}
${meta("twitter:card", large ? "summary_large_image" : "summary")}
</head>
<body>
<h1>${escape(title)}</h1>
<p>${escape(description)}</p>
<p><a id="open" href="${escape(mapUrl)}">Открыть историю на карте</a></p>
<script>${REDIRECT_SCRIPT}</script>
</body>
</html>
`;
  return { status: place ? 200 : 404, html };
}

/** A path under /place/ that names no place. */
export const SHARE_NOT_FOUND_HTML = `<!doctype html>
<html lang="ru">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${SITE_TITLE}</title></head>
<body><h1>Страница не найдена</h1><p><a href="/">Открыть карту историй</a></p></body>
</html>
`;
