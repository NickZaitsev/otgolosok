import { distanceMeters } from "../../geo/distance";
import type { GeoPoint, PositionFix } from "../../geo/types";

export const WALK_REPLAY_STEP_M = 8;
export const WALK_REPLAY_ACCURACY_M = 12;
export const WALK_REPLAY_SPEED_MPS = 1.4;
/** Fixes are spaced by the time an unhurried walker needs to cover one step. */
export const WALK_REPLAY_INTERVAL_MS = Math.round(WALK_REPLAY_STEP_M / WALK_REPLAY_SPEED_MPS * 1000);
const MAX_FIXES = 2_000;

export type WalkReplayOptions = {
  stepM?: number;
  accuracyM?: number;
  startMs?: number;
  intervalMs?: number;
  /** Extra fixes held at the finish so the last trigger window can fill. */
  dwellFixes?: number;
};

/**
 * A walker moving along the routed path at a steady pace.
 *
 * The clean fixture approaches one synthetic point and cannot reach the stops of
 * a multi-chapter walk, so checking place-based chapter starts at a desk needs a
 * track that follows the real line. Timestamps advance at walking speed, which
 * is what makes the check meaningful: a faster track outruns the narration and
 * every trigger is suppressed while a recording plays.
 */
export function createWalkReplayTrack(path: readonly GeoPoint[], options: WalkReplayOptions = {}): PositionFix[] {
  const stepM = options.stepM ?? WALK_REPLAY_STEP_M;
  const accuracyM = options.accuracyM ?? WALK_REPLAY_ACCURACY_M;
  const intervalMs = options.intervalMs ?? WALK_REPLAY_INTERVAL_MS;
  const startMs = options.startMs ?? 1_000;
  const dwellFixes = options.dwellFixes ?? 5;
  const points = path.filter((point) => Number.isFinite(point?.lat) && Number.isFinite(point?.lon));
  if (points.length < 2 || !(stepM > 0) || !Number.isFinite(intervalMs) || intervalMs < 0) return [];

  const fixes: PositionFix[] = [];
  const push = (point: GeoPoint) => {
    if (fixes.length >= MAX_FIXES) return;
    fixes.push({ lat: point.lat, lon: point.lon, accuracyM, timestampMs: startMs + fixes.length * intervalMs });
  };

  push(points[0]);
  // Distance already covered since the last emitted fix.
  let carry = 0;
  for (let index = 1; index < points.length && fixes.length < MAX_FIXES; index += 1) {
    const from = points[index - 1];
    const to = points[index];
    const length = distanceMeters(from, to);
    if (!(length > 0)) continue;
    for (let travelled = stepM - carry; travelled <= length; travelled += stepM) {
      const ratio = travelled / length;
      push({ lat: from.lat + (to.lat - from.lat) * ratio, lon: from.lon + (to.lon - from.lon) * ratio });
    }
    carry = (carry + length) % stepM;
  }
  const finish = points.at(-1)!;
  if (distanceMeters(fixes.at(-1)!, finish) > 0) push(finish);
  for (let index = 0; index < dwellFixes; index += 1) push(finish);
  return fixes;
}
