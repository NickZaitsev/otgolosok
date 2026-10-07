import test from "node:test";
import assert from "node:assert/strict";
import { createStore } from "./store.mjs";
import { contentSourceHash, readContentLocale } from "./content-localization.mjs";
import { hydratePlaceTranslation, hydrateWalkTranslation, validatePlaceTranslation } from "./place-translations.mjs";

const source = { title: "Дом", address: "Москва, Арбат, 1", paragraphs: [{ text: "Дом построен в 1900 году.", factIds: ["f1"] }],
  sources: [{ id: "s1", title: "Архив", url: "https://example.org/archive", publisher: "Архив" }],
  facts: [{ id: "f1", claim: "Дом построен в 1900 году.", sourceIds: ["s1"] }], checkedAt: "2026-10-07" };
const draft = locale => ({ title: locale === "en" ? "The house" : "这座房屋", paragraphs: [locale === "en" ? "The house was built in 1900." : "这座房屋建于1900年。"],
  facts: { f1: locale === "en" ? "The house was built in 1900." : "这座房屋建于1900年。" } });
function fixture(t) {
  let now = Date.UTC(2026, 9, 7);
  const store = createStore(":memory:", { now: () => now++ });
  t.after(() => store.close());
  store.importPlaces({ sourceSha256: "a".repeat(64), places: [{ placeId: "osm:node:1", osmType: "node", osmId: 1, name: "Дом", location: { lat: 55.75, lon: 37.61 }, tags: { "addr:full": source.address } }] });
  store.createBatch({ requestKey: "translation-fixture", placeIds: ["osm:node:1"], limit: 1 });
  const job = store.claimContentJob();
  store.completeContentJob(job.id, { story: source, evidence: {}, verification: "editorial" });
  return store;
}
function save(store, locale = "en", replacement = draft(locale)) {
  const place = store.getPublishedPlace("osm:node:1");
  return store.savePlaceTranslation(place.id, { locale, sourceTextId: place.text.id, sourceStorySha256: contentSourceHash(place.text.story),
    story: hydratePlaceTranslation(place.text.story, replacement), provenance: { method: "editorial", author: "Тестовый редактор" } });
}
const approve = (store, row) => store.approvePlaceTranslation(row.id, { expectedRevision: row.revision, reviewer: "Редактор" });

