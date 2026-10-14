import { createHash } from "node:crypto";

/**
 * The page of a catalog place, `/place/<type>/<number>` (src/features/explore/place-link.ts keeps the same mapping).
 * The static site has one index.html, so search engines and messengers would see the same empty shell for every
 * place: this page is the story itself — text, recording, photo, sources and nearby places — with its Open Graph tags
 * and a link to the map in the requested UI language. Crawlers and people get the same page; nothing redirects.
 */
export const SHARE_PATH = /^\/place\/(node|way|relation)\/([1-9]\d{0,18})$/;

const SITE = "Отголосок";
const SITE_TITLE = "Отголосок — город говорит рядом";
const SITE_DESCRIPTION = "Аудиопрогулки по Москве и Казани, которые начинаются там, где случилась история.";
const FALLBACK_IMAGE = { path: "/icons/icon-512.png", width: 512, height: 512 };
const DESCRIPTION_LIMIT = 200;
/** Stories shorter than this are kept out of search: a few lines about a building are thin content. */
export const INDEXABLE_WORDS = 50;
const PHOTO_PATH = /^(?:\/api\/place-images\/[a-f0-9]{64}|\/images\/places\/[a-z0-9-]+)\.jpg$/;
const AUDIO_PATH = /^\/api\/story-audio\/[a-f0-9]{64}\.mp3$/;
const HTTP_URL = /^https?:\/\/[^\s"'<>]+$/;
const OSM_ID = /^osm:(node|way|relation):([1-9]\d{0,18})$/;

// Light «Читальня» palette of DESIGN.md. Self-hosted Manrope and Cormorant carry hashed build names, so the page
// stays on system fonts instead of pointing at a file that the next build renames.
const STYLE = `:root{color-scheme:light;--paper:#f5f1e8;--raised:#fbf8f2;--ink:#1a1714;--muted:#57504a;--accent:#a8301b;--button:#203e38;--line:#dce2da}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:18px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:720px;margin:0 auto;padding:16px 16px 48px}a{color:var(--accent)}a:focus-visible{outline:3px solid var(--accent);outline-offset:2px}
.brand{display:inline-block;font:600 28px/1.2 Georgia,"Times New Roman",serif;color:var(--ink);text-decoration:none;margin:8px 0 24px}
.brand::after{content:".";color:#e34234}
h1{font:600 clamp(30px,6vw,44px)/1.15 Georgia,"Times New Roman",serif;margin:0 0 8px}
h2{font:600 22px/1.3 Georgia,"Times New Roman",serif;margin:40px 0 12px}
.place{color:var(--muted);font-size:16px;margin:0 0 24px}
figure{margin:0 0 24px}figure img{display:block;width:100%;height:auto;border-radius:12px;background:var(--raised)}
figcaption{color:var(--muted);font-size:14px;margin-top:8px}
.listen{background:var(--raised);border:1px solid var(--line);border-radius:16px;padding:16px;margin:0 0 24px}
.listen p{margin:0 0 8px;font-size:16px;font-weight:600}audio{width:100%}
.open{display:inline-flex;align-items:center;min-height:48px;padding:12px 24px;border-radius:999px;background:var(--button);color:#fff;font-size:16px;font-weight:600;text-decoration:none}
.open:focus-visible{outline-color:var(--button)}
article p{margin:0 0 1em}ol,ul{padding-left:1.2em}li{margin:0 0 8px;font-size:16px}
.publisher{color:var(--muted)}footer{margin-top:48px;color:var(--muted);font-size:14px}`;
const STYLE_HASH = createHash("sha256").update(STYLE).digest("base64");
// No scripts at all: the JSON-LD block is data, which a browser never runs, so script-src stays closed.
export const SHARE_PAGE_CSP = `default-src 'none'; style-src 'sha256-${STYLE_HASH}'; img-src 'self'; media-src 'self'; base-uri 'none'; form-action 'none'`;

/** @param {string} pathname @returns {string | null} `osm:<type>:<number>` */
export function sharePathToPlaceId(pathname) {
  const match = SHARE_PATH.exec(pathname);
  return match ? `osm:${match[1]}:${match[2]}` : null;
}

/** `osm:node:123` → `/place/node/123`; null for anything else. @param {unknown} id */
export function placeSharePath(id) {
  const match = typeof id === "string" ? OSM_ID.exec(id) : null;
  return match ? `/place/${match[1]}/${match[2]}` : null;
}

/** @param {unknown} value @returns {"ru" | "en" | "zh"} */
export function shareLocale(value) {
  return value === "en" || value === "zh" ? value : "ru";
}

/** @param {string} id @param {unknown} locale */
const placeMapUrl = (id, locale) => {
  const normalized = shareLocale(locale);
  return `${normalized === "ru" ? "/" : `/${normalized}`}?place=${id}`;
};

/** @param {unknown} value */
const text = value => typeof value === "string" && value.trim() ? value.replace(/\s+/g, " ").trim() : undefined;

/** @param {string} value */
const escape = value => value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char);

