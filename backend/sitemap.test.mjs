import test from "node:test";
import assert from "node:assert/strict";
import { INDEXABLE_WORDS } from "./place-share.mjs";
import { renderSitemap } from "./sitemap.mjs";

const origin = "https://otgolosok.test";
const long = { paragraphs: [{ text: Array.from({ length: INDEXABLE_WORDS }, (_, index) => `слово${index}`).join(" ") }] };
const locs = xml => [...xml.matchAll(/<loc>([^<]*)<\/loc>/g)].map(match => match[1]);

test("the sitemap lists the static pages and only the places whose story may go to search", () => {
  const xml = renderSitemap({ origin, places: [
    { id: "osm:node:1", verification: "editorial", story: long },
    { id: "osm:way:2", verification: "automatic", story: long },
    { id: "osm:node:3", verification: "automatic", story: { paragraphs: [{ text: "Коротко." }] } },
    { id: "osm:node:4", verification: "test_placeholder", story: long },
    { id: "osm:area:5", verification: "editorial", story: long },
  ] });
  assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>\n<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
  assert.deepEqual(locs(xml), [`${origin}/`, `${origin}/place/node/1`, `${origin}/place/way/2`]);
  // No lastmod: a generation date is not the date the page last changed.
  assert.doesNotMatch(xml, /lastmod/);
});

test("an empty catalog still lists the static pages", () => {
  assert.deepEqual(locs(renderSitemap({ origin, places: [] })), [`${origin}/`]);
});

test("more URLs than one sitemap file may hold is an error, not a silently cut list", () => {
  const places = Array.from({ length: 50_000 }, (_, index) => ({ id: `osm:node:${index + 1}`, verification: "editorial", story: long }));
  assert.throws(() => renderSitemap({ origin, places }), /sitemap index/);
});
