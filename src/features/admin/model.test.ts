import { describe, expect, it } from "vitest";
import { draftCheck, filterContentBatches, filterContentBatchItems, initialDraft, safeSourceLink, type ContentBatch, type ContentBatchItem, type Draft, type Fact, type Job } from "./model";

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

describe("фильтр состояний OSM-партий", () => {
  const batch = (id: string, counts: [number, number, number, number]): ContentBatch => ({
    id, name: id, state: "running", mode: "text-and-audio", textProfile: "story-v1", ttsProfile: null,
    createdAt: "", updatedAt: "",
    counts: { total: 10, ready: counts[0], queued: counts[1], failed: counts[2], working: counts[3] },
  });
  const batches = [batch("готово", [2, 0, 0, 0]), batch("ждут", [0, 2, 0, 1]), batch("остановлено", [0, 0, 2, 0])];
  const items: ContentBatchItem[] = ["ready", "queued", "retry_wait", "working", "failed", "review_required", "insufficient_evidence", "cancelled"]
    .map((state, index) => ({ placeId: String(index), name: state, address: null, state, error: null }));

  it.each([
    ["all", ["готово", "ждут", "остановлено"], items.map(item => item.state)],
    ["ready", ["готово"], ["ready"]],
    ["waiting", ["ждут"], ["queued", "retry_wait"]],
    ["stopped", ["остановлено"], ["failed", "review_required", "insufficient_evidence", "cancelled"]],
  ] as const)("показывает %s", (filter, batchNames, itemStates) => {
    expect(filterContentBatches(batches, filter).map(item => item.name)).toEqual(batchNames);
    expect(filterContentBatchItems(items, filter).map(item => item.state)).toEqual(itemStates);
  });

  it("сохраняет пустой результат, если подходящих записей нет", () => {
    expect(filterContentBatches([batches[0]], "stopped")).toEqual([]);
    expect(filterContentBatchItems([items[0]], "waiting")).toEqual([]);
  });
});
