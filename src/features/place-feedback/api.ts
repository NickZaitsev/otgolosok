import { identityHeaders, type Reviewer } from "../reviews/api";
import { loadJson } from "../walks/walk-loader";
import { feedbackPath, validatePlaceFeedback, type PlaceFeedbackInput } from "./model";

export function loadPlaceFeedback(id: string, reviewer: Reviewer, signal: AbortSignal) {
  return loadJson(feedbackPath(id), signal, validatePlaceFeedback, 3, undefined, { headers: identityHeaders(reviewer, false) });
}

export function savePlaceFeedback(id: string, reviewer: Reviewer, input: PlaceFeedbackInput, signal: AbortSignal) {
  return loadJson(feedbackPath(id), signal, validatePlaceFeedback, 3, input, { method: "PUT", headers: identityHeaders(reviewer, true) });
}
