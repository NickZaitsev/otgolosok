export type PositionFix = {
  lat: number;
  lon: number;
  accuracyM: number;
  timestampMs: number;
};

export type GeoPoint = {
  lat: number;
  lon: number;
};

export type TriggerConfig = {
  enterM: number;
  exitM: number;
  minFixes: number;
  windowSize: number;
  maxAccuracyM: number;
};

export type TriggerPhase = "outside" | "inside" | "cooldown";

export type TriggerState = {
  phase: TriggerPhase;
  recentInside: boolean[];
};

export type TriggerEvent = {
  type: "entered" | "exited";
  distanceM: number;
  timestampMs: number;
};

export type TriggerResult = {
  state: TriggerState;
  event: TriggerEvent | null;
  distanceM: number | null;
  ignored: boolean;
};
