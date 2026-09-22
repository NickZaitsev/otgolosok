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
export type ContentBatchItemPage = { items: ContentBatchItem[]; total: number; hasMore: boolean };
export type ContentStatusFilter = "all" | "ready" | "working" | "waiting" | "stopped";

export const batchStates: Record<string, string> = {
  running: "Выполняется", paused: "На паузе", cancelled: "Отменена",
};

/** Every state a batch item can hold; the four status buckets below partition this set. */
export const batchItemStates: Record<string, string> = {
  queued: "В очереди", retry_wait: "Ждёт повтора", working: "В работе", ready: "Готово",
  failed: "Ошибка", review_required: "Нужна редактура", insufficient_evidence: "Недостаточно источников", cancelled: "Отменено",
};

/** Mirrors BATCH_ITEM_STATES in backend/content-store.mjs — the server filters items by the same buckets. */
export const contentStatusStates: Record<Exclude<ContentStatusFilter, "all">, string[]> = {
  ready: ["ready"],
  working: ["working"],
  waiting: ["queued", "retry_wait"],
  stopped: ["failed", "review_required", "insufficient_evidence", "cancelled"],
};

/** Labels spell out which item states a bucket covers, so the filter needs no separate legend. */
export const contentStatusOptions: { value: ContentStatusFilter; label: string }[] = [
  { value: "all", label: "Любой статус" },
  { value: "ready", label: "Готово" },
  { value: "working", label: "В работе" },
  { value: "waiting", label: "Ждут очереди или повтора" },
  { value: "stopped", label: "Остановлены: ошибка, редактура, нет источников, отмена" },
];

export const retryableItemStates = ["failed", "review_required", "insufficient_evidence", "retry_wait"];

const batchCountKey: Record<Exclude<ContentStatusFilter, "all">, keyof ContentBatch["counts"]> = {
  ready: "ready", working: "working", waiting: "queued", stopped: "failed",
};

/** A batch matches when at least one of its items sits in the bucket; counts in the row stay complete. */
export function filterContentBatches(batches: ContentBatch[], filter: ContentStatusFilter): ContentBatch[] {
  if (filter === "all") return batches;
  return batches.filter(batch => batch.counts[batchCountKey[filter]] > 0);
}

/** Human range for a server-paged list: "51–100 из 6107". */
export function pageRange(offset: number, count: number, total: number) {
  if (!total || !count) return "0";
  return `${offset + 1}–${offset + count} из ${total}`;
}

export function pageCount(total: number, size: number) {
  return Math.max(1, Math.ceil(total / size));
}
export type ContentPlace = {
  id: string; name: string; address: string | null; location: { lat: number; lon: number };
  text: null | { id: string; profile: string; story: Draft; draft: Draft; verification: string; audio: Audio | null; createdAt: string };
};
/** Catalog rows come from listPlaces, which reports text presence instead of the full text record. */
export type ContentPlaceSummary = {
  id: string; name: string; address: string | null; textStatus: "none" | "draft" | "approved"; audio: Audio | null;
};
export type ContentPlaceStatusFilter = "all" | "ready" | "missing";
export const placeTextStatuses: Record<ContentPlaceSummary["textStatus"], string> = {
  none: "Нет текста", draft: "Черновик", approved: "Утверждён",
};
export const placeStatusOptions: { value: ContentPlaceStatusFilter; label: string }[] = [
  { value: "all", label: "Все места" },
  { value: "ready", label: "Только с утверждённым текстом" },
  { value: "missing", label: "Только без текста" },
];
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
