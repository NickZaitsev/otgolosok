import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { INDEXABLE_WORDS, SHARE_PAGE_CSP, isIndexablePlace, placeSharePath, renderPlaceSharePage, shareDescription, shareLocale, sharePathToPlaceId, shareUnavailableHtml, storyWordCount } from "./place-share.mjs";

const origin = "https://otgolosok.test";
const paragraph = text => ({ text, factIds: ["f1"] });
const published = (overrides = {}) => ({
  name: "Дом Пашкова", address: "ул. Воздвиженка, 3/5",
  text: { story: { title: "Дом Пашкова", paragraphs: [paragraph("Дворец на холме напротив Кремля."), paragraph("Второй абзац.")] } },
  photo: { src: `/api/place-images/${"a".repeat(64)}.jpg`, width: 1280, height: 960, alt: "Дом Пашкова с Моховой" },
  ...overrides,
});
const tag = (html, key) => new RegExp(`<meta (?:property|name)="${key}" content="([^"]*)">`).exec(html)?.[1];

for (const [path, id] of [
  ["/place/node/123", "osm:node:123"], ["/place/way/5", "osm:way:5"], ["/place/relation/5507698", "osm:relation:5507698"],
  ["/place/node/1234567890123456789", "osm:node:1234567890123456789"],
  ["/place/node/0", null], ["/place/node/0123", null], ["/place/node/12345678901234567890", null], ["/place/area/1", null],
  ["/place/node/1/", null], ["/place/node/", null], ["/place/node/1.5", null], ["/place/osm:node:1", null],
]) test(`share path ${path} → ${id}`, () => assert.equal(sharePathToPlaceId(path), id));

test("shared-link locale accepts only public UI languages", () => {
  assert.equal(shareLocale("en"), "en");
  assert.equal(shareLocale("zh"), "zh");
  for (const value of [null, undefined, "", "ru", "EN", "unknown"]) assert.equal(shareLocale(value), "ru");
});

test("the description is the first paragraph, cut at a word for a messenger preview", () => {
  assert.equal(shareDescription({ paragraphs: [paragraph("  Короткий\n рассказ.  ")] }, "адрес"), "Короткий рассказ.");
  assert.equal(shareDescription({ paragraphs: [{ text: 5 }, paragraph(""), paragraph("Второй.")] }, "адрес"), "Второй.");
  assert.equal(shareDescription({ paragraphs: [] }, "адрес"), "адрес");
  assert.equal(shareDescription(null, "адрес"), "адрес");
  const long = shareDescription({ paragraphs: [paragraph("Слово, ".repeat(60))] }, "адрес");
  assert.ok(long.length <= 200, String(long.length));
  assert.match(long, /^Слово, (?:Слово, )*Слово…$/);
  // One very long word cannot be cut at a space: it is cut where the limit falls.
  const word = shareDescription({ paragraphs: [paragraph("а".repeat(300))] }, "адрес");
  assert.equal(word, `${"а".repeat(199)}…`);
});

test("a published place carries its title, text, photo and the map link", () => {
  const { status, html } = renderPlaceSharePage({ id: "osm:way:5", place: published(), origin });
  assert.equal(status, 200);
  assert.equal(tag(html, "og:title"), "Дом Пашкова");
  assert.equal(tag(html, "og:description"), "Дворец на холме напротив Кремля.");
  assert.equal(tag(html, "og:url"), "https://otgolosok.test/place/way/5");
  assert.equal(tag(html, "og:image"), `https://otgolosok.test/api/place-images/${"a".repeat(64)}.jpg`);
  assert.deepEqual([tag(html, "og:image:width"), tag(html, "og:image:height"), tag(html, "og:image:alt")], ["1280", "960", "Дом Пашкова с Моховой"]);
  assert.equal(tag(html, "twitter:card"), "summary_large_image");
  assert.equal(tag(html, "og:site_name"), "Отголосок");
  assert.match(html, /<title>Дом Пашкова — Отголосок<\/title>/);
  assert.match(html, /<link rel="canonical" href="https:\/\/otgolosok\.test\/place\/way\/5">/);
  assert.match(html, /<a id="open" class="open" href="\/\?place=osm:way:5">Слушать на карте<\/a>/);
});

