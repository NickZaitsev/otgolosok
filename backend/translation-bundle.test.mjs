import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { contentSourceHash } from "./content-localization.mjs";
import { createStore } from "./store.mjs";
import { validateTranslationBundle } from "./translation-bundle.mjs";
import { resolveWalkView } from "./walk-view.mjs";

const directory = new URL("../content/tretyakovka-translations-2026-10-07/", import.meta.url);
const readJson = async name => JSON.parse(await readFile(new URL(name, directory), "utf8"));
const copy = value => structuredClone(value);

test("actual English and Chinese drafts hydrate into one pinned import batch", async () => {
  const [source, en, zh] = await Promise.all([readJson("source.json"), readJson("en.json"), readJson("zh.json")]);
  const batch = validateTranslationBundle(source, [en, zh]);
  assert.equal(batch.sourceDocumentSha256, contentSourceHash(batch.document));
  assert.deepEqual(batch.translations.map(item => item.locale), ["en", "zh"]);
  for (const translation of batch.translations) {
    assert.equal(translation.entries.length, 13);
    assert.deepEqual(translation.provenance, { method: "machine", author: "Codex", provider: "OpenAI" });
    assert.equal(translation.entries[0].story.address, source.entries[0].story.address);
    assert.deepEqual(translation.entries[0].story.sources, source.entries[0].story.sources);
    assert.deepEqual(translation.entries[0].story.paragraphs[0].factIds, source.entries[0].story.paragraphs[0].factIds);
  }
});

test("actual bundle imports 26 drafts and becomes visible only after explicit editorial approval", async t => {
  const [source, en, zh] = await Promise.all([readJson("source.json"), readJson("en.json"), readJson("zh.json")]);
  const folder = await mkdtemp(join(tmpdir(), "otgolosok-translations-"));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const store = createStore(join(folder, "jobs.sqlite"));
  t.after(() => store.close());
  const places = source.entries.map(entry => {
    const stop = source.document.stops.find(item => item.storyRef?.id === entry.placeId);
    assert.ok(stop, `Нет остановки для ${entry.placeId}`);
    const [, osmType, osmId] = /^osm:(node|way|relation):(\d+)$/.exec(entry.placeId);
    return { placeId: entry.placeId, osmType, osmId: Number(osmId), name: entry.story.title,
      location: stop.place.location, tags: { "addr:full": entry.story.address } };
  });
  store.importPlaces({ sourceSha256: "a".repeat(64), places });
  store.createBatch({ requestKey: "translation-bundle-fixture", placeIds: places.map(place => place.placeId), limit: places.length });
  for (let index = 0; index < places.length; index++) {
    const job = store.claimContentJob();
    assert.ok(job);
    const original = source.entries.find(entry => entry.placeId === job.place.id);
    store.completeContentJob(job.id, { story: original.story, evidence: {}, verification: "editorial" });
  }

  const batch = validateTranslationBundle(source, [en, zh]);
  for (const translation of batch.translations) {
    translation.entries = translation.entries.map(entry => ({
      ...entry,
      sourceTextId: store.getPublishedPlace(entry.placeId).text.id,
    }));
  }
  const imported = store.importTranslationBundle(batch);
  assert.equal(imported.flatMap(item => item.entries).length, 26);
  assert.ok(imported.every(item => item.walk.state === "draft" && item.entries.every(entry => entry.state === "draft")));
  assert.equal(resolveWalkView(source.document, source.revision, store, { requestedLocale: "en" }).chapters[0].story.title,
    source.entries[0].story.title, "a draft is not public");

  const reviewer = "Тестовый редактор";
  for (const translation of imported) {
    for (const entry of translation.entries) {
      store.approvePlaceTranslation(entry.id, { expectedRevision: entry.revision, reviewer });
    }
    store.approveWalkTranslation(translation.walk.id, {
      document: batch.document,
      expectedRevision: translation.walk.revision,
      reviewer,
    });
  }

  for (const artifact of [en, zh]) {
    const view = resolveWalkView(source.document, source.revision, store, { requestedLocale: artifact.locale });
    assert.deepEqual(view.chapters.map(chapter => chapter.story.title), artifact.entries.map(entry => entry.title));
    assert.ok(view.chapters.every(chapter => chapter.audio === null));
    assert.equal(view.document.title, artifact.walk.title);
  }
  const russian = resolveWalkView(source.document, source.revision, store);
  assert.deepEqual(russian.chapters.map(chapter => chapter.story.title), source.entries.map(entry => entry.story.title));
  assert.equal(russian.document.title, source.document.title);
});

test("captured source story and document hashes cannot be changed or guessed", async () => {
  const [source, en] = await Promise.all([readJson("source.json"), readJson("en.json")]);
  const changedStory = copy(source);
  changedStory.entries[0].story.title = "Изменённый источник";
  assert.throws(() => validateTranslationBundle(changedStory, [en]), { code: "CONFLICT" });

  const changedDocument = copy(source);
  changedDocument.document.description = "Изменённое описание";
  assert.throws(() => validateTranslationBundle(changedDocument, [en]), { code: "CONFLICT" });

  const unpinned = copy(source);
  delete unpinned.entries[0].sourceStorySha256;
  assert.throws(() => validateTranslationBundle(unpinned, [en]), { code: "BAD_REQUEST" });
});

test("artifact bundle, story and document hashes must match the captured source", async () => {
  const [source, en] = await Promise.all([readJson("source.json"), readJson("en.json")]);
  for (const mutate of [
    value => { value.sourceBundleSha256 = "a".repeat(64); },
    value => { value.entries[0].sourceStorySha256 = "a".repeat(64); },
    value => { value.walk.sourceDocumentSha256 = "a".repeat(64); },
  ]) {
    const changed = copy(en);
    mutate(changed);
    assert.throws(() => validateTranslationBundle(source, [changed]), { code: "CONFLICT" });
  }
});

test("entries are exact, ordered and complete and locales cannot repeat", async () => {
  const [source, en] = await Promise.all([readJson("source.json"), readJson("en.json")]);
  const reordered = copy(en);
  [reordered.entries[0], reordered.entries[1]] = [reordered.entries[1], reordered.entries[0]];
  assert.throws(() => validateTranslationBundle(source, [reordered]), { code: "CONFLICT" });

  const missing = copy(en);
  missing.entries.pop();
  assert.throws(() => validateTranslationBundle(source, [missing]), { code: "BAD_REQUEST" });

  assert.throws(() => validateTranslationBundle(source, [en, copy(en)]), { code: "BAD_REQUEST" });
});

test("only draft artifacts in supported translation locales are accepted", async () => {
  const [source, en] = await Promise.all([readJson("source.json"), readJson("en.json")]);
  for (const change of [{ status: "approved" }, { locale: "ru" }, { locale: "fr" }]) {
    assert.throws(() => validateTranslationBundle(source, [{ ...copy(en), ...change }]), { code: "BAD_REQUEST" });
  }
});
