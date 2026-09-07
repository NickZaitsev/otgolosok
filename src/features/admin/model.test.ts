import { describe, expect, it } from "vitest";
import { draftCheck, initialDraft, safeSourceLink, type Draft, type Fact, type Job } from "./model";

const facts: Fact[] = Array.from({ length: 5 }, (_, index) => ({
  id: `f${index + 1}`, claim: "Verified claim", interesting: true, evidence: [],
}));
const draft: Draft = {
  title: "Editorial title",
  paragraphs: [
    { text: Array(50).fill("word").join(" "), factIds: ["f1", "f2", "f3"] },
    { text: Array(50).fill("word").join(" "), factIds: ["f4", "f5"] },
  ],
};

describe("editorial draft requirements", () => {
  it("accepts the minimum word and distinct-fact counts", () => {
    expect(draftCheck(draft, facts)).toEqual({ words: 100, facts: 5, valid: true });
  });
  it("rejects missing evidence, unknown facts and unlinked paragraphs", () => {
    expect(draftCheck(draft, []).valid).toBe(false);
    expect(draftCheck({ ...draft, paragraphs: [draft.paragraphs[0], { ...draft.paragraphs[1], factIds: ["f6"] }] }, facts).valid).toBe(false);
    expect(draftCheck({ ...draft, paragraphs: [draft.paragraphs[0], { ...draft.paragraphs[1], factIds: [] }] }, facts).valid).toBe(false);
  });
  it("rejects invalid lengths and empty titles", () => {
    expect(draftCheck({ ...draft, title: " " }, facts).valid).toBe(false);
    expect(draftCheck({ ...draft, title: "x".repeat(141) }, facts).valid).toBe(false);
    expect(draftCheck({ ...draft, paragraphs: [draft.paragraphs[0]] }, facts).valid).toBe(false);
    expect(draftCheck({ ...draft, paragraphs: Array(7).fill(draft.paragraphs[0]) }, facts).valid).toBe(false);
    expect(draftCheck({ ...draft, paragraphs: draft.paragraphs.map(p => ({ ...p, text: "short" })) }, facts).valid).toBe(false);
    expect(draftCheck({ ...draft, paragraphs: draft.paragraphs.map(p => ({ ...p, text: Array(126).fill("word").join(" ") })) }, facts).valid).toBe(false);
  });
  it("prefers the saved editorial draft and provides two empty paragraphs otherwise", () => {
    const job = { data: { editorDraft: draft, draft: { ...draft, title: "Model" }, draftCandidate: null } } as Job;
    expect(initialDraft(job)).toBe(draft);
    expect(initialDraft({ data: { editorDraft: null, draft: null, draftCandidate: null } } as Job).paragraphs).toHaveLength(2);
  });
});

describe("source links", () => {
  it("permits only absolute HTTP(S) URLs without credentials", () => {
    expect(safeSourceLink("https://example.org/source")).toBe("https://example.org/source");
    for (const value of [null, "javascript:alert(1)", "data:text/html,hello", "//example.org", "/source", "https://user:password@example.org"]) {
      expect(safeSourceLink(value)).toBeNull();
    }
  });
});
