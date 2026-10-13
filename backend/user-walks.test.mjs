import test from "node:test";
import assert from "node:assert/strict";
import { createStore } from "./store.mjs";
import { resolveWalkView } from "./user-walks.mjs";
import { validateWalkDocument } from "./walk-document.mjs";
import { catalogWalkView } from "./walk-catalog.mjs";

const id = "11111111-1111-4111-8111-111111111111";
const first = "22222222-2222-4222-8222-222222222222";
const second = "33333333-3333-4333-8333-333333333333";
const p = (address, lat, lon) => ({ address, location: { lat, lon } });
const a = p("Москва, Арбат, 1", 55.75, 37.60);
const b = p("Москва, Арбат, 10", 55.751, 37.601);
const c = p("Москва, Арбат, 20", 55.752, 37.602);

test("the same document produces an ordered partially ready view without exposing private job data", () => {
  const store = createStore(":memory:");
  try {
    const job = store.createOrGet({ key: "one", address: b.address });
    const document = validateWalkDocument({ version: 2, id, title: "Арбат", description: "", city: "Москва", mode: "open", minutes: 30, start: a,
      stops: [{ id: first, place: b, storyRef: { kind: "job", id: job.id }, transition: "", nextHint: "" },
        { id: second, place: c, storyRef: null, transition: "", nextHint: "" }],
      route: { geometry: [a.location, b.location, c.location], distanceM: 330, walkingMinutes: 4, attribution: "OSM" }, fieldChecked: false });
    const view = resolveWalkView(document, 0, store);
    assert.deepEqual(view.chapters.map(item => item.id), [first, second]);
    assert.deepEqual(view.chapters.map(item => item.status), ["preparing", "not_requested"]);
    assert.equal(JSON.stringify(view).includes(job.key), false);
    assert.equal(JSON.stringify(view).includes("recoveryToken"), false);
  } finally { store.close(); }
});

test("a catalog chapter reference resolves through the current editorial publication", () => {
  const store = createStore(":memory:");
  try {
    const route = store.getPublishedWalk("msk-kozhevniki-zindel-short");
    assert.ok(route);
    const document = catalogWalkView(route).document;
    const view = resolveWalkView(document, 3, store);
    assert.equal(view.chapters.length, route.walk.steps.length);
    assert.equal(view.chapters[0].status, "ready");
    assert.ok(view.chapters[0].story?.sources.length);
  } finally { store.close(); }
});

test("an English place story never inherits the Russian recording", () => {
  const hash = "a".repeat(64);
  const document = validateWalkDocument({ version: 2, id, title: "Арбат", description: "", city: "Москва", mode: "open", minutes: 30, start: a,
    stops: [{ id: first, place: b, storyRef: { kind: "osm", id: "osm:node:1" }, transition: "", nextHint: "" }], route: null, fieldChecked: false });
  const russianStory = { title: "Дом", address: b.address, paragraphs: [{ text: "Русская история.", factIds: [] }], sources: [], facts: [] };
  const englishStory = { ...russianStory, title: "House", paragraphs: [{ text: "An English story.", factIds: [] }] };
  const store = {
    getPublishedPlace(_placeId, options) {
      return { id: "osm:node:1", name: "Дом", address: b.address, location: b.location, text: options?.requestedLocale === "en"
        ? { story: englishStory, audio: { url: `/api/story-audio/${hash}.mp3`, sha256: hash, durationSec: 30 },
          localization: { requestedLocale: "en", contentLocale: "en", fallbackReason: null } }
        : { story: russianStory, audio: { url: `/api/story-audio/${hash}.mp3`, sha256: hash, durationSec: 30 } } };
    },
  };
  const view = resolveWalkView(document, 0, store, { requestedLocale: "en" });
  assert.equal(view.requestedLocale, "en");
  assert.equal(view.chapters[0].story.title, "House");
  assert.equal(view.chapters[0].audio, null);
  assert.deepEqual(view.chapters[0].localization, { requestedLocale: "en", contentLocale: "en", fallbackReason: null });
  assert.equal("requestedLocale" in resolveWalkView(document, 0, store), false);
});

