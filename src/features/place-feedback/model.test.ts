import { describe, expect, it } from "vitest";
import { canRatePlace, feedbackPath, validatePlaceFeedback } from "./model";

const mine = { rating: -1, issues: ["voiceover", "short_text"], text: "Подробности", status: "open", updatedAt: "2026-10-02T10:00:00Z" };
describe("place feedback contract", () => {
  it("builds only supported place paths", () => {
    expect(feedbackPath("osm:way:7")).toBe("/api/content/places/osm:way:7/feedback/mine");
    expect(() => feedbackPath("../admin")).toThrow();
  });
  it.each([["osm:node:1", true], ["osm:relation:42", true], ["long-story", false], ["osm:area:1", false], ["osm:way:", false], ["osm:way:7/x", false]])("canRatePlace(%s) = %s", (id, expected) => {
    expect(canRatePlace(id)).toBe(expected);
  });
  it("accepts an empty vote, a dislike with only text and canonical reasons", () => {
    expect(validatePlaceFeedback({ mine: null })).toEqual({ mine: null });
    expect(validatePlaceFeedback({ mine }).mine?.issues).toEqual(["short_text", "voiceover"]);
    expect(validatePlaceFeedback({ mine: { ...mine, issues: [] } }).mine?.text).toBe("Подробности");
    expect(validatePlaceFeedback({ mine: { ...mine, rating: 1, issues: [], text: "" } }).mine?.rating).toBe(1);
  });
  it.each([undefined, { mine: {} }, { mine: { ...mine, rating: 0 } },
    { mine: { ...mine, issues: ["other"] } }, { mine: { ...mine, issues: ["voiceover", "voiceover"] } },
    { mine: { ...mine, rating: 1 } }, { mine: { ...mine, text: "x".repeat(1001) } }])("rejects malformed server data: %j", input => {
    expect(() => validatePlaceFeedback(input)).toThrow();
  });
});
