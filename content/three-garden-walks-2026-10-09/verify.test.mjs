import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { validateWalkDocument } from "../../backend/walk-document.mjs";

const load = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
const changes = ["r01", "r03", "r11"].flatMap((id) => load(`./${id}-changes.json`).entries);
const verification = load("./verification.json");
const provenance = load("./audio-provenance.json");
const byId = new Map(verification.entries.map((entry) => [entry.placeId, entry]));
const wordCount = (story) => story.paragraphs.flatMap((p) => p.text.split(/\s+/u)).filter((token) => /[\p{L}\p{N}]/u.test(token)).length;

// Редакционный контракт проверяет фактическую партию и её публичные результаты.
test("22 дополненных и два первых рассказа содержат проверяемые факты и минимум 100 слов", () => {
  assert.equal(changes.length, 24);
  assert.equal(new Set(changes.map((entry) => entry.placeId)).size, 24);
  assert.equal(changes.filter((entry) => entry.operation === "update").length, 22);
  assert.deepEqual(new Set(changes.filter((entry) => entry.operation === "create").map((entry) => entry.placeId)), new Set(["osm:relation:8914102", "osm:node:8898082919"]));
  for (const entry of changes) {
    assert.ok(wordCount(entry.story) >= 100, entry.placeId);
    assert.equal(entry.story.wordCount, wordCount(entry.story));
    assert.equal(byId.get(entry.placeId).wordCount, wordCount(entry.story));
    if (entry.operation === "update") {
      assert.equal(entry.story.title, entry.beforeStory.title);
      assert.equal(entry.story.address, entry.beforeStory.address);
      assert.notEqual(byId.get(entry.placeId).textId, entry.expectedTextId);
    }
    const sources = new Set(entry.story.sources.map((source) => source.id));
    const facts = new Set(entry.story.facts.map((fact) => fact.id));
    assert.equal(sources.size, entry.story.sources.length);
    assert.equal(facts.size, entry.story.facts.length);
    assert.ok(entry.sourceChecks.length > 0);
    for (const fact of entry.story.facts) {
      assert.ok(fact.sourceIds.length > 0);
      for (const id of fact.sourceIds) assert.ok(sources.has(id), `${entry.placeId}: ${id}`);
    }
    for (const paragraph of entry.story.paragraphs) {
      assert.ok(paragraph.factIds.length > 0);
      for (const id of paragraph.factIds) assert.ok(facts.has(id), `${entry.placeId}: ${id}`);
      assert.doesNotMatch(paragraph.text, /(?:по адресу|расположен[аоы]? по|строение\s+\d)/iu);
    }
  }
});

test("все 42 публичные точки имеют достаточный текст, фото и проверенное аудио", () => {
  assert.equal(verification.checked, 42);
  assert.equal(provenance.checked, 42);
  assert.equal(new Set(provenance.entries.map((entry) => entry.placeId)).size, 42);
  assert.deepEqual(verification.errors, []);
  assert.equal(byId.size, 42);
  const allowedV3 = new Set(["osm:relation:2150666", "osm:relation:7314898"]);
  for (const entry of verification.entries) {
    assert.ok(entry.wordCount >= 100, entry.placeId);
    assert.equal(entry.audio.provider, "elevenlabs");
    assert.equal(entry.audio.voice, "9ivxhQ6xIsHd6R3Xc635");
    assert.equal(entry.audio.model, allowedV3.has(entry.placeId) ? "eleven_v3" : "eleven_v4");
    assert.equal(entry.images.length, 2);
    for (const image of entry.images) assert.ok(image.width > 0 && image.height > 0 && image.bytes > 0);
    assert.ok(entry.photo.sourceUrl && entry.photo.author && entry.photo.license);
    const proof = provenance.entries.find((proof) => proof.placeId === entry.placeId);
    assert.equal(proof.state, "succeeded");
    assert.equal(proof.sourceTextSha256, entry.sourceTextSha256);
    assert.equal(proof.sha256, entry.audio.sha256);
    assert.equal(proof.model, entry.audio.model);
    assert.equal(proof.voice, entry.audio.voice);
    assert.equal(proof.uploadAndReceiptMatch, true);
    assert.equal(proof.approvedSourceTextMatch, true);
    assert.equal(entry.files[0].sha256, entry.audio.sha256);
    assert.equal(entry.files[0].bytes, entry.audio.bytes);
    assert.ok(Math.abs(entry.files[0].durationSec - entry.audio.durationSec) < 0.15);
    assert.equal(entry.files.length, entry.changed && !["osm:relation:8914102", "osm:node:8898082919"].includes(entry.placeId) ? 2 : 1);
  }
  assert.equal(verification.entries.reduce((sum, entry) => sum + entry.files.length, 0), 64);
});

test("три маршрута сохраняют 42 физических объекта, метро и не менее 15 минут реального аудио", () => {
  for (const [id, count] of [["r01", 14], ["r03", 12], ["r11", 16]]) {
    const doc = validateWalkDocument(load(`./routes/${id}/walk.json`));
    const geometry = load(`./routes/${id}/geometry-verification.json`);
    const audio = load(`./routes/${id}/audio-verification.json`);
    const ui = load(`./routes/${id}/ui-verification.json`);
    const overlaps = load(`./routes/${id}/overlap.json`);
    assert.equal(doc.stops.length, count);
    assert.equal(ui.stops.length, count);
    assert.equal(ui.finishChecked, true);
    assert.deepEqual(ui.javascriptErrors, []);
    for (const [index, stop] of ui.stops.entries()) {
      assert.equal(stop.placeId, doc.stops[index].placeId);
      assert.ok(stop.textChecked && stop.photoBannerChecked && stop.photoViewerChecked);
      assert.equal(stop.audio.sha256, byId.get(stop.placeId).audio.sha256);
      assert.ok(stop.audio.pauseChecked && stop.audio.playing.some((sample) => sample.timeSec > 1 && !sample.paused && sample.error === null));
    }
    assert.equal(new Set(doc.stops.map((stop) => stop.placeId)).size, count);
    assert.ok(doc.start.address.includes("метро") && doc.destination.address.includes("метро"));
    assert.equal(doc.fieldChecked, false);
    assert.equal(geometry.outsideBoundarySampleCount, 0);
    assert.ok(geometry.startInsideBoundary && geometry.destinationInsideBoundary);
    assert.ok(geometry.stops.every((stop) => stop.triggerInsideBoundary && stop.centerInsideBoundary));
    assert.equal(audio.items.length, count);
    const measured = doc.stops.reduce((sum, stop) => sum + byId.get(stop.placeId).files[0].durationSec, 0);
    assert.ok(measured >= 900, id);
    assert.ok(Math.abs(audio.measuredDurationSec - measured) < 0.01);
    assert.ok(overlaps.maxExistingPercent <= 50 && overlaps.maxPlannedPercent <= 50);
  }
});
