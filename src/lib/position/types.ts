import type { PositionFix } from "../geo/types";

export type PositionSourceKind = "browser" | "replay";

export type PositionSourceStatus =
  | "starting"
  | "active"
  | "stopped"
  | "complete"
  | "permission-denied"
  | "unavailable"
  | "error";

export type PositionSourceErrorCode =
  | "permission-denied"
  | "position-unavailable"
  | "timeout"
  | "unknown";

export type PositionSourceError = {
  code: PositionSourceErrorCode;
  message: string;
};

export type PositionSourceFixUpdate = {
  type: "fix";
  source: PositionSourceKind;
  /** One-based sequence number within this subscription. */
  sequence: number;
  fix: PositionFix;
};

export type PositionSourceStatusUpdate =
  | {
      type: "status";
      source: PositionSourceKind;
      status: "starting" | "active" | "stopped" | "complete";
    }
  | {
      type: "status";
      source: PositionSourceKind;
      status: "permission-denied" | "unavailable" | "error";
      error: PositionSourceError;
    };

export type PositionSourceUpdate = PositionSourceFixUpdate | PositionSourceStatusUpdate;

export type PositionSourceListener = (update: PositionSourceUpdate) => void;

export type StopPositionSource = () => void;

export interface PositionSource {
  readonly kind: PositionSourceKind;
  subscribe(listener: PositionSourceListener): StopPositionSource;
}
