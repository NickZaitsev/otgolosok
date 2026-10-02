import { reviewsPath, type ReviewTarget } from "../reviews/model";

export const IMPROVEMENT_ISSUES = ["short_text", "no_images", "voiceover"] as const;
export type ImprovementIssue = (typeof IMPROVEMENT_ISSUES)[number];
export type ImprovementStatus = "open" | "resolved";
export type MyImprovement = { issues: ImprovementIssue[]; status: ImprovementStatus; updatedAt: string };

export const improvementIssueLabels: Record<ImprovementIssue, string> = {
  short_text: "Мало информации: тексты слишком короткие",
  no_images: "Нет превью изображений",
  voiceover: "Не нравится озвучка",
};

/** Requests live beside the reviews of the same walk: `/…/reviews` becomes `/…/improvements/mine`. */
export function improvementPath(target: ReviewTarget) {
  return reviewsPath(target).replace(/\/reviews$/, "/improvements/mine");
}

const isIssue = (value: unknown): value is ImprovementIssue => IMPROVEMENT_ISSUES.includes(value as ImprovementIssue);

export function validateImprovement(value: unknown): { mine: MyImprovement | null } {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Ожидался объект.");
  const mine = (value as Record<string, unknown>).mine;
  if (mine === null) return { mine: null };
  if (!mine || typeof mine !== "object") throw new TypeError("Неверный запрос на улучшение.");
  const item = mine as Record<string, unknown>;
  if (!Array.isArray(item.issues) || !item.issues.length || !item.issues.every(isIssue)) throw new TypeError("Неверный список причин.");
  if (item.status !== "open" && item.status !== "resolved") throw new TypeError("Неверный статус запроса.");
  if (typeof item.updatedAt !== "string") throw new TypeError("Неверная дата запроса.");
  return { mine: { issues: item.issues, status: item.status, updatedAt: item.updatedAt } };
}

/** The selection in canonical order, as the server stores it, so a no-op edit is easy to spot. */
export function canonicalIssues(selected: Iterable<ImprovementIssue>) {
  const set = new Set(selected);
  return IMPROVEMENT_ISSUES.filter(issue => set.has(issue));
}