/** @param {{paragraphs?: unknown} | null | undefined} story @returns {string[]} */
const storyParagraphs = story => (Array.isArray(story?.paragraphs) ? story.paragraphs : [])
  .map(paragraph => text(/** @type {{text?: unknown} | null} */ (paragraph)?.text)).filter(value => value !== undefined);

/** Words of the story text, counted the same way for the page and the sitemap. @param {{paragraphs?: unknown} | null | undefined} story */
export const storyWordCount = story => storyParagraphs(story).join(" ").split(" ").filter(word => /[\p{L}\p{N}]/u.test(word)).length;

/**
 * A place goes to search only with a real story: long enough and not a test placeholder.
 * @param {{story?: {paragraphs?: unknown} | null, verification?: unknown}} text
 */
export const isIndexablePlace = ({ story, verification }) => verification !== "test_placeholder" && storyWordCount(story) >= INDEXABLE_WORDS;

/**
 * The first paragraph, cut at a word boundary to fit a messenger preview; the address when there is no text.
 * @param {{paragraphs?: unknown} | null | undefined} story
 * @param {string} fallback
 */
export function shareDescription(story, fallback) {
  const first = storyParagraphs(story)[0];
  if (!first) return fallback;
  if (first.length <= DESCRIPTION_LIMIT) return first;
  const cut = first.slice(0, DESCRIPTION_LIMIT - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > DESCRIPTION_LIMIT / 2 ? cut.slice(0, space) : cut).replace(/[\s.,;:!?…—-]+$/, "")}…`;
}

/** 95.976 → «1 мин 36 с». @param {number} seconds */
const spokenDuration = seconds => {
  const total = Math.max(1, Math.round(seconds)), minutes = Math.floor(total / 60), rest = total % 60;
  return [minutes ? `${minutes} мин` : "", rest ? `${rest} с` : ""].filter(Boolean).join(" ");
};
/** 95.976 → `PT1M36S` (ISO 8601). @param {number} seconds */
const isoDuration = seconds => {
  const total = Math.max(1, Math.round(seconds)), minutes = Math.floor(total / 60), rest = total % 60;
  return `PT${minutes ? `${minutes}M` : ""}${rest ? `${rest}S` : ""}`;
};
/** @param {unknown} value */
const positive = value => typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
/** @param {unknown} value */
const coordinate = value => typeof value === "number" && Number.isFinite(value) ? value : undefined;
/** @param {unknown} value */
const size = value => typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;
/** Valid ISO timestamps only. @param {unknown} value */
const timestamp = value => typeof value === "string" && !Number.isNaN(Date.parse(value)) ? new Date(value).toISOString() : undefined;

/**
 * @typedef {{name?: unknown, address?: unknown, location?: {lat?: unknown, lon?: unknown} | null,
 *   text?: {story?: {title?: unknown, paragraphs?: unknown, sources?: unknown} | null, verification?: unknown, createdAt?: unknown,
 *     audio?: {url?: unknown, durationSec?: unknown} | null} | null,
 *   photo?: {src?: unknown, width?: unknown, height?: unknown, alt?: unknown, author?: unknown, license?: unknown,
 *     licenseUrl?: unknown, sourceUrl?: unknown} | null}} PublishedPlace
 * @typedef {{id?: unknown, title?: unknown, distanceM?: unknown}} NearbyPlace
 */

/** @param {unknown} sources @returns {{title: string, url: string, publisher?: string}[]} */
const storySources = sources => (Array.isArray(sources) ? sources : []).flatMap(source => {
  const title = text(source?.title), url = text(source?.url);
  return title && url && HTTP_URL.test(url) ? [{ title, url, ...(text(source?.publisher) ? { publisher: text(source.publisher) } : {}) }] : [];
});

/** JSON that cannot close the surrounding script element. @param {unknown} value */
const jsonLd = value => JSON.stringify(value).replace(/</g, "\\u003c");

/**
 * The page of a shared place. An unknown or unpublished place answers 404 with the site's own tags and still leads to
 * the map, which explains that the story is gone. A thin story is served but kept out of search (`noindex, follow`).
 * @param {{id: string, place: PublishedPlace | null, origin: string, locale?: unknown, nearby?: NearbyPlace[]}} input
 * @returns {{status: 200 | 404, html: string}}
 */
export function renderPlaceSharePage({ id, place, origin, locale = "ru", nearby = [] }) {
  locale = shareLocale(locale);
  const path = /** @type {string} */ (placeSharePath(id));
  const canonical = origin + path;
  const shareUrl = `${canonical}${locale === "ru" ? "" : `?lang=${locale}`}`;
  const mapUrl = placeMapUrl(id, locale);
  const story = place?.text?.story ?? null;
  const name = text(place?.name);
  const address = text(place?.address);
  const title = place ? text(story?.title) ?? name ?? SITE_TITLE : SITE_TITLE;
  // The story title is often a hook («Здесь авангард можно было надеть»); people search for the place itself.
  const subject = name && !title.toLocaleLowerCase("ru").includes(name.toLocaleLowerCase("ru")) ? name : undefined;
  const headline = subject ? `${title}. ${subject}` : title;
  const description = place ? shareDescription(story, address ?? name ?? SITE_DESCRIPTION) : "Эта история больше недоступна.";
  const paragraphs = place ? storyParagraphs(story) : [];
  const indexable = place !== null && isIndexablePlace({ story, verification: place.text?.verification });
  const photo = place?.photo;
  const width = size(photo?.width), height = size(photo?.height);
  // Only the site's own photo paths: the tag points crawlers at this origin and nothing else.
  const image = typeof photo?.src === "string" && PHOTO_PATH.test(photo.src) && width && height
    ? { path: photo.src, url: origin + photo.src, width, height, alt: text(photo.alt) ?? title }
    : null;
  const preview = image ?? { url: origin + FALLBACK_IMAGE.path, width: FALLBACK_IMAGE.width, height: FALLBACK_IMAGE.height, alt: SITE };
  const audio = place?.text?.audio;
  const audioPath = typeof audio?.url === "string" && AUDIO_PATH.test(audio.url) ? audio.url : null;
  const duration = positive(audio?.durationSec);
  const sources = place ? storySources(story?.sources) : [];
  const published = timestamp(place?.text?.createdAt);
  const lat = coordinate(place?.location?.lat), lon = coordinate(place?.location?.lon);
  const neighbours = place ? nearby.flatMap(item => {
    const href = placeSharePath(item?.id), label = text(item?.title);
    return href && label && item.id !== id ? [{ href, label, distance: positive(item.distanceM) }] : [];
  }) : [];

  const meta = (/** @type {string} */ key, /** @type {string | number} */ value) => `<meta ${key.startsWith("og:") ? "property" : "name"}="${key}" content="${escape(String(value))}">`;
  const organization = { "@type": "Organization", name: SITE, url: `${origin}/` };
  const structured = place ? jsonLd({
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Article", headline, description, inLanguage: "ru", url: canonical, mainEntityOfPage: canonical,
        ...(published ? { datePublished: published, dateModified: published } : {}),
        image: [preview.url], author: organization, publisher: organization,
        about: {
          "@type": "TouristAttraction", name: name ?? title, ...(address ? { address } : {}),
          ...(lat !== undefined && lon !== undefined ? { geo: { "@type": "GeoCoordinates", latitude: lat, longitude: lon } } : {}),
        },
        ...(audioPath ? { audio: { "@type": "AudioObject", contentUrl: origin + audioPath, encodingFormat: "audio/mpeg", inLanguage: "ru", ...(duration ? { duration: isoDuration(duration) } : {}) } } : {}),
        ...(sources.length ? { citation: sources.map(source => source.url) } : {}),
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: SITE, item: `${origin}/` },
          { "@type": "ListItem", position: 2, name: title, item: canonical },
        ],
      },
    ],
  }) : null;

  const html = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(place ? `${headline} — ${SITE}` : SITE_TITLE)}</title>
<link rel="icon" href="/icon.svg" type="image/svg+xml">
${meta("description", description)}
${place && !indexable ? `${meta("robots", "noindex, follow")}\n` : ""}<link rel="canonical" href="${escape(canonical)}">
${meta("og:site_name", SITE)}
${meta("og:locale", "ru_RU")}
${meta("og:type", place ? "article" : "website")}
${meta("og:title", title)}
${meta("og:description", description)}
${meta("og:url", shareUrl)}
${meta("og:image", preview.url)}
${meta("og:image:width", preview.width)}
${meta("og:image:height", preview.height)}
${meta("og:image:alt", preview.alt)}
${meta("twitter:card", image ? "summary_large_image" : "summary")}
<style>${STYLE}</style>
${structured ? `<script type="application/ld+json">${structured}</script>\n` : ""}</head>
<body>
<main>
<a class="brand" href="/">Отголосок</a>
<article>
<h1>${escape(title)}</h1>
${place && (subject || address) ? `<p class="place">${escape([subject, address].filter(Boolean).join(" · "))}</p>\n` : ""}${image ? `<figure><img src="${escape(image.path)}" width="${image.width}" height="${image.height}" alt="${escape(image.alt)}" fetchpriority="high">${photoCaption(photo)}</figure>\n` : ""}${audioPath ? `<section class="listen" aria-label="Аудиоистория"><p>Послушать историю${duration ? ` · ${spokenDuration(duration)}` : ""}</p><audio controls preload="none" src="${escape(audioPath)}"></audio></section>\n` : ""}${(paragraphs.length ? paragraphs : [description]).map(paragraph => `<p>${escape(paragraph)}</p>`).join("\n")}
<p><a id="open" class="open" href="${escape(mapUrl)}">${place ? "Слушать на карте" : "Открыть историю на карте"}</a></p>
${sources.length ? `<h2>Источники</h2>\n<ol>${sources.map(source => `<li><a href="${escape(source.url)}" rel="noopener">${escape(source.title)}</a>${source.publisher ? ` <span class="publisher">— ${escape(source.publisher)}</span>` : ""}</li>`).join("")}</ol>\n` : ""}</article>
${neighbours.length ? `<nav aria-label="Истории рядом"><h2>Рядом</h2>\n<ul>${neighbours.map(item => `<li><a href="${escape(item.href)}">${escape(item.label)}</a>${item.distance ? ` <span class="publisher">· ${item.distance} м</span>` : ""}</li>`).join("")}</ul></nav>\n` : ""}<footer>«Отголосок» — аудиоистории, которые звучат рядом с местом событий. <a href="/">Карта историй</a></footer>
</main>
</body>
</html>
`;
  return { status: place ? 200 : 404, html };
}