test("English and Chinese shared links keep their UI language while story metadata stays Russian", () => {
  for (const locale of ["en", "zh"]) {
    const { html } = renderPlaceSharePage({ id: "osm:way:5", place: published(), origin, locale });
    assert.equal(tag(html, "og:title"), "Дом Пашкова");
    assert.equal(tag(html, "og:description"), "Дворец на холме напротив Кремля.");
    assert.equal(tag(html, "og:url"), `${origin}/place/way/5?lang=${locale}`);
    assert.match(html, new RegExp(`<a id="open" class="open" href="/${locale}\\?place=osm:way:5">`));
    // One page in search for every UI language: the story text is the same.
    assert.match(html, /<link rel="canonical" href="https:\/\/otgolosok\.test\/place\/way\/5">/);
  }
  assert.match(shareUnavailableHtml("osm:node:8", "zh"), /href="\/zh\?place=osm:node:8"/);
});

test("the page runs no scripts: its only inline style is allowed by hash and JSON-LD is inert data", () => {
  const { html } = renderPlaceSharePage({ id: "osm:node:1", place: published(), origin });
  assert.doesNotMatch(html, /<script>/);
  assert.doesNotMatch(html, /location\.replace|http-equiv="refresh"/);
  assert.match(SHARE_PAGE_CSP, /default-src 'none'/);
  assert.doesNotMatch(SHARE_PAGE_CSP, /script-src/);
  const styles = [...html.matchAll(/<style>([^<]*)<\/style>/g)].map(match => match[1]);
  assert.equal(styles.length, 1);
  assert.match(SHARE_PAGE_CSP, new RegExp(`style-src 'sha256-${createHash("sha256").update(styles[0]).digest("base64").replace(/[+/]/g, "\\$&")}'`));
  assert.equal([...html.matchAll(/<script type="application\/ld\+json">/g)].length, 1);
});

for (const [name, photo, image, card] of [
  ["an editorial photo", { src: "/images/places/relation-1-46765eae7280.jpg", width: 1280, height: 960 }, "https://otgolosok.test/images/places/relation-1-46765eae7280.jpg", "summary_large_image"],
  ["no photo", null, "https://otgolosok.test/icons/icon-512.png", "summary"],
  ["a photo on another host", { src: "https://evil.test/a.jpg", width: 10, height: 10 }, "https://otgolosok.test/icons/icon-512.png", "summary"],
  ["a photo path outside the photo stores", { src: "/api/place-images/../secret.jpg", width: 10, height: 10 }, "https://otgolosok.test/icons/icon-512.png", "summary"],
  ["a photo without a size", { src: `/api/place-images/${"b".repeat(64)}.jpg`, width: null, height: 960 }, "https://otgolosok.test/icons/icon-512.png", "summary"],
]) test(`preview image for ${name}`, () => {
  const { html } = renderPlaceSharePage({ id: "osm:node:1", place: published({ photo }), origin });
  assert.equal(tag(html, "og:image"), image);
  assert.equal(tag(html, "twitter:card"), card);
});

test("text from the catalog is escaped everywhere it lands", () => {
  const place = published({ text: { story: { title: `Дом "Пашкова" <script>alert(1)</script> & 'сад'`, paragraphs: [paragraph("<img src=x onerror=alert(1)>")] } } });
  const { html } = renderPlaceSharePage({ id: "osm:node:1", place, origin });
  assert.equal(tag(html, "og:title"), "Дом &quot;Пашкова&quot; &lt;script&gt;alert(1)&lt;/script&gt; &amp; &#39;сад&#39;");
  assert.match(html, /<h1>Дом &quot;Пашкова&quot; &lt;script&gt;/);
  assert.match(html, /<p>&lt;img src=x onerror=alert\(1\)&gt;<\/p>/);
  assert.doesNotMatch(html, /<script>/);
  assert.doesNotMatch(html, /<\/script><script/);
});

test("a place without a story title or text falls back to its name and address", () => {
  const { html } = renderPlaceSharePage({ id: "osm:node:1", place: published({ text: { story: { paragraphs: [] } } }), origin });
  assert.equal(tag(html, "og:title"), "Дом Пашкова");
  assert.equal(tag(html, "og:description"), "ул. Воздвиженка, 3/5");
});

test("a place that is gone answers 404 with the site's tags and still opens the map", () => {
  const { status, html } = renderPlaceSharePage({ id: "osm:relation:9", place: null, origin });
  assert.equal(status, 404);
  assert.equal(tag(html, "og:title"), "Отголосок — город говорит рядом");
  assert.equal(tag(html, "og:description"), "Эта история больше недоступна.");
  assert.equal(tag(html, "og:image"), "https://otgolosok.test/icons/icon-512.png");
  assert.match(html, /href="\/\?place=osm:relation:9"/);
});

