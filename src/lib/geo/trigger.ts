import { distanceMeters } from "./distance";
import type {
  GeoPoint,
  PositionFix,
  TriggerConfig,
  TriggerResult,
  TriggerState,
} from "./types";

export const DEFAULT_TRIGGER_CONFIG: TriggerConfig = {
  enterM: 35,
  exitM: 60,
  minFixes: 3,
  windowSize: 5,
  maxAccuracyM: 50,
};

export function createTriggerState(): TriggerState {
  return { phase: "outside", recentInside: [] };
}

export function resetTrigger(): TriggerState {
  return createTriggerState();
}

export function processFix(
  state: TriggerState,
  fix: PositionFix,
  target: GeoPoint,
  config: TriggerConfig = DEFAULT_TRIGGER_CONFIG,
  audioBusy = false,
): TriggerResult {
  if (
    !Number.isFinite(fix.lat) || Math.abs(fix.lat) > 90 ||
    !Number.isFinite(fix.lon) || Math.abs(fix.lon) > 180 ||
    !Number.isFinite(fix.accuracyM) || fix.accuracyM < 0 ||
    !Number.isFinite(fix.timestampMs) ||
    fix.accuracyM > config.maxAccuracyM
  ) {
    return { state, event: null, distanceM: null, ignored: true };
  }

  const distanceM = distanceMeters(fix, target);

  if (state.phase === "cooldown") {
    return { state, event: null, distanceM, ignored: false };
  }

  if (state.phase === "inside") {
    if (distanceM <= config.exitM) {
      return { state, event: null, distanceM, ignored: false };
    }

    return {
      state: { phase: "cooldown", recentInside: [] },
      event: { type: "exited", distanceM, timestampMs: fix.timestampMs },
      distanceM,
      ignored: false,
    };
  }

  const recentInside = [
    ...(config.windowSize > 1 ? state.recentInside.slice(-(config.windowSize - 1)) : []),
    distanceM <= config.enterM,
  ];
  const enoughInside =
    recentInside.length === config.windowSize &&
    recentInside.filter(Boolean).length >= config.minFixes;

  const currentFixInside = distanceM <= config.enterM;

  if (!enoughInside || !currentFixInside || audioBusy) {
    return {
      state: { phase: "outside", recentInside },
      event: null,
      distanceM,
      ignored: false,
    };
  }

  return {
    state: { phase: "inside", recentInside: [] },
    event: { type: "entered", distanceM, timestampMs: fix.timestampMs },
    distanceM,
    ignored: false,
  };
}