test("a missing translation exposes the Russian fallback and its language", () => {
  const hash = "b".repeat(64);
  const document = validateWalkDocument({ version: 2, id, title: "Арбат", description: "", city: "Москва", mode: "open", minutes: 30, start: a,
    stops: [{ id: first, place: b, storyRef: { kind: "osm", id: "osm:node:1" }, transition: "", nextHint: "" }], route: null, fieldChecked: false });
  const story = { title: "Дом", address: b.address, paragraphs: [{ text: "Русская история.", factIds: [] }], sources: [], facts: [] };
  const store = { getPublishedPlace: () => ({ id: "osm:node:1", name: "Дом", address: b.address, location: b.location, text: { story,
    audio: { url: `/api/story-audio/${hash}.mp3`, sha256: hash, durationSec: 30, language: "ru" }, localization: { requestedLocale: "zh", contentLocale: "ru", fallbackReason: "draft" } } }) };
  const chapter = resolveWalkView(document, 0, store, { requestedLocale: "zh" }).chapters[0];
  assert.equal(chapter.story.title, "Дом");
  assert.equal(chapter.audio.language, "ru");
  assert.deepEqual(chapter.localization, { requestedLocale: "zh", contentLocale: "ru", fallbackReason: "draft" });
});

test("translated walk labels keep the source document beside the display projection", () => {
  const document = validateWalkDocument({ version: 2, id, title: "Арбат", description: "Русское описание", city: "Москва", mode: "open", minutes: 30, start: a,
    stops: [{ id: first, place: b, storyRef: null, transition: "Идите прямо.", nextHint: "Дом слева." }], route: null, fieldChecked: false });
  const store = { getWalkLocalization(source, locale) { return { document: { ...source, title: "Arbat", description: "English description",
    stops: source.stops.map(stop => ({ ...stop, transition: "Continue straight.", nextHint: "The house is on the left." })) },
    localization: { requestedLocale: locale, contentLocale: locale, fallbackReason: null } }; } };
  const view = resolveWalkView(document, 2, store, { requestedLocale: "en" });
  assert.equal(view.document.title, "Arbat");
  assert.equal(view.sourceDocument.title, "Арбат");
  assert.deepEqual(view.documentLocalization, { requestedLocale: "en", contentLocale: "en", fallbackReason: null });

  const fallback = resolveWalkView(document, 2, { getWalkLocalization(source, locale) { return { document: source,
    localization: { requestedLocale: locale, contentLocale: "ru", fallbackReason: "stale" } }; } }, { requestedLocale: "en" });
  assert.equal("sourceDocument" in fallback, false);
  assert.equal(fallback.document, document);
  assert.deepEqual(fallback.documentLocalization, { requestedLocale: "en", contentLocale: "ru", fallbackReason: "stale" });
});

test("a published job stays on the walk with its previous text and recording while a revoice runs or after it fails", () => {
  const store = createStore(":memory:");
  try {
    let job = store.createOrGet({ key: "published", address: b.address });
    const words = text => `${text} ${"слово ".repeat(60).trim()}`;
    const story = { title: "Дом", paragraphs: [{ text: words("Прежний текст."), factIds: [] }, { text: words("Второй абзац."), factIds: [] }] };
    const audio = { url: `/api/story-audio/${"a".repeat(64)}.mp3`, sha256: "a".repeat(64), durationSec: 90 };
    job = store.update(job.id, { stage: "ready", data: { story, audio } }, job.revision);
    const document = validateWalkDocument({ version: 2, id, title: "Арбат", description: "", city: "Москва", mode: "open", minutes: 30, start: a,
      stops: [{ id: first, place: b, storyRef: { kind: "job", id: job.id }, transition: "", nextHint: "" }],
      route: { geometry: [a.location, b.location], distanceM: 110, walkingMinutes: 2, attribution: "OSM" }, fieldChecked: false });
    const published = resolveWalkView(document, 0, store).chapters[0];
    assert.equal(published.status, "ready");

    // An editor replaces the text together with the revoice request: the new text must not appear before its recording.
    job = store.revoiceAdmin(job.id, job.revision, "openai", null);
    job = store.update(job.id, { data: { ...job.data, story: { ...story, paragraphs: [{ text: words("Новый текст."), factIds: [] }, story.paragraphs[1]] } } }, job.revision);
    assert.deepEqual(resolveWalkView(document, 0, store).chapters[0], published);

    job = store.update(job.id, { stage: "failed", error: { code: "PROVIDER_BUSY" } }, job.revision);
    assert.deepEqual(resolveWalkView(document, 0, store).chapters[0], published);

    // A retry of the failed revoice still remembers the published pair, not the unvoiced new text.
    store.revoiceAdmin(job.id, job.revision, "openai", null);
    assert.deepEqual(resolveWalkView(document, 0, store).chapters[0], published);
  } finally { store.close(); }
});