const words = count => Array.from({ length: count }, (_, index) => `слово${index}`).join(" ");
const jsonLdOf = html => JSON.parse(/<script type="application\/ld\+json">([^<]*)<\/script>/.exec(html)[1]);
const story = (overrides = {}) => published({
  location: { lat: 55.7494, lon: 37.6093 },
  text: {
    verification: "editorial", createdAt: "2026-10-05T09:30:00.000Z",
    audio: { url: `/api/story-audio/${"e".repeat(64)}.mp3`, durationSec: 95.976 },
    story: {
      title: "Дворец напротив Кремля",
      paragraphs: [paragraph("Дом Пашкова стоит на Ваганьковском холме."), paragraph(words(INDEXABLE_WORDS))],
      sources: [
        { id: "s1", title: "Описание дома", url: "https://example.org/pashkov", publisher: "Музей" },
        { id: "s2", title: "Без ссылки", url: "javascript:alert(1)" },
      ],
    },
  },
  ...overrides,
});

for (const [paths, id] of [["/place/node/123", "osm:node:123"], ["/place/relation/7", "osm:relation:7"]]) {
  test(`place path of ${id}`, () => assert.equal(placeSharePath(id), paths));
}
for (const id of ["osm:area:1", "osm:node:0", "node:1", 5, null]) test(`no place path for ${String(id)}`, () => assert.equal(placeSharePath(id), null));

test("a story goes to search only from the word limit and never as a test placeholder", () => {
  const of = count => ({ paragraphs: [paragraph(words(count))] });
  assert.equal(storyWordCount({ paragraphs: [paragraph("Два слова — и тире")] }), 4);
  assert.equal(isIndexablePlace({ story: of(INDEXABLE_WORDS - 1), verification: "editorial" }), false);
  assert.equal(isIndexablePlace({ story: of(INDEXABLE_WORDS), verification: "editorial" }), true);
  assert.equal(isIndexablePlace({ story: of(INDEXABLE_WORDS), verification: "automatic" }), true);
  assert.equal(isIndexablePlace({ story: of(500), verification: "test_placeholder" }), false);
  assert.equal(isIndexablePlace({ story: null, verification: null }), false);
});

test("the page carries the whole story, its recording, photo credits and sources for people and crawlers alike", () => {
  const { status, html } = renderPlaceSharePage({ id: "osm:way:5", place: story(), origin });
  assert.equal(status, 200);
  assert.match(html, /<title>Дворец напротив Кремля\. Дом Пашкова — Отголосок<\/title>/);
  assert.match(html, /<h1>Дворец напротив Кремля<\/h1>\n<p class="place">Дом Пашкова · ул\. Воздвиженка, 3\/5<\/p>/);
  assert.match(html, /<p>Дом Пашкова стоит на Ваганьковском холме\.<\/p>\n<p>слово0 /);
  assert.match(html, new RegExp(`<audio controls preload="none" src="/api/story-audio/${"e".repeat(64)}\\.mp3"></audio>`));
  assert.match(html, /Послушать историю · 1 мин 36 с/);
  assert.match(html, /<img src="\/api\/place-images\/a{64}\.jpg" width="1280" height="960" alt="Дом Пашкова с Моховой"/);
  assert.match(html, /<li><a href="https:\/\/example\.org\/pashkov" rel="noopener">Описание дома<\/a> <span class="publisher">— Музей<\/span><\/li>/);
  assert.doesNotMatch(html, /javascript:/);
  assert.doesNotMatch(html, /name="robots"/);
  assert.equal(tag(html, "og:type"), "article");
});

test("structured data describes the article, the place, its recording and the breadcrumbs", () => {
  const { html } = renderPlaceSharePage({ id: "osm:way:5", place: story(), origin });
  const [article, breadcrumbs] = jsonLdOf(html)["@graph"];
  assert.equal(article["@type"], "Article");
  assert.equal(article.headline, "Дворец напротив Кремля. Дом Пашкова");
  assert.equal(article.url, `${origin}/place/way/5`);
  // The store knows when a text was generated, not when it was approved: no dates rather than wrong ones.
  assert.equal(article.datePublished, undefined);
  assert.equal(article.dateModified, undefined);
  assert.deepEqual(article.image, [`${origin}/api/place-images/${"a".repeat(64)}.jpg`]);
  assert.deepEqual(article.about, { "@type": "TouristAttraction", name: "Дом Пашкова", address: "ул. Воздвиженка, 3/5", geo: { "@type": "GeoCoordinates", latitude: 55.7494, longitude: 37.6093 } });
  assert.deepEqual(article.audio, { "@type": "AudioObject", contentUrl: `${origin}/api/story-audio/${"e".repeat(64)}.mp3`, encodingFormat: "audio/mpeg", inLanguage: "ru", duration: "PT1M36S" });
  assert.deepEqual(article.citation, ["https://example.org/pashkov"]);
  assert.deepEqual(breadcrumbs.itemListElement.map(item => item.item), [`${origin}/`, `${origin}/place/way/5`]);
});

