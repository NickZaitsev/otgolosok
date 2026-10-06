import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { validateWalkDocument } from "./walk-document.mjs";

const read = name => JSON.parse(readFileSync(new URL(`../content/${name}`, import.meta.url), "utf8"));
const root = "pyatnitskaya-2026-10-06/";

test("Пятницкая соединяет две станции метро и даёт минимум десять новых точек с пятнадцатью минутами проверенной озвучки", () => {
  const document = validateWalkDocument(read(`${root}walk.json`));
  const stories = read(`${root}stories.json`).entries;
  const audio = read(`${root}audio-verification.json`);
  const previews = read(`${root}previews.json`);
  assert.equal(audio.ready, 11);
  assert.equal(audio.total, 11);
  assert.equal(audio.publicWalkAudioReady, 11);
  const ids = document.stops.map(stop => stop.storyRef.id);
  assert.ok(ids.length >= 10);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(stories.map(entry => entry.placeId), ids);
  assert.match(document.start.address, /Добрынинская/);
  assert.match(document.destination.address, /Новокузнецкая/);
  assert.equal(document.fieldChecked, false);
  for (const previous of ["ordynka-merchants-2026-10-05/", "ordynka-tretyakovka-2026-10-04/"]) {
    const old = new Set(read(`${previous}walk.json`).stops.map(stop => stop.storyRef.id));
    assert.deepEqual(ids.filter(id => old.has(id)), [], "Новая прогулка повторяет прежние остановки");
  }
  const recordings = new Map(audio.rows.map(row => [row.placeId, row]));
  const photos = new Map(previews.map(photo => [photo.placeId, photo]));
  let seconds = 0;
  for (const entry of stories) {
    const row = recordings.get(entry.placeId);
    assert.equal(row?.ready, true, `Нет проверенного аудио ${entry.placeId}`);
    assert.equal(row.provider, "elevenlabs");
    assert.equal(row.voice, audio.voiceId);
    assert.match(row.sha256, /^[a-f0-9]{64}$/);
    assert.ok(Number.isFinite(row.durationSec) && row.durationSec > 0);
    seconds += row.durationSec;
    assert.ok(photos.get(entry.placeId)?.author, `Нет авторства фото ${entry.placeId}`);
    assert.ok(photos.get(entry.placeId)?.licenseUrl, `Нет лицензии фото ${entry.placeId}`);
    const sourceIds = new Set(entry.story.sources.map(source => source.id));
    const factIds = new Set(entry.story.facts.map(fact => fact.id));
    for (const fact of entry.story.facts) {
      assert.ok(fact.sourceIds.length > 0);
      assert.ok(fact.sourceIds.every(id => sourceIds.has(id)));
    }
    for (const paragraph of entry.story.paragraphs) {
      assert.ok(paragraph.factIds.length > 0);
      assert.ok(paragraph.factIds.every(id => factIds.has(id)));
    }
  }
  assert.ok(seconds >= 900, `Озвучка короче пятнадцати минут: ${seconds}`);
  assert.ok(Math.abs(seconds - audio.durationSec) < 0.01);
});
