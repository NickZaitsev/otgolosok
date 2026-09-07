export type GenerationStage = "queued" | "researching" | "verifying" | "writing" | "voicing" | "ready" | "insufficient_evidence" | "review_required" | "failed";
export type GeneratedStory = {
  title: string; address: string; wordCount: number; verification: "automatic" | "editorial";
  paragraphs: Array<{text: string; factIds: string[]}>;
  sources: Array<{id: string; title: string; url: string; publisher: string}>;
  facts: Array<{id: string; claim: string; sourceIds: string[]}>;
};
export type GenerationJob = {
  id: string; address: string; stage: GenerationStage; revision: number;
  createdAt: string; updatedAt: string; elapsedSec: number; canRetry: boolean;
  error: {code: string; message: string} | null;
  story: GeneratedStory | null;
  audio: {url: string; sha256: string; bytes: number; durationSec: number; synthetic: boolean} | null;
};
export const terminalStages = new Set<GenerationStage>(["ready","failed","review_required","insufficient_evidence"]);
export const stageLabels: Record<GenerationStage,string> = {
  queued:"Ждём своей очереди",researching:"Ищем источники",verifying:"Проверяем факты",writing:"Готовим рассказ",voicing:"Озвучиваем",ready:"История готова",
  insufficient_evidence:"Не хватило подтверждений",review_required:"Нужна проверка редактора",failed:"Подготовка прервалась",
};
