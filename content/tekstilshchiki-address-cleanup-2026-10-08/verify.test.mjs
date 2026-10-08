import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const bundle = JSON.parse(readFileSync(new URL("./changes.json", import.meta.url), "utf8"));
const countWords = (paragraphs) => paragraphs.flatMap(({ text }) => text.split(/\s+/u))
  .filter((word) => /[\p{L}\p{N}]/u.test(word)).length;

test("все опубликованные рассказы выбранных точек проверены", () => {
  assert.equal(bundle.entries.length, 5);
  assert.equal(bundle.entries.filter((entry) => entry.status === "changed").length, 4);
  assert.equal(bundle.entries.filter((entry) => entry.status === "unchanged").length, 1);
  assert.equal(new Set(bundle.entries.map((entry) => entry.placeId)).size, 5);
});

for (const entry of bundle.entries) {
  test(`${entry.placeId}: адрес карточки сохранён, рассказ проверен`, () => {
    const { story, expected } = entry;
    assert.equal(story.title, expected.story.title);
    assert.equal(story.address, expected.story.address);
    assert.equal(story.wordCount, countWords(story.paragraphs));
    assert.ok(story.wordCount >= 100);
    assert.ok(expected.audio?.sha256);
    if (entry.status === "unchanged") assert.deepEqual(story, expected.story);
    else {
      assert.notDeepEqual(story.paragraphs, expected.story.paragraphs);
      assert.doesNotMatch(story.paragraphs.map(({ text }) => text).join(" "),
        /(?:адрес(?:\s+здания)?\s*[—:]|(?:улиц[аые]|ул\.)\s+[^.!?]{0,80}\b(?:д(?:ом)?\.?\s*)?\d+\s*(?:\/\s*\d+)?)/iu);
      assert.equal(story.verification, "editorial");
      assert.equal(story.audioDisposition, "eligible");
    }
    const sources = new Set(story.sources.map(({ id }) => id));
    const facts = new Map(story.facts.map((fact) => [fact.id, fact]));
    assert.equal(sources.size, story.sources.length);
    assert.equal(facts.size, story.facts.length);
    for (const fact of facts.values()) {
      assert.ok(fact.sourceIds.length > 0);
      for (const sourceId of fact.sourceIds) assert.ok(sources.has(sourceId), sourceId);
    }
    for (const paragraph of story.paragraphs) {
      assert.ok(paragraph.factIds.length > 0);
      for (const factId of paragraph.factIds) assert.ok(facts.has(factId), factId);
    }
  });
}
