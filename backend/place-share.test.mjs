import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { SHARE_PAGE_CSP, renderPlaceSharePage, shareDescription, sharePathToPlaceId } from "./place-share.mjs";

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
  assert.match(html, /<a id="open" href="\/\?place=osm:way:5">Открыть историю на карте<\/a>/);
});

test("the inline redirect is the one script the page policy allows", () => {
  const { html } = renderPlaceSharePage({ id: "osm:node:1", place: published(), origin });
  const scripts = [...html.matchAll(/<script>([^<]*)<\/script>/g)].map(match => match[1]);
  assert.equal(scripts.length, 1);
  assert.match(SHARE_PAGE_CSP, new RegExp(`script-src 'sha256-${createHash("sha256").update(scripts[0]).digest("base64").replace(/[+/]/g, "\\$&")}'`));
  assert.match(SHARE_PAGE_CSP, /default-src 'none'/);
  assert.doesNotMatch(html, /http-equiv="refresh"/);
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
  assert.equal([...html.matchAll(/<script>/g)].length, 1);
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
