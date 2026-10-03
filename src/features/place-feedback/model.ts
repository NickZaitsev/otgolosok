import { canonicalIssues, IMPROVEMENT_ISSUES, type ImprovementIssue } from "../improvements/model";

export const PLACE_FEEDBACK_TEXT_MAX = 1000;
export type PlaceRating = 1 | -1;
export type PlaceFeedbackInput = { rating: PlaceRating | null; issues: ImprovementIssue[]; text: string };
export type PlaceFeedback = PlaceFeedbackInput & { rating: PlaceRating; status: "open" | "resolved"; updatedAt: string };
export type PlaceFeedbackResponse = { mine: PlaceFeedback | null };

const OSM_PLACE = /^osm:(node|way|relation):\d+$/;

/** Votes belong to an OSM place: other IDs have nothing the server could store a vote for. */
export function canRatePlace(placeId: string) {
  return OSM_PLACE.test(placeId);
}

export function feedbackPath(placeId: string) {
  // IDs follow the same contract as the public place detail endpoint.
  if (!canRatePlace(placeId)) throw new TypeError("Неверное место.");
  return `/api/content/places/${placeId}/feedback/mine`;
}

export function validatePlaceFeedback(value: unknown): PlaceFeedbackResponse {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Неверный ответ оценки.");
  const mine = (value as Record<string, unknown>).mine;
  if (mine === null) return { mine: null };
  if (!mine || typeof mine !== "object" || Array.isArray(mine)) throw new TypeError("Неверная оценка.");
  const item = mine as Record<string, unknown>;
  if ((item.rating !== 1 && item.rating !== -1) || !Array.isArray(item.issues)
    || !item.issues.every(issue => IMPROVEMENT_ISSUES.includes(issue as ImprovementIssue))
    || new Set(item.issues).size !== item.issues.length
    || typeof item.text !== "string" || item.text.length > PLACE_FEEDBACK_TEXT_MAX
    || (item.rating === 1 && (item.issues.length || item.text))
    || !["open", "resolved"].includes(item.status as string) || typeof item.updatedAt !== "string") throw new TypeError("Неверная оценка.");
  return { mine: { rating: item.rating, issues: canonicalIssues(item.issues as ImprovementIssue[]), text: item.text, status: item.status as PlaceFeedback["status"], updatedAt: item.updatedAt } };
}
