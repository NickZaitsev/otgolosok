import test from "node:test";
import assert from "node:assert/strict";
import { INDEXABLE_WORDS } from "./place-share.mjs";
import { renderSitemap } from "./sitemap.mjs";

const origin = "https://otgolosok.test";
const long = { paragraphs: [{ text: Array.from({ length: INDEXABLE_WORDS }, (_, index) => `слово${index}`).join(" ") }] };
const locs = xml => [...xml.matchAll(/<loc>([^<]*)<\/loc>/g)].map(match => match[1]);

test("the sitemap lists the static pages and only the places whose story may go to search", () => {
  const xml = renderSitemap({ origin, places: [
    { id: "osm:node:1", updatedAt: "2026-10-05T09:30:00.000Z", verification: "editorial", story: long },
    { id: "osm:way:2", updatedAt: "2026-10-06T23:59:59.000Z", verification: "automatic", story: long },
    { id: "osm:node:3", updatedAt: "2026-10-06T00:00:00.000Z", verification: "automatic", story: { paragraphs: [{ text: "Коротко." }] } },
    { id: "osm:node:4", updatedAt: "2026-10-06T00:00:00.000Z", verification: "test_placeholder", story: long },
    { id: "osm:area:5", updatedAt: "2026-10-06T00:00:00.000Z", verification: "editorial", story: long },
  ] });
  assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>\n<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
  assert.deepEqual(locs(xml), [`${origin}/`, `${origin}/trends`, `${origin}/place/node/1`, `${origin}/place/way/2`]);
  assert.match(xml, /<loc>https:\/\/otgolosok\.test\/place\/node\/1<\/loc><lastmod>2026-10-05<\/lastmod>/);
  assert.match(xml, /<loc>https:\/\/otgolosok\.test\/place\/way\/2<\/loc><lastmod>2026-10-06<\/lastmod>/);
});

test("a place without a valid date is listed without lastmod", () => {
  const xml = renderSitemap({ origin, places: [{ id: "osm:node:1", updatedAt: "вчера", verification: "editorial", story: long }] });
  assert.match(xml, /<url><loc>https:\/\/otgolosok\.test\/place\/node\/1<\/loc><\/url>/);
});

test("an empty catalog still lists the static pages", () => {
  assert.deepEqual(locs(renderSitemap({ origin, places: [] })), [`${origin}/`, `${origin}/trends`]);
});

test("more URLs than one sitemap file may hold is an error, not a silently cut list", () => {
  const places = Array.from({ length: 50_000 }, (_, index) => ({ id: `osm:node:${index + 1}`, verification: "editorial", story: long }));
  assert.throws(() => renderSitemap({ origin, places }), /sitemap index/);
});
