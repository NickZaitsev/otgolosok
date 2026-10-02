import { expect, it } from "vitest";
import { canonicalIssues, improvementPath, validateImprovement } from "./model";

it.each([
  [{ kind: "catalog", id: "arbat" }, "/api/story-walks/arbat/improvements/mine"],
  [{ kind: "share", token: "11111111-1111-4111-8111-111111111111" }, "/api/story-walks/shared/11111111-1111-4111-8111-111111111111/improvements/mine"],
  [{ kind: "account", id: "22222222-2222-4222-8222-222222222222" }, "/api/me/walks/22222222-2222-4222-8222-222222222222/improvements/mine"],
] as const)("improvementPath(%o) → %s", (target, path) => {
  expect(improvementPath(target)).toBe(path);
});

it("canonicalIssues orders the selection like the form and the server", () => {
  expect(canonicalIssues(["voiceover", "short_text", "voiceover"])).toEqual(["short_text", "voiceover"]);
  expect(canonicalIssues([])).toEqual([]);
});

it("validateImprovement accepts a stored request or none", () => {
  expect(validateImprovement({ mine: null })).toEqual({ mine: null });
  const mine = { issues: ["no_images"], status: "resolved", updatedAt: "2026-10-02T10:00:00Z" };
  expect(validateImprovement({ mine })).toEqual({ mine });
});

it.each([
  null, [], {}, { mine: {} },
  { mine: { issues: [], status: "open", updatedAt: "x" } },
  { mine: { issues: ["loud"], status: "open", updatedAt: "x" } },
  { mine: { issues: ["voiceover"], status: "pending", updatedAt: "x" } },
  { mine: { issues: ["voiceover"], status: "open" } },
])("validateImprovement rejects %o", value => {
  expect(() => validateImprovement(value)).toThrow(TypeError);
});
