import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { validateWalkDocument } from "../../backend/walk-document.mjs";
import { editorialPlaceImages } from "../../backend/place-images.mjs";

const load = (name) => JSON.parse(readFileSync(new URL(`./${name}.json`, import.meta.url)));
const hash = (value) => createHash("sha256").update(value).digest("hex");

test("десять самостоятельных остановок с проверяемыми источниками", () => {
  const bundle = load("stories");
  const walk = validateWalkDocument(load("walk"));
  assert.equal(walk.stops.length, 10);
  assert.equal(new Set(walk.stops.map((stop) => stop.placeId)).size, 10);
  assert.deepEqual(walk.stops.map((stop) => stop.placeId), bundle.entries.map((entry) => entry.placeId));
  for (const { story } of bundle.entries) {
    const words = story.paragraphs.flatMap((paragraph) => paragraph.text.split(/\s+/u)).filter((word) => /[\p{L}\p{N}]/u.test(word)).length;
    assert.equal(words, story.wordCount);
    assert(words >= 100);
    for (const paragraph of story.paragraphs) {
      assert(paragraph.factIds.length);
      assert.doesNotMatch(paragraph.text, /(?<![\p{L}])[А-ЯЁ]\.\s*[А-ЯЁ]/u);
      for (const id of paragraph.factIds) assert(story.facts.some((fact) => fact.id === id));
    }
    for (const fact of story.facts) {
      assert(fact.sourceIds.length);
      for (const id of fact.sourceIds) assert(story.sources.some((source) => source.id === id));
    }
  }
});

test("не менее пятнадцати минут измеренного аудио с подтверждёнными v4 и голосом", () => {
  const bundle = load("stories");
  const proof = load("audio-provenance");
  const verified = load("audio-verification");
  assert.equal(proof.checked, 10);
  assert.equal(verified.checked, 10);
  assert.deepEqual(verified.errors, []);
  assert(verified.measuredAudioSec >= 900);
  assert(Math.abs(verified.measuredAudioSec - verified.entries.reduce((sum, entry) => sum + entry.measuredDurationSec, 0)) < 0.01);
  for (const entry of bundle.entries) {
    const sourceHash = hash(entry.story.paragraphs.map((paragraph) => paragraph.text).join("\n\n"));
    const provenance = proof.entries.find((item) => item.placeId === entry.placeId);
    const measurement = verified.entries.find((item) => item.placeId === entry.placeId);
    assert.equal(provenance.sourceTextSha256, sourceHash);
    assert.equal(measurement.sourceTextSha256, sourceHash);
    assert.deepEqual(provenance.audio, measurement.audio);
    assert.equal(provenance.audio.provider, "elevenlabs");
    assert.equal(provenance.audio.model, "eleven_v4");
    assert.equal(provenance.audio.voice, "9ivxhQ6xIsHd6R3Xc635");
    assert(provenance.uploadAndReceiptMatch && provenance.approvedSourceTextMatch);
    assert(measurement.decoded && measurement.bytesVerified && measurement.sha256Verified);
  }
});

test("превью всех точек доступны, редакционные файлы соответствуют хешам", () => {
  const verification = load("verification");
  const catalog = JSON.parse(readFileSync(new URL("../../backend/place-images-editorial.json", import.meta.url)));
  editorialPlaceImages(catalog);
  assert.equal(verification.entries.length, 10);
  for (const entry of verification.entries) {
    assert(entry.photo);
    assert.equal(entry.images.length, 2);
    assert(entry.images.every((file) => file.decoded && file.status === 200));
    const photo = catalog[entry.placeId];
    if (!photo) continue;
    assert.deepEqual(entry.photo.src, photo.src);
    for (const path of [photo.thumbnail, photo.src]) {
      const bytes = readFileSync(new URL(`../../public${path}`, import.meta.url));
      assert(path.includes(hash(bytes).slice(0, 12)));
      assert.equal(bytes.readUInt16BE(0), 0xffd8);
    }
  }
});

test("геометрия, прежняя ссылка и прохождение десяти глав проверены", () => {
  const walk = validateWalkDocument(load("walk"));
  const geometry = load("geometry-verification");
  const publication = load("walk-publication");
  const api = load("shared-api-verification");
  const ui = load("ui-verification");
  const local = load("local-verification");
  assert.equal(walk.fieldChecked, false);
  assert.equal(geometry.distanceM, walk.route.distanceM);
  assert(geometry.stops.every((stop) => stop.triggerGapFromRouteM < 25));
  assert.equal(publication.shareUrl, "https://otgolosok.online/walk?share=901d1133-44a2-4724-a856-2fe8d6c86a44");
  assert(publication.otherWalksUnchanged && publication.shareTokenPreserved);
  assert(local.conflictRollsBack && local.dryRunRollsBack && local.idempotentReplay && local.oldTextsAndAudioPreserved);
  assert.equal(api.readyChapters, 10);
  assert.equal(ui.stops.length, 10);
  assert(ui.finishChecked);
  assert.deepEqual(ui.javascriptErrors, []);
  for (const stop of ui.stops) {
    assert(stop.textChecked && stop.photoBannerChecked && stop.photoViewerChecked);
    assert(stop.audio.pauseChecked);
    assert(stop.audio.playing.every((sample) => sample.timeSec > 1 && sample.playbackRate === 1 && !sample.paused && sample.error === null));
  }
});
