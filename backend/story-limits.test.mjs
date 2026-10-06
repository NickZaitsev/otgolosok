import test from "node:test";
import assert from "node:assert/strict";
import { storyWordsInRange } from "./story-limits.mjs";
import { parseStoryText } from "./story-writing.mjs";
import { hasValidStoryText } from "./admin.mjs";

const words = count => Array.from({ length: count }, (_, index) => `слово${index}`).join(" ");
// Long texts get four paragraphs to stay under the separate 2000-character paragraph limit;
// short ones two, within the 1–3 paragraphs of a description.
const paragraphs = count => { const parts = count > 200 ? 4 : 2;
  return Array.from({ length: parts }, (_, index) => words(Math.floor((count + index) / parts))).join("\n\n"); };
const story = (count, effectiveProfile) => ({ title: "Рассказ", effectiveProfile,
  paragraphs: paragraphs(count).split("\n\n").map(text => ({ text, factIds: ["f1"] })) });

const cases = [
  { profile: "story-v1", words: 99, valid: false },
  { profile: "story-v1", words: 100, valid: true },
  { profile: "story-v1", words: 251, valid: true },
  { profile: "story-v1", words: 500, valid: true },
  { profile: "story-v1", words: 501, valid: false },
  { profile: "description-v1", words: 19, valid: false },
  { profile: "description-v1", words: 100, valid: true },
  { profile: "description-v1", words: 101, valid: false },
];

for (const { profile, words: count, valid } of cases) {
  test(`${profile} with ${count} words is ${valid ? "accepted" : "rejected"} everywhere`, () => {
    assert.equal(storyWordsInRange(count, profile), valid);
    assert.equal(hasValidStoryText(story(count, profile)), valid);
    if (valid) assert.equal(parseStoryText(paragraphs(count), { profile }).wordCount, count);
    else assert.throws(() => parseStoryText(paragraphs(count), { profile }), { code: "INVALID_DRAFT" });
  });
}