/** «Фото: автор, лицензия, источник» with links only to http(s) addresses. @param {PublishedPlace["photo"]} photo */
function photoCaption(photo) {
  const author = text(photo?.author), license = text(photo?.license), licenseUrl = text(photo?.licenseUrl), sourceUrl = text(photo?.sourceUrl);
  const link = (/** @type {string} */ label, /** @type {string | undefined} */ url) => url && HTTP_URL.test(url) ? `<a href="${escape(url)}" rel="noopener">${escape(label)}</a>` : escape(label);
  const parts = [author ? `Фото: ${escape(author)}` : "", license ? link(license, licenseUrl) : "", sourceUrl && HTTP_URL.test(sourceUrl) ? link("источник", sourceUrl) : ""].filter(Boolean);
  return parts.length ? `<figcaption>${parts.join(" · ")}</figcaption>` : "";
}

/**
 * The place could not be read (the store failed): no preview tags, so a messenger does not cache a broken preview, and
 * the same way on to the map, which retries on its own.
 * @param {string} id
 * @param {unknown} [locale]
 */
export function shareUnavailableHtml(id, locale = "ru") {
  return `<!doctype html>
<html lang="ru">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${SITE_TITLE}</title></head>
<body><h1>Не удалось загрузить историю.</h1><p><a id="open" href="${escape(placeMapUrl(id, locale))}">Открыть историю на карте</a></p></body>
</html>
`;
}

/** A path under /place/ that names no place. */
export const SHARE_NOT_FOUND_HTML = `<!doctype html>
<html lang="ru">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${SITE_TITLE}</title></head>
<body><h1>Страница не найдена</h1><p><a href="/">Открыть карту историй</a></p></body>
</html>
`;
