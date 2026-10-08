import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const bundle = JSON.parse(readFileSync(new URL("./changes.json", import.meta.url), "utf8"));
const tokens = (story) => story.paragraphs.map((paragraph) => paragraph.text).join(" ").split(/\s+/u).filter(Boolean);

test("Редакционная партия охватывает 198 рассказов F5 и явно запрошенный приют без повторов и потери идентичности", () => {
  assert.equal(bundle.reviewed.length, 199);
  assert.equal(new Set(bundle.reviewed.map((entry) => entry.placeId)).size, 199);
  const changed = bundle.reviewed.filter((entry) => entry.changed).map((entry) => entry.placeId).sort();
  assert.deepEqual(bundle.entries.map((entry) => entry.placeId).sort(), changed);
  for (const entry of bundle.entries) {
    assert.equal(entry.story.title, entry.expectedStory.title, entry.placeId);
    assert.equal(entry.story.address, entry.expectedStory.address, entry.placeId);
    assert.notDeepEqual(entry.story.paragraphs, entry.expectedStory.paragraphs, entry.placeId);
    assert.equal(entry.story.verification, "editorial", entry.placeId);
    assert.equal(entry.story.audioDisposition, "eligible", entry.placeId);
  }
});

test("Все изменённые рассказы содержат минимум 100 слов без справочных почтовых адресов", () => {
  for (const entry of bundle.entries) {
    const words = tokens(entry.story);
    const text = words.join(" ");
    assert.equal(words.length, entry.story.wordCount, entry.placeId);
    assert.ok(words.filter((word) => /[\p{L}\p{N}]/u.test(word)).length >= 100, entry.placeId);
    assert.doesNotMatch(text, /по адресу|почтовый адрес|\bд\.\s*\d|\bстр\.\s*\d|—/iu, entry.placeId);
    assert.doesNotMatch(text, /(?:дом(?:а|е)?|строени(?:е|я|и))\s*№\s*\d/iu, entry.placeId);
  }
});

test("Каждый озвучиваемый абзац имеет проверяемую цепочку фактов и источников", () => {
  for (const entry of bundle.entries) {
    const sources = new Set(entry.story.sources.map((source) => source.id));
    const facts = new Set(entry.story.facts.map((fact) => fact.id));
    assert.equal(sources.size, entry.story.sources.length, entry.placeId);
    assert.equal(facts.size, entry.story.facts.length, entry.placeId);
    for (const fact of entry.story.facts) {
      assert.ok(fact.sourceIds.length > 0, `${entry.placeId}: ${fact.id}`);
      for (const id of fact.sourceIds) assert.ok(sources.has(id), `${entry.placeId}: ${id}`);
    }
    for (const paragraph of entry.story.paragraphs) {
      assert.ok(paragraph.factIds.length > 0, entry.placeId);
      for (const id of paragraph.factIds) assert.ok(facts.has(id), `${entry.placeId}: ${id}`);
    }
  }
});
