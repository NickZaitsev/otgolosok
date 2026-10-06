import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { validateWalkDocument } from "./walk-document.mjs";

const root = new URL("../content/ordynka-tretyakovka-2026-10-04/", import.meta.url);
const read = name => JSON.parse(readFileSync(new URL(name, root), "utf8"));

test("Прогулка от Третьяковской до Полянки содержит минимум десять озвученных историй и пятнадцать минут аудио", () => {
  const document = validateWalkDocument(read("walk.json"));
  const audio = read("audio-verification.json");
  const rows = new Map(audio.rows.map(row => [row.placeId, row]));
  assert.ok(document.stops.length >= 10);
  const ids = document.stops.map(stop => stop.storyRef?.id);
  assert.equal(new Set(ids).size, document.stops.length);
  const recordings = ids.map(id => {
    const row = rows.get(id);
    assert.ok(row?.ready, `Нет проверенной озвучки: ${id}`);
    assert.ok(Number.isFinite(row.durationSec) && row.durationSec > 0);
    assert.equal(row.provider, "elevenlabs");
    assert.equal(row.voice, audio.voiceId);
    assert.match(row.sha256, /^[a-f0-9]{64}$/);
    return row;
  });
  const duration = recordings.reduce((sum, row) => sum + row.durationSec, 0);
  assert.ok(duration >= 900, `Суммарная озвучка: ${duration} секунд`);
  assert.ok(Math.abs(duration - audio.durationSec) < 0.01);
  const original = read("stories.json").entries.map(entry => entry.placeId);
  const start = document.stops.findIndex(stop => stop.id === "ordynka-stop-1");
  assert.ok(start > 0, "Нужны истории перед памятником Шмелёву");
  assert.deepEqual(document.stops.slice(start, start + original.length).map(stop => stop.id),
    Array.from({ length: original.length }, (_, index) => `ordynka-stop-${index + 1}`));
  assert.deepEqual(new Set(ids.slice(start, start + original.length)), new Set(original));
  assert.ok(start + original.length < ids.length, "Нужны истории после приюта");
  assert.match(document.start.address, /Третьяковская/);
  assert.match(document.destination.address, /Полянка/);
});

test("Памятник Димитрову расположен между новым корпусом и храмом и имеет расширенный рассказ, фото и звук", () => {
  const document = read("walk.json");
  assert.deepEqual(document.stops.slice(10).map(stop => stop.storyRef.id), [
    "osm:way:642091604", "osm:node:1359108784", "osm:relation:11661228",
  ]);
  const story = read("extension-stories.json").entries.find(entry => entry.placeId === "osm:node:1359108784")?.story;
  assert.ok(story?.wordCount >= 220, "Нужен расширенный рассказ о памятнике");
  assert.equal(story.verification, "editorial");
  const photo = read("previews.json").find(row => row.placeId === "osm:node:1359108784");
  assert.equal(photo?.stop, 12);
  assert.ok(photo.author && photo.license && photo.licenseUrl);
  assert.match(photo.sourceUrl, /^https:\/\/commons\.wikimedia\.org\/wiki\/File:/);
  for (const field of ["thumbnail", "src"]) {
    assert.match(photo[field], /^\/images\/places\/node-1359108784-[a-f0-9]{12}\.jpg$/);
    const bytes = readFileSync(new URL(`../public${photo[field]}`, new URL("../", root)));
    assert.deepEqual([...bytes.subarray(0, 3)], [0xff, 0xd8, 0xff]);
  }
  const audio = read("audio-verification.json").rows.find(row => row.placeId === "osm:node:1359108784");
  assert.ok(audio?.ready && audio.durationSec >= 90, "Расширенный рассказ должен быть озвучен");
});
