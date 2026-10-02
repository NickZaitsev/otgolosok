import { identityHeaders, type Reviewer } from "../reviews/api";
import type { ReviewTarget } from "../reviews/model";
import { loadJson } from "../walks/walk-loader";
import { improvementPath, validateImprovement, type ImprovementIssue } from "./model";

export function loadImprovement(target: ReviewTarget, reviewer: Reviewer, signal: AbortSignal) {
  return loadJson(improvementPath(target), signal, validateImprovement, 3, undefined, { headers: identityHeaders(reviewer, false) });
}

// PUT replaces the whole request, so a retry after a lost response is safe.
export function saveImprovement(target: ReviewTarget, reviewer: Reviewer, issues: ImprovementIssue[], signal: AbortSignal) {
  return loadJson(improvementPath(target), signal, validateImprovement, 3, { issues }, { method: "PUT", headers: identityHeaders(reviewer, true) });
}
