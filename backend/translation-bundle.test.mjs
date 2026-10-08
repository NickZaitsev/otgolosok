import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { contentSourceHash } from "./content-localization.mjs";
import { createStore } from "./store.mjs";
import { validateTranslationBundle } from "./translation-bundle.mjs";
import { resolveWalkView } from "./walk-view.mjs";

const directory = new URL("../content/tretyakovka-translations-2026-10-07/", import.meta.url);
const readJson = async name => JSON.parse(await readFile(new URL(name, directory), "utf8"));
const copy = value => structuredClone(value);
const readActual = async () => {
  const [source, baseSource, en, zh] = await Promise.all([
    readJson("source.json"), readJson("source.published-2026-10-07.json"), readJson("en.json"), readJson("zh.json"),
  ]);
  return { source, baseSource, en, zh };
};

test("actual English and Chinese drafts hydrate into one pinned import batch", async () => {
  const { source, baseSource, en, zh } = await readActual();
  const batch = validateTranslationBundle(source, [en, zh], { baseSource });
  assert.equal(batch.sourceDocumentSha256, contentSourceHash(batch.document));
  assert.equal(batch.sourceEdits.length, 1);
  assert.equal(batch.sourceEdits[0].baseSourceTextId, "47f402e8-d21a-4f37-9702-824685427e5a");
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
  const { source, baseSource, en, zh } = await readActual();
  const folder = await mkdtemp(join(tmpdir(), "otgolosok-translations-"));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const databasePath = join(folder, "jobs.sqlite");
  const store = createStore(databasePath);
  t.after(() => store.close());
  const places = baseSource.entries.map(entry => {
    const stop = baseSource.document.stops.find(item => item.storyRef?.id === entry.placeId);
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
    const original = baseSource.entries.find(entry => entry.placeId === job.place.id);
    store.completeContentJob(job.id, { story: original.story, evidence: {}, verification: "editorial" });
  }

  const liveIds = new Map(places.map(place => [place.placeId, store.getPublishedPlace(place.placeId).text.id]));
  const batch = validateTranslationBundle(source, [en, zh], { baseSource });
  const editedPlaces = new Set(batch.sourceEdits.map(edit => edit.placeId));
  batch.sourceEdits = batch.sourceEdits.map(edit => ({ ...edit, baseSourceTextId: liveIds.get(edit.placeId) }));
  for (const translation of batch.translations) {
    translation.entries = translation.entries.map(entry => ({
      ...entry,
      sourceTextId: editedPlaces.has(entry.placeId) ? entry.sourceTextId : liveIds.get(entry.placeId),
    }));
  }
  const edit = batch.sourceEdits[0];
  const audio = { url: `/api/story-audio/${"a".repeat(64)}.mp3`, sha256: "a".repeat(64), durationSec: 30, language: "ru" };
  const fixtureDb = new DatabaseSync(databasePath);
  fixtureDb.prepare("UPDATE place_texts SET audio_json=?,audio_target_profile=? WHERE id=?")
    .run(JSON.stringify(audio), "legacy-voice-profile", edit.baseSourceTextId);
  fixtureDb.close();

  assert.throws(() => store.importTranslationBundle(batch), { code: "BAD_REQUEST" });
  assert.equal(store.getPublishedPlace(edit.placeId).text.id, edit.baseSourceTextId);
  assert.equal(store.getPlaceTranslations(edit.placeId).length, 0);

  const wrongBase = copy(batch);
  wrongBase.sourceEdits[0].baseSourceTextId = "11111111-1111-4111-8111-111111111111";
  assert.throws(() => store.importTranslationBundle(wrongBase, { applySourceEdits: true }), { code: "CONFLICT" });

  const badTranslation = copy(batch);
  const unchanged = badTranslation.translations[0].entries.find(entry => !editedPlaces.has(entry.placeId));
  unchanged.sourceTextId = "22222222-2222-4222-8222-222222222222";
  assert.throws(() => store.importTranslationBundle(badTranslation, { applySourceEdits: true }), { code: "CONFLICT" });
  assert.equal(store.getPublishedPlace(edit.placeId).text.id, edit.baseSourceTextId, "the Russian edit rolls back with the whole batch");
  assert.equal(store.getPlaceTranslations(edit.placeId).length, 0);

  const singleLocale = copy(batch);
  singleLocale.translations = singleLocale.translations.filter(translation => translation.locale === "en");
  assert.throws(() => store.importTranslationBundle(singleLocale, { applySourceEdits: true }), { code: "BAD_REQUEST" });
  assert.equal(store.getPublishedPlace(edit.placeId).text.id, edit.baseSourceTextId,
    "the Russian edit requires both language drafts");

  const collisionDb = new DatabaseSync(databasePath);
  collisionDb.prepare(`INSERT INTO place_texts
    (id,place_id,input_key,profile,content_hash,story_json,evidence_json,verification,audio_json,approved_story_json,created_at,audio_target_profile)
    SELECT ?,place_id,?,profile,content_hash,story_json,evidence_json,verification,audio_json,approved_story_json,created_at,audio_target_profile
    FROM place_texts WHERE id=?`).run(edit.sourceTextId, "collision-input-key", edit.baseSourceTextId);
  collisionDb.close();
  assert.throws(() => store.importTranslationBundle(batch, { applySourceEdits: true }), { code: "CONFLICT" });
  const cleanupDb = new DatabaseSync(databasePath);
  cleanupDb.prepare("DELETE FROM place_texts WHERE id=?").run(edit.sourceTextId);
  cleanupDb.close();

  const imported = store.importTranslationBundle(batch, { applySourceEdits: true });
  assert.equal(imported.flatMap(item => item.entries).length, 26);
  assert.ok(imported.every(item => item.walk.state === "draft" && item.entries.every(entry => entry.state === "draft")));
  const amendedIndex = source.entries.findIndex(entry => entry.placeId === edit.placeId);
  const amended = store.getPublishedPlace(edit.placeId);
  assert.equal(amended.text.id, edit.sourceTextId);
  assert.equal(amended.text.story.paragraphs[0].text, source.entries[amendedIndex].story.paragraphs[0].text);
  assert.deepEqual(amended.text.audio, audio, "the existing Russian recording remains available");
  const auditDb = new DatabaseSync(databasePath, { readOnly: true });
  const targetRow = auditDb.prepare("SELECT audio_json,audio_target_profile FROM place_texts WHERE id=?").get(edit.sourceTextId);
  assert.equal(targetRow.audio_json, null,
    "the old recording is a publication fallback, not provenance for the amended text");
  assert.equal(targetRow.audio_target_profile, null, "the amended text does not inherit a stale synthesis target");
  auditDb.close();
  assert.equal(store.listExternalAudio({ states: ["queued", "retry_wait", "leased"], limit: 100 }).length, 0,
    "source amendments never queue narration");
  const draftView = resolveWalkView(source.document, source.revision, store, { requestedLocale: "en" });
  assert.equal(draftView.chapters[amendedIndex].story.paragraphs[0].text, source.entries[amendedIndex].story.paragraphs[0].text,
    "a translation draft falls back to the amended Russian source");
  assert.deepEqual(draftView.chapters[amendedIndex].audio, audio);

  const replay = store.importTranslationBundle(batch, { applySourceEdits: true });
  assert.deepEqual(replay.flatMap(item => item.entries.map(entry => entry.id)),
    imported.flatMap(item => item.entries.map(entry => entry.id)), "an exact replay creates no revisions");

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
  assert.throws(() => store.importTranslationBundle(batch, { applySourceEdits: true }), { code: "CONFLICT" },
    "a replay cannot replace translations after editorial approval");
});

test("captured source story and document hashes cannot be changed or guessed", async () => {
  const { source, baseSource, en } = await readActual();
  const changedStory = copy(source);
  changedStory.entries[0].story.title = "Изменённый источник";
  assert.throws(() => validateTranslationBundle(changedStory, [en], { baseSource }), { code: "CONFLICT" });

  const changedDocument = copy(source);
  changedDocument.document.description = "Изменённое описание";
  assert.throws(() => validateTranslationBundle(changedDocument, [en], { baseSource }), { code: "CONFLICT" });

  const unpinned = copy(source);
  delete unpinned.entries[0].sourceStorySha256;
  assert.throws(() => validateTranslationBundle(unpinned, [en], { baseSource }), { code: "BAD_REQUEST" });
});

test("artifact bundle, story and document hashes must match the captured source", async () => {
  const { source, baseSource, en } = await readActual();
  for (const mutate of [
    value => { value.sourceBundleSha256 = "a".repeat(64); },
    value => { value.entries[0].sourceStorySha256 = "a".repeat(64); },
    value => { value.walk.sourceDocumentSha256 = "a".repeat(64); },
  ]) {
    const changed = copy(en);
    mutate(changed);
    assert.throws(() => validateTranslationBundle(source, [changed], { baseSource }), { code: "CONFLICT" });
  }
});

test("entries are exact, ordered and complete and locales cannot repeat", async () => {
  const { source, baseSource, en } = await readActual();
  const reordered = copy(en);
  [reordered.entries[0], reordered.entries[1]] = [reordered.entries[1], reordered.entries[0]];
  assert.throws(() => validateTranslationBundle(source, [reordered], { baseSource }), { code: "CONFLICT" });

  const missing = copy(en);
  missing.entries.pop();
  assert.throws(() => validateTranslationBundle(source, [missing], { baseSource }), { code: "BAD_REQUEST" });

  assert.throws(() => validateTranslationBundle(source, [en, copy(en)], { baseSource }), { code: "BAD_REQUEST" });
});

test("only draft artifacts in supported translation locales are accepted", async () => {
  const { source, baseSource, en } = await readActual();
  for (const change of [{ status: "approved" }, { locale: "ru" }, { locale: "fr" }]) {
    assert.throws(() => validateTranslationBundle(source, [{ ...copy(en), ...change }], { baseSource }), { code: "BAD_REQUEST" });
  }
});

test("an editorial Russian amendment requires both English and Chinese drafts", async () => {
  const { source, baseSource, en, zh } = await readActual();
  assert.throws(() => validateTranslationBundle(source, [en], { baseSource }), { code: "BAD_REQUEST" });
  assert.doesNotThrow(() => validateTranslationBundle(source, [en, zh], { baseSource }));
});

test("editorial source requires its exact historical pair and limits changes to narrative text", async () => {
  const { source, baseSource, en } = await readActual();
  assert.throws(() => validateTranslationBundle(source, [en]), { code: "BAD_REQUEST" });

  const changedUnamended = copy(source);
  changedUnamended.entries[0].story.title = "Редакторская подмена";
  changedUnamended.entries[0].sourceStorySha256 = contentSourceHash(changedUnamended.entries[0].story);
  assert.throws(() => validateTranslationBundle(changedUnamended, [en], { baseSource }), { code: "CONFLICT" });

  const changedMetadata = copy(source);
  const edited = changedMetadata.entries.find(entry => entry.sourceEdit);
  edited.story.address = "Москва, другой адрес, 1";
  edited.sourceStorySha256 = contentSourceHash(edited.story);
  assert.throws(() => validateTranslationBundle(changedMetadata, [en], { baseSource }), { code: "BAD_REQUEST" });

  const invalidNarrative = copy(source);
  const invalidEdited = invalidNarrative.entries.find(entry => entry.sourceEdit);
  invalidEdited.story.title = "<script>invalid</script>";
  invalidEdited.sourceStorySha256 = contentSourceHash(invalidEdited.story);
  assert.throws(() => validateTranslationBundle(invalidNarrative, [en], { baseSource }), { code: "BAD_REQUEST" });

  const fakeBase = copy(baseSource);
  fakeBase.entries.reverse();
  assert.throws(() => validateTranslationBundle(source, [en], { baseSource: fakeBase }), { code: "CONFLICT" });
});
