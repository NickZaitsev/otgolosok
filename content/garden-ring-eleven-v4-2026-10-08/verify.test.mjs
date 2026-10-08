import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const load = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
const intent = load("./intent.json");
const receipt = load("./publication-receipt.json");
const verification = load("./verification.json");
const previous = load("../garden-ring-address-cleanup-2026-10-08/verification.json");
const voices = load("./voice-routing-checks.json");
const selection = load("../garden-ring-address-cleanup-2026-10-08/changes.json");
const byId = (entries) => new Map(entries.map((entry) => [entry.placeId, entry]));
const intended = byId(intent.entries);
const released = byId(receipt.results);
const published = byId(verification.entries);
const prior = byId(previous.entries);

test("все 198 выбранных F5-текстов получили новые записи ElevenLabs v4 голосом Отголосок2", () => {
  const ids = selection.reviewed.map((entry) => entry.placeId).filter((id) => id !== "osm:way:52435420");
  assert.equal(ids.length, 198);
  for (const entries of [intent.entries, receipt.results, verification.entries]) {
    assert.equal(entries.length, 198);
    assert.deepEqual(new Set(entries.map((entry) => entry.placeId)), new Set(ids));
  }
  assert.equal(verification.checked, 198);
  assert.deepEqual(verification.errors, []);
  assert.equal(receipt.status, "ready");
  assert.equal(new Set(receipt.results.map((entry) => entry.audioJobId)).size, 198);
  assert.equal(new Set(intent.entries.map((entry) => entry.revoiceRequestId)).size, 198);
  for (const id of ids) {
    const result = released.get(id);
    assert.equal(result.state, "succeeded", id);
    assert.equal(result.revoiceRequestId, intended.get(id).revoiceRequestId, id);
    assert.equal(result.profile.engine, "elevenlabs", id);
    assert.equal(result.profile.model, "eleven_v4", id);
    assert.equal(result.profile.speaker, "9ivxhQ6xIsHd6R3Xc635", id);
    assert.equal(result.audio.provider, "elevenlabs", id);
    assert.equal(result.audio.model, "eleven_v4", id);
    assert.equal(result.audio.voice, "9ivxhQ6xIsHd6R3Xc635", id);
    assert.deepEqual(published.get(id).audio, result.audio, id);
    assert.equal(published.get(id).audioJobId, result.audioJobId, id);
    assert.notEqual(result.audio.sha256, prior.get(id).audio.sha256, id);
  }
});

test("публичные тексты, их идентификаторы и карточные поля сохранены", () => {
  for (const [id, target] of intended) {
    const old = prior.get(id);
    const result = released.get(id);
    const current = published.get(id);
    assert.equal(target.textId, old.textId, id);
    assert.equal(result.textId, old.textId, id);
    assert.equal(current.textId, old.textId, id);
    assert.equal(current.sourceTextSha256, old.sourceTextSha256, id);
    assert.equal(result.sourceTextSha256, current.sourceTextSha256, id);
    assert.equal(target.sourceTextSha256, current.sourceTextSha256, id);
    assert.equal(result.sourceMatches, true, id);
    assert.equal(result.storyMatches, true, id);
    assert.equal(result.cardMatches, true, id);
    assert.ok(current.wordCount >= 100, id);
    assert.equal(target.wordCount, current.wordCount, id);
    assert.equal(result.wordCount, current.wordCount, id);
  }
});

test("новые и прежние MP3 доступны, совпадают по размеру, хешу и длительности", () => {
  assert.equal(verification.entries.reduce((sum, entry) => sum + entry.files.length, 0), 396);
  for (const [id, current] of published) {
    const result = released.get(id);
    assert.equal(result.newFileAvailable, true, id);
    assert.equal(result.oldFileAvailable, true, id);
    assert.deepEqual(current.previousAudio, prior.get(id).audio, id);
    assert.equal(current.files.length, 2, id);
    for (const [index, audio] of [current.audio, current.previousAudio].entries()) {
      const file = current.files[index];
      assert.equal(file.sha256, audio.sha256, id);
      assert.equal(file.bytes, audio.bytes, id);
      assert.ok(file.bytes > 0 && file.durationSec > 0, id);
      assert.ok(Math.abs(file.durationSec - audio.durationSec) < 0.15, id);
    }
  }
});


test("основной и резервные аккаунты настроены на голос Отголосок2", () => {
  assert.equal(voices.keys, 3);
  assert.equal(voices.checks.length, voices.keys);
  assert.equal(new Set(voices.checks.map((entry) => entry.keyIndex)).size, voices.keys);
  assert.deepEqual(new Set(voices.checks.map((entry) => entry.effectiveVoice)), new Set([
    "9ivxhQ6xIsHd6R3Xc635", "JVYtLnrrrMG4dcGbtdAw", "8Hp7MfQf2HGTKtrxXvVj",
  ]));
  for (const entry of voices.checks) {
    assert.equal(entry.configuredVoice, intent.voice);
    assert.equal(entry.exists, true);
    assert.equal(entry.label, "Отголосок2 (ru)");
  }
});
