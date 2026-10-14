import test from "node:test";
import assert from "node:assert/strict";
import { INDEXABLE_WORDS } from "./place-share.mjs";
import { CATALOG_PAGE_CSP, PAGE_SIZE, buildCatalog, catalogPaths, cityCatalogPath, pageCount, parseCatalogPath, renderCatalogIndex, renderCityCatalogPage } from "./places-catalog.mjs";

const origin = "https://otgolosok.test";
const story = (title, extra = "") => ({ title, paragraphs: [{ text: `${extra} ${Array.from({ length: INDEXABLE_WORDS }, (_, index) => `слово${index}`).join(" ")}` }] });
const moscow = { lat: 55.75, lon: 37.62 }, kazan = { lat: 55.79, lon: 49.12 };
/** @param {number} number @param {object} [over] */
const place = (number, over = {}) => ({ id: `osm:node:${number}`, name: `Место ${number}`, address: "Москва", ...moscow, verification: "editorial", story: story(`История ${number}`), ...over });

test("pages count from one and the page size is a plain divisor", () => {
  assert.deepEqual([0, 1, PAGE_SIZE, PAGE_SIZE + 1].map(pageCount), [1, 1, 1, 2]);
});

test("a catalog path is the city for page one and the city with a number after it", () => {
  assert.equal(cityCatalogPath("moscow"), "/places/moscow");
  assert.equal(cityCatalogPath("moscow", 3), "/places/moscow/3");
});

test("only catalog URLs parse, one per page (no page 1 suffix, no zero, no leading zeros)", () => {
  assert.deepEqual(parseCatalogPath("/places"), { kind: "index" });
  assert.deepEqual(parseCatalogPath("/places/moscow"), { kind: "city", cityId: "moscow", page: 1 });
  assert.deepEqual(parseCatalogPath("/places/kazan/12"), { kind: "city", cityId: "kazan", page: 12 });
  for (const path of ["/places/", "/places/moscow/", "/places/moscow/1", "/places/moscow/0", "/places/moscow/02", "/places/moscow/2/3", "/places/Moscow", "/placesx", "/places/mos-cow"])
    assert.equal(parseCatalogPath(path), null, path);
});

test("the catalog groups indexable stories by the city that holds them and orders them by title", () => {
  const catalog = buildCatalog([
    place(1, { story: story("Яблоня") }), place(2, { story: story("Арка") }), place(3, { story: story("Арка") }),
    place(4, { ...kazan, story: story("Кремль") }),
    place(5, { story: { paragraphs: [{ text: "Коротко." }] } }),
    place(6, { verification: "test_placeholder" }),
    place(7, { lat: 0, lon: 0 }),
    place(8, { story: null }),
    { ...place(9), id: "osm:area:9" },
  ]);
  assert.deepEqual(catalog.map(item => [item.city.id, item.entries.map(entry => entry.id)]), [["moscow", ["osm:node:2", "osm:node:3", "osm:node:1"]], ["kazan", ["osm:node:4"]]]);
});

test("an entry shows the place name only when the title does not already name it", () => {
  const [{ entries }] = buildCatalog([place(1, { name: "Арка", story: story("Арка и двор"), address: "Москва, Тверская улица, 1" }), place(2, { name: "Дом", story: story("Здесь жил поэт"), address: null })]);
  assert.equal(entries[0].subject, "Москва, Тверская улица, 1");
  assert.equal(entries[1].subject, "Дом");
});

test("the paths are the index and each page of each city, nothing for a city without stories", () => {
  const places = Array.from({ length: PAGE_SIZE + 1 }, (_, index) => place(index + 1));
  assert.deepEqual(catalogPaths(buildCatalog(places)), ["/places", "/places/moscow", "/places/moscow/2"]);
  assert.deepEqual(catalogPaths(buildCatalog([])), ["/places"]);
});

test("the index lists the cities with their story counts, or says there are none", () => {
  const html = renderCatalogIndex({ origin, catalog: buildCatalog([place(1), place(2), place(3, kazan)]) });
  assert.match(html, /<link rel="canonical" href="https:\/\/otgolosok\.test\/places">/);
  assert.match(html, /<a href="\/places\/moscow">Москва<\/a> <span class="publisher">· 2 истории<\/span>/);
  assert.match(html, /<a href="\/places\/kazan">Казань<\/a> <span class="publisher">· 1 история<\/span>/);
  assert.match(renderCatalogIndex({ origin, catalog: [] }), /Истории пока не опубликованы/);
});

test("a page lists its slice with plain links, and previous and next links only where they lead somewhere", () => {
  const [{ city, entries }] = buildCatalog(Array.from({ length: PAGE_SIZE * 2 + 1 }, (_, index) => place(index + 1, { story: story(`История ${String(index + 1).padStart(3, "0")}`) })));
  const first = renderCityCatalogPage({ origin, city, entries, page: 1 });
  assert.equal(first.match(/<li><a href="\/place\//g)?.length, PAGE_SIZE);
  assert.match(first, /<link rel="canonical" href="https:\/\/otgolosok\.test\/places\/moscow">/);
  assert.match(first, /Страница 1 из 3/);
  assert.match(first, /<a href="\/places\/moscow\/2">Далее →<\/a>/);
  assert.doesNotMatch(first, /Назад/);
  const second = renderCityCatalogPage({ origin, city, entries, page: 2 });
  assert.match(second, /<title>Аудиоистории: Москва, страница 2 — Отголосок<\/title>/);
  assert.match(second, /<link rel="canonical" href="https:\/\/otgolosok\.test\/places\/moscow\/2">/);
  assert.match(second, /<a href="\/places\/moscow">← Назад<\/a>/);
  assert.match(second, /<a href="\/places\/moscow\/3">Далее →<\/a>/);
  const last = renderCityCatalogPage({ origin, city, entries, page: 3 });
  assert.equal(last.match(/<li><a href="\/place\//g)?.length, 1);
  assert.doesNotMatch(last, /Далее/);
  // Every story is reachable and listed exactly once across the pages.
  const listed = [first, second, last].flatMap(html => [...html.matchAll(/<li><a href="(\/place\/[^"]+)"/g)].map(match => match[1]));
  assert.equal(new Set(listed).size, PAGE_SIZE * 2 + 1);
});

test("a single page has no pager", () => {
  const [{ city, entries }] = buildCatalog([place(1)]);
  assert.doesNotMatch(renderCityCatalogPage({ origin, city, entries, page: 1 }), /<nav class="pager"|Страница 1 из/);
});

test("titles, places and descriptions are escaped, and the page stays script-free", () => {
  const evil = `<img src=x onerror=alert(1)> & "q"`;
  const [{ city, entries }] = buildCatalog([place(1, { name: evil, address: evil, story: { title: evil, paragraphs: [{ text: `${evil} ${Array.from({ length: INDEXABLE_WORDS }, () => "слово").join(" ")}` }] } })]);
  const html = renderCityCatalogPage({ origin, city, entries, page: 1 });
  assert.doesNotMatch(html, /<img|<script/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt; &amp; &quot;q&quot;/);
  assert.doesNotMatch(CATALOG_PAGE_CSP, /script-src|unsafe/);
  assert.match(CATALOG_PAGE_CSP, /default-src 'none'/);
});
