import type { PositionFix } from "../../geo/types";

export const CLEAN_REPLAY_TARGET = {
  lat: 55.72326,
  lon: 37.65309,
} as const;

const METERS_PER_LATITUDE_DEGREE = 111_111;

function fixNorthOfTarget(
  distanceM: number,
  accuracyM: number,
  timestampMs: number,
): PositionFix {
  return {
    lat: CLEAN_REPLAY_TARGET.lat + distanceM / METERS_PER_LATITUDE_DEGREE,
    lon: CLEAN_REPLAY_TARGET.lon,
    accuracyM,
    timestampMs,
  };
}

/**
 * Deterministic happy-path walk for the first Paveletskaya POI.
 *
 * It starts with an ignored, inaccurate fix, fills the five-fix trigger window
 * with three points inside 35 m, stays inside briefly, then exits beyond 60 m.
 */
export const CLEAN_REPLAY_TRACK: readonly PositionFix[] = [
  fixNorthOfTarget(18, 80, 1_000),
  fixNorthOfTarget(75, 8, 2_000),
  fixNorthOfTarget(30, 8, 3_000),
  fixNorthOfTarget(45, 8, 4_000),
  fixNorthOfTarget(20, 8, 5_000),
  fixNorthOfTarget(10, 8, 6_000),
  fixNorthOfTarget(25, 8, 7_000),
  fixNorthOfTarget(75, 8, 8_000),
];

export const cleanReplayFixes = CLEAN_REPLAY_TRACK;