test("without a photo of the place the article has no image: the site logo stays only in the messenger preview", () => {
  const { html } = renderPlaceSharePage({ id: "osm:way:5", place: story({ photo: null }), origin });
  assert.equal(jsonLdOf(html)["@graph"][0].image, undefined);
  assert.equal(tag(html, "og:image"), "https://otgolosok.test/icons/icon-512.png");
  assert.doesNotMatch(html, /<figure>/);
});

test("a title that already names the place is not repeated", () => {
  const { html } = renderPlaceSharePage({ id: "osm:way:5", place: published(), origin });
  assert.match(html, /<title>Дом Пашкова — Отголосок<\/title>/);
  assert.match(html, /<p class="place">ул\. Воздвиженка, 3\/5<\/p>/);
});

test("a thin story is served to people but kept out of search", () => {
  const { status, html } = renderPlaceSharePage({ id: "osm:way:5", place: published(), origin });
  assert.equal(status, 200);
  assert.equal(tag(html, "robots"), "noindex, follow");
  const placeholder = story();
  placeholder.text.verification = "test_placeholder";
  assert.equal(tag(renderPlaceSharePage({ id: "osm:way:5", place: placeholder, origin }).html, "robots"), "noindex, follow");
});

for (const [name, audio] of [
  ["a recording on another host", { url: "https://evil.test/a.mp3", durationSec: 10 }],
  ["a recording path outside the audio store", { url: "/api/story-audio/../secret.mp3", durationSec: 10 }],
  ["no recording", null],
]) test(`no player for ${name}`, () => {
  const place = story();
  place.text.audio = audio;
  const { html } = renderPlaceSharePage({ id: "osm:way:5", place, origin });
  assert.doesNotMatch(html, /<audio/);
  assert.equal(jsonLdOf(html)["@graph"][0].audio, undefined);
});

test("nearby places link to their own pages, skipping the place itself and malformed entries", () => {
  const nearby = [
    { id: "osm:node:2", title: "Румянцевский музей", distanceM: 120 },
    { id: "osm:way:5", title: "Сам дом", distanceM: 0 },
    { id: "javascript:alert(1)", title: "Ловушка", distanceM: 5 },
    { id: "osm:node:3", title: "  ", distanceM: 30 },
  ];
  const { html } = renderPlaceSharePage({ id: "osm:way:5", place: story(), origin, nearby });
  assert.match(html, /<nav aria-label="Истории рядом"><h2>Рядом<\/h2>\n<ul><li><a href="\/place\/node\/2">Румянцевский музей<\/a> <span class="publisher">· 120 м<\/span><\/li><\/ul><\/nav>/);
  assert.doesNotMatch(html, /Сам дом|Ловушка/);
  assert.doesNotMatch(renderPlaceSharePage({ id: "osm:way:5", place: story(), origin }).html, /Истории рядом/);
});

test("photo credits link only to web addresses", () => {
  const place = story({ photo: { src: `/api/place-images/${"a".repeat(64)}.jpg`, width: 1280, height: 960, alt: "Фасад",
    author: "Иван Петров", license: "CC BY-SA 4.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/", sourceUrl: "javascript:alert(1)" } });
  const { html } = renderPlaceSharePage({ id: "osm:way:5", place, origin });
  assert.match(html, /<figcaption>Фото: Иван Петров · <a href="https:\/\/creativecommons\.org\/licenses\/by-sa\/4\.0\/" rel="noopener">CC BY-SA 4\.0<\/a><\/figcaption>/);
});

test("structured data cannot close its script element", () => {
  const place = story();
  place.text.story.title = "</script><script>alert(1)</script>";
  const { html } = renderPlaceSharePage({ id: "osm:way:5", place, origin });
  const block = /<script type="application\/ld\+json">([^<]*)<\/script>/.exec(html);
  assert.ok(block, "the JSON-LD block stays whole");
  assert.equal(jsonLdOf(html)["@graph"][0].headline, "</script><script>alert(1)</script>. Дом Пашкова");
});

test("a page that failed to load is kept out of search", () => {
  assert.match(shareUnavailableHtml("osm:node:8"), /<meta name="robots" content="noindex">/);
});
