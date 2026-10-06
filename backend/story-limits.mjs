// Shared, dependency-free word limits of place and address stories (backend and the admin editor).
// 500 words take about 4.5 minutes in the published voice (111–118 words a minute), under the 5-minute audio limit.
export const STORY_WORDS = Object.freeze({ min: 100, max: 500 });
export const DESCRIPTION_WORDS = Object.freeze({ min: 20, max: 100 });

/** @param {number} words @param {string} [profile] */
export function storyWordsInRange(words, profile = "story-v1") {
  const range = profile === "description-v1" ? DESCRIPTION_WORDS : STORY_WORDS;
  return words >= range.min && words <= range.max;
}
