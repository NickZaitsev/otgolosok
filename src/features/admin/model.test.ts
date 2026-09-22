import { describe, expect, it } from "vitest";
import { batchItemStates, contentErrorOptions, contentStatusOptions, contentStatusStates, draftCheck, initialDraft, pageCount, pageRange, safeSourceLink, type Draft, type Fact, type Job } from "./model";

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

describe("группы состояний заданий", () => {
  it("покрывает каждое состояние задания ровно одним фильтром", () => {
    const covered = Object.values(contentStatusStates).flat();
    expect([...covered].sort()).toEqual(Object.keys(batchItemStates).sort());
    expect(new Set(covered).size).toBe(covered.length);
  });

  it("предлагает в списке те же фильтры, что и группировка состояний", () => {
    expect(contentStatusOptions.map(option => option.value)).toEqual(["all", ...Object.keys(contentStatusStates)]);
  });
});

describe("фильтр заданий по ошибке", () => {
  const errors = [{ code: "ADDRESS_UNCLEAR", count: 312 }, { code: null, count: 7 }];

  it("перечисляет коды с количеством и отдельный пункт для заданий без ошибки", () => {
    expect(contentErrorOptions(errors, "all")).toEqual([
      { value: "all", label: "Любая ошибка" },
      { value: "ADDRESS_UNCLEAR", label: "ADDRESS_UNCLEAR (312)" },
      { value: "none", label: "Без ошибки (7)" },
    ]);
  });

  it("сохраняет выбранный код, когда он исчез из партии после повтора", () => {
    expect(contentErrorOptions(errors, "TIMEOUT").at(-1)).toEqual({ value: "TIMEOUT", label: "TIMEOUT (0)" });
    expect(contentErrorOptions([], "none").at(-1)).toEqual({ value: "none", label: "Без ошибки (0)" });
  });

  it("не дублирует пункт, если выбранный код есть в списке", () => {
    expect(contentErrorOptions(errors, "ADDRESS_UNCLEAR")).toHaveLength(3);
  });
});

describe("подписи постраничной навигации", () => {
  it.each([
    [0, 50, 6107, "1–50 из 6107"],
    [6100, 7, 6107, "6101–6107 из 6107"],
    [0, 0, 0, "0"],
  ] as const)("описывает страницу со смещением %i", (offset, count, total, expected) => {
    expect(pageRange(offset, count, total)).toBe(expected);
  });

  it.each([[0, 1], [1, 1], [50, 1], [51, 2], [6107, 123]] as const)("считает страницы для %i записей", (total, pages) => {
    expect(pageCount(total, 50)).toBe(pages);
  });
});