test("locale query is finite, canonical and rejects duplicates", () => {
  for (const [query, expected] of [["", "ru"], ["lang=ru", "ru"], ["lang=en", "en"], ["lang=zh", "zh"]]) assert.equal(readContentLocale(new URLSearchParams(query)), expected);
  for (const query of ["lang=de", "lang=", "lang=zh-Hans", "lang=en&lang=en", "lang=__proto__"]) assert.throws(() => readContentLocale(new URLSearchParams(query)), { code: "BAD_REQUEST" });
  assert.equal(contentSourceHash({ b: 1, a: 2 }), contentSourceHash({ a: 2, b: 1 }));
});
for (const locale of ["en", "zh"]) test(`${locale}: draft, approval, revision and source change preserve Russian publication`, t => {
  const store = fixture(t), before = store.getPublishedPlace("osm:node:1"), row = save(store, locale);
  assert.equal(row.state, "draft");
  assert.equal(store.getPublishedPlace(before.id, { requestedLocale: locale }).text.localization.fallbackReason, "draft");
  assert.equal(save(store, locale).id, row.id);
  assert.throws(() => store.approvePlaceTranslation(row.id, { expectedRevision: 0, reviewer: "Редактор" }), { code: "CONFLICT" });
  const approved = approve(store, row);
  assert.equal(approve(store, row).approvedAt, approved.approvedAt);
  const translated = store.getPublishedPlace(before.id, { requestedLocale: locale });
  assert.equal(translated.text.story.paragraphs[0].text, draft(locale).paragraphs[0]);
  assert.equal(translated.text.localization.contentLocale, locale);
  assert.equal(translated.text.audio, null);
  assert.deepEqual(store.getPublishedPlace(before.id), before);
  const next = save(store, locale, { ...draft(locale), title: "Second edition" });
  assert.equal(store.getPublishedPlace(before.id, { requestedLocale: locale }).text.story.title, draft(locale).title);
  approve(store, next);
  assert.equal(store.getPublishedPlace(before.id, { requestedLocale: locale }).text.story.title, "Second edition");
  store.approvePlaceText(before.id, { ...source, title: "Новая редакция" });
  const stale = store.getPublishedPlace(before.id, { requestedLocale: locale });
  assert.equal(stale.text.story.title, "Новая редакция");
  assert.equal(stale.text.localization.contentLocale, "ru");
  assert.equal(stale.text.localization.fallbackReason, "stale");
  assert.throws(() => approve(store, next), { code: "CONFLICT" });
});
test("missing locale is explicit and source/provenance checks reject unsafe writes", t => {
  const store = fixture(t), place = store.getPublishedPlace("osm:node:1");
  assert.deepEqual(store.getPublishedPlace(place.id, { requestedLocale: "en" }).text.localization,
    { requestedLocale: "en", contentLocale: "ru", fallbackReason: "missing" });
  const input = { locale: "en", sourceTextId: place.text.id, sourceStorySha256: contentSourceHash(source), story: hydratePlaceTranslation(source, draft("en")), provenance: { method: "editorial", author: "Редактор" } };
  for (const change of [{ sourceTextId: "missing" }, { sourceStorySha256: "b".repeat(64) }]) assert.throws(() => store.savePlaceTranslation(place.id, { ...input, ...change }), { code: "CONFLICT" });
  for (const change of [{ locale: "ru" }, { locale: "de" }, { provenance: { ...input.provenance, token: "not-a-secret-fixture" } }]) assert.throws(() => store.savePlaceTranslation(place.id, { ...input, ...change }), { code: "BAD_REQUEST" });
});
test("translation cannot alter fact/source identity, URLs, paragraphs or address", () => {
  const translated = hydratePlaceTranslation(source, draft("en"));
  for (const mutate of [
    story => { story.sources[0].url = "https://example.org/invented"; },
    story => { story.paragraphs[0].factIds = []; },
    story => { story.facts[0].sourceIds = []; },
    story => { story.address = "Москва, Арбат, 2"; },
    story => { story.facts.push({ id: "f2", claim: "An invented fact", sourceIds: ["s1"] }); },
    story => { story.title = "<script>invalid</script>"; },
  ]) { const altered = structuredClone(translated); mutate(altered);
    assert.throws(() => validatePlaceTranslation(source, altered), { code: "BAD_REQUEST" });
  }
});
test("whole-story storage rejects altered source links before publication", t => {
  const store = fixture(t), place = store.getPublishedPlace("osm:node:1"), story = hydratePlaceTranslation(source, draft("en"));
  story.sources[0].url = "https://example.org/invented";
  assert.throws(() => store.savePlaceTranslation(place.id, { locale: "en", sourceTextId: place.text.id, sourceStorySha256: contentSourceHash(place.text.story), story,
    provenance: { method: "editorial", author: "Редактор" } }), { code: "BAD_REQUEST" });
  assert.equal(store.getPlaceTranslations(place.id).length, 0);
});
test("localized audio is bound to current approved translation and exact provenance", t => {
  const store = fixture(t), row = save(store); approve(store, row);
  const hash = "f".repeat(64), audio = { url: `/api/story-audio/${hash}.mp3`, sha256: hash, bytes: 1000, durationSec: 60,
    provider: "elevenlabs", model: "eleven_v4", voice: "voice-fixture", language: "en", synthetic: true,
    sourceTranslationId: row.id, sourceStorySha256: row.sourceStorySha256, translationHash: row.contentHash };
  for (const change of [{ language: "ru" }, { model: "eleven_v3" }, { voice: "other" }, { translationHash: "0".repeat(64) }, { bytes: 0 }, { durationSec: 301 }, { url: "/api/story-audio/wrong.mp3" }]) {
    assert.throws(() => store.savePlaceTranslationAudio(row.id, { ...audio, ...change }, { expectedRevision: row.revision, voice: audio.voice }), { code: "BAD_REQUEST" });
  }
  store.savePlaceTranslationAudio(row.id, audio, { expectedRevision: row.revision, voice: audio.voice });
  assert.equal(store.getPublishedPlace("osm:node:1", { requestedLocale: "en" }).text.audio.language, "en");
  assert.equal(store.getPublishedPlace("osm:node:1").text.audio, null);
  store.approvePlaceText("osm:node:1", { ...source, title: "Другой текст" });
  assert.throws(() => store.savePlaceTranslationAudio(row.id, audio, { expectedRevision: row.revision, voice: audio.voice }), { code: "CONFLICT" });
});
test("walk presentation is a projection and invalidates on any source document revision", t => {
  const store = fixture(t), document = { version: 2, id: "11111111-1111-4111-8111-111111111111", title: "Прогулка", description: "Описание", city: "Москва", mode: "open", minutes: 30,
    start: { address: source.address, location: { lat: 55.75, lon: 37.61 } }, stops: [{ id: "stop1", place: { address: source.address, location: { lat: 55.75, lon: 37.61 } }, storyRef: { kind: "osm", id: "osm:node:1" }, transition: "Идём", nextHint: "Прямо" }], route: null, fieldChecked: false };
  const content = { title: "A walk", description: "Description", stops: [{ id: "stop1", transition: "Let's walk", nextHint: "Straight ahead" }] };
  const row = store.saveWalkTranslation(document, { locale: "en", sourceHash: contentSourceHash(document), content, provenance: { method: "editorial", author: "Редактор" } });
  assert.equal(store.localizeWalkDocument(document, "en"), document);
  store.approveWalkTranslation(row.id, { document, expectedRevision: row.revision, reviewer: "Редактор" });
  const localized = store.localizeWalkDocument(document, "en");
  assert.equal(localized.title, "A walk"); assert.equal(localized.stops[0].nextHint, "Straight ahead");
  assert.deepEqual(localized.stops[0].place, document.stops[0].place);
  assert.equal(document.title, "Прогулка");
  const changed = { ...document, description: "Изменено" };
  assert.equal(store.localizeWalkDocument(changed, "en"), changed);
  assert.throws(() => store.approveWalkTranslation(row.id, { document: changed, expectedRevision: row.revision, reviewer: "Редактор" }), { code: "CONFLICT" });
  assert.throws(() => hydrateWalkTranslation(document, { ...content, stops: [{ ...content.stops[0], id: "another" }] }), { code: "BAD_REQUEST" });
});

