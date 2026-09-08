export type Draft = { title: string; paragraphs: { text: string; factIds: string[] }[] };
export type Fact = { id: string; claim: string; interesting: boolean; evidence: { sourceId: string; quote: string }[] };
export type Summary = {
  id: string; address: string; stage: string; revision: number; updatedAt: string;
  error: { code?: string; message: string } | null;
};
export type TtsProvider = "openai" | "yandex";
export type Job = Summary & {
  canApprove: boolean;
  ttsProviders: { id: TtsProvider; label: string; available: boolean; defaultVoice: string; voices: { id: string; label: string }[] }[];
  data: {
    ttsProvider: TtsProvider;
    ttsVoice: string | null;
    editorDraft: Draft | null; draft: Draft | null; draftCandidate: Draft | null;
    evidence: {
      placeName: string; resolvedAddress: string; facts: Fact[];
      sources: { id: string; url: string | null; title: string; publisher: string }[];
    } | null;
    review: { approved: boolean; issues: string[] } | null;
    factReview: { addressConfirmed: boolean; identityNote: string; placeName: string; resolvedAddress: string; facts: Fact[] } | null;
  };
};

export function initialDraft(job: Job): Draft {
  return job.data.editorDraft ?? job.data.draft ?? job.data.draftCandidate ?? {
    title: "", paragraphs: [{ text: "", factIds: [] }, { text: "", factIds: [] }],
  };
}

export function draftCheck(draft: Draft, facts: Fact[]) {
  const script = draft.paragraphs.map(p => p.text.trim()).join(" ").trim();
  const words = script ? script.split(/\s+/).length : 0;
  const used = new Set(draft.paragraphs.flatMap(p => p.factIds));
  const valid = Boolean(draft.title.trim()) && draft.title.length <= 140 &&
    draft.paragraphs.length >= 2 && draft.paragraphs.length <= 6 &&
    draft.paragraphs.every(p => p.text.trim() && p.text.length <= 2000 && p.factIds.length &&
      p.factIds.every(id => facts.some(f => f.id === id))) &&
    words >= 100 && words <= 250 && used.size >= 5;
  return { words, facts: used.size, valid };
}

export function safeSourceLink(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export const stages: Record<string, string> = {
  review_required: "Нужна редактура", queued: "В очереди", researching: "Поиск источников",
  verifying: "Проверка фактов", writing: "Подготовка текста",
  voicing: "Озвучивание", ready: "Готово", failed: "Ошибка", insufficient_evidence: "Недостаточно источников",
};
