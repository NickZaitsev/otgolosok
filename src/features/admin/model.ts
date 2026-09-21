export type Draft = { title: string; paragraphs: { text: string; factIds: string[] }[] };
export type AdminApi = <T>(path: string, signal: AbortSignal, body?: unknown) => Promise<T>;
export type AdminRun = (label: string, action: (signal: AbortSignal) => Promise<void>) => Promise<void>;
export type OpenAdminJob = (id: string, reload?: boolean) => void;
export type Fact = { id: string; claim: string; interesting: boolean; evidence: { sourceId: string; quote: string }[] };
export type Audio = {
  url: string; durationSec: number; voice: string | null; provider: TtsProvider; model: string;
};
export type Summary = {
  id: string; address: string; stage: string; revision: number; updatedAt: string; irrelevant: boolean;
  ttsProvider?: TtsProvider; ttsVoice?: string | null; audio?: Audio | null;
  error: { code?: string; message: string } | null;
};
export type TtsProvider = "openai" | "yandex";
export type ContentBatch = {
  id: string; name: string; state: string; mode: string; textProfile: string; ttsProfile: string | null;
  createdAt: string; updatedAt: string;
  counts: { total: number; queued: number; working: number; ready: number; failed: number };
};
export type ContentBatchItem = { placeId: string; name: string; address: string | null; state: string; error: { message?: string } | null };
export type ContentStatusFilter = "all" | "ready" | "waiting" | "stopped";

export function filterContentBatches(batches: ContentBatch[], filter: ContentStatusFilter): ContentBatch[] {
  if (filter === "all") return batches;
  return batches.filter(batch => filter === "ready" ? batch.counts.ready > 0
    : filter === "waiting" ? batch.counts.queued > 0
      : batch.counts.failed > 0);
}

export function filterContentBatchItems(items: ContentBatchItem[], filter: ContentStatusFilter): ContentBatchItem[] {
  if (filter === "all") return items;
  return items.filter(item => filter === "ready" ? item.state === "ready"
    : filter === "waiting" ? ["queued", "retry_wait"].includes(item.state)
      : ["failed", "review_required", "insufficient_evidence", "cancelled"].includes(item.state));
}
export type ContentPlace = {
  id: string; name: string; address: string | null; location: { lat: number; lon: number };
  text: null | { id: string; profile: string; story: Draft; draft: Draft; verification: string; audio: Audio | null; createdAt: string };
};
export type ContentWorker = { id: string; name: string; profiles: string[]; createdAt: string; lastSeenAt: string | null; revokedAt: string | null };
export type ContentHeartbeat = { credentialId: string; workerName: string; version: string | null; profileIds: string[]; currentJobId: string | null; progress: {stage?:string;percent?:number}|null; seenAt: string };
export type ContentAudioJob = { id:string; state:string; profileId:string; attempts:number; maxAttempts:number; updatedAt:string; placeId:string|null; placeName:string|null; error:{message?:string;code?:string}|null };
export type Job = Summary & {
  canApprove: boolean; canRegenerate: boolean; canRevoice: boolean; canRetry: boolean;
  ttsProviders: { id: TtsProvider; label: string; available: boolean; defaultVoice: string; voices: { id: string; label: string }[] }[];
  data: {
    ttsProvider: TtsProvider;
    ttsVoice: string | null;
    editorDraft: Draft | null; draft: Draft | null; draftCandidate: Draft | null; story: Draft | null;
    audio: Audio | null; revoice: { requestedAt: string } | null;
    evidence: {
      placeName: string; resolvedAddress: string; facts: Fact[];
      sources: { id: string; url: string | null; title: string; publisher: string }[];
    } | null;
    review: { approved: boolean; issues: string[] } | null;
    factReview: { addressConfirmed: boolean; identityNote: string; placeName: string; resolvedAddress: string; facts: Fact[] } | null;
  };
};

export function initialDraft(job: Job): Draft {
  return job.data.editorDraft ?? job.data.story ?? job.data.draft ?? job.data.draftCandidate ?? {
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