test("returning to a replaced translation creates an auditable new revision", t => {
  const store = fixture(t), first = save(store); approve(store, first);
  const second = save(store, "en", { ...draft("en"), title: "Changed title" }); approve(store, second);
  const restored = save(store);
  assert.notEqual(restored.id, first.id);
  assert.equal(restored.revision, second.revision + 1);
  assert.equal(restored.state, "draft");
  approve(store, restored);
  assert.equal(store.getPublishedPlace("osm:node:1", { requestedLocale: "en" }).text.story.title, draft("en").title);
  assert.equal(store.getPlaceTranslations("osm:node:1").find(row => row.id === first.id).state, "stale");
});

test("walk fallback distinguishes missing, draft and changed source", t => {
  const store = fixture(t), document = { version: 2, id: "11111111-1111-4111-8111-111111111111", title: "Прогулка", description: "Описание", city: "Москва", mode: "open", minutes: 30,
    start: { address: source.address, location: { lat: 55.75, lon: 37.61 } }, stops: [{ id: "stop1", place: { address: source.address, location: { lat: 55.75, lon: 37.61 } }, storyRef: { kind: "osm", id: "osm:node:1" }, transition: "Идём", nextHint: "Прямо" }], route: null, fieldChecked: false };
  const content = { title: "A walk", description: "Description", stops: [{ id: "stop1", transition: "Let's walk", nextHint: "Straight ahead" }] };
  assert.equal(store.getWalkLocalization(document, "en").localization.fallbackReason, "missing");
  const row = store.saveWalkTranslation(document, { locale: "en", sourceHash: contentSourceHash(document), content, provenance: { method: "editorial", author: "Редактор" } });
  assert.equal(store.getWalkLocalization(document, "en").localization.fallbackReason, "draft");
  store.approveWalkTranslation(row.id, { document, expectedRevision: row.revision, reviewer: "Редактор" });
  assert.deepEqual(store.getWalkLocalization(document, "en").localization, { requestedLocale: "en", contentLocale: "en", fallbackReason: null });
  assert.equal(store.getWalkLocalization({ ...document, title: "Изменено" }, "en").localization.fallbackReason, "stale");
  const before = store.getPlaceTranslations("osm:node:1").length;
  const place = store.getPublishedPlace("osm:node:1"), input = { placeId: place.id, sourceTextId: place.text.id, sourceStorySha256: contentSourceHash(place.text.story), story: hydratePlaceTranslation(place.text.story, draft("en")) };
  assert.throws(() => store.importTranslationBundle({ document, sourceDocumentSha256: contentSourceHash(document), translations: [{ locale: "en", walkContent: content, provenance: { method: "machine", author: "Тест" }, entries: [input, { ...input, placeId: "missing" }] }] }), { code: "CONFLICT" });
  assert.equal(store.getPlaceTranslations(place.id).length, before, "whole batch rolls back on any source conflict");
});

for (const field of ["facts", "sources", "checkedAt", "address"]) test(`source approval invalidates translations when only ${field} changes`, t => {
  const store = fixture(t), before = store.getPublishedPlace("osm:node:1"), row = save(store); approve(store, row);
  const changed = structuredClone(before.text.story);
  if (field === "facts") changed.facts[0].claim = "Дом построен в другом году.";
  if (field === "sources") changed.sources[0].url = "https://example.org/corrected-source";
  if (field === "checkedAt") changed.checkedAt = "2026-10-08";
  if (field === "address") changed.address = "Москва, Арбат, 2";
  store.approvePlaceText(before.id, changed);
  const current = store.getPublishedPlace(before.id);
  assert.notEqual(current.text.id, before.text.id);
  assert.deepEqual(current.text.story, changed);
  assert.equal(store.getPublishedPlace(before.id, { requestedLocale: "en" }).text.localization.fallbackReason, "stale");
});
