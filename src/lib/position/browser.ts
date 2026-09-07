import type { PositionFix } from "../geo/types";
import type {
  PositionSource,
  PositionSourceError,
  PositionSourceListener,
} from "./types";

const DEFAULT_POSITION_OPTIONS: PositionOptions = {
  enableHighAccuracy: true,
  maximumAge: 2_000,
  timeout: 15_000,
};

export type BrowserPositionSourceOptions = {
  geolocation?: Geolocation | null;
  positionOptions?: PositionOptions;
};

function defaultGeolocation(): Geolocation | null {
  if (typeof navigator === "undefined") return null;
  return navigator.geolocation ?? null;
}

function toFix(position: GeolocationPosition): PositionFix {
  return {
    lat: position.coords.latitude,
    lon: position.coords.longitude,
    accuracyM: position.coords.accuracy,
    timestampMs: position.timestamp,
  };
}

function toSourceError(error: GeolocationPositionError): PositionSourceError {
  switch (error.code) {
    case error.PERMISSION_DENIED:
      return { code: "permission-denied", message: error.message };
    case error.POSITION_UNAVAILABLE:
      return { code: "position-unavailable", message: error.message };
    case error.TIMEOUT:
      return { code: "timeout", message: error.message };
    default:
      return { code: "unknown", message: error.message };
  }
}

function errorStatus(
  error: PositionSourceError,
): "permission-denied" | "unavailable" | "error" {
  if (error.code === "permission-denied") return "permission-denied";
  if (error.code === "position-unavailable") return "unavailable";
  return "error";
}

export function createBrowserPositionSource(
  options: BrowserPositionSourceOptions = {},
): PositionSource {
  return {
    kind: "browser",
    subscribe(listener: PositionSourceListener) {
      const geolocation = Object.hasOwn(options, "geolocation")
        ? (options.geolocation ?? null)
        : defaultGeolocation();
      let stopped = false;
      let watchId: number | null = null;
      let sequence = 0;
      let active = false;

      listener({ type: "status", source: "browser", status: "starting" });

      if (!geolocation) {
        listener({
          type: "status",
          source: "browser",
          status: "unavailable",
          error: {
            code: "position-unavailable",
            message: "Geolocation API is not available in this browser.",
          },
        });
        stopped = true;
        return () => undefined;
      }

      const onPosition = (position: GeolocationPosition) => {
        if (stopped) return;

        if (!active) {
          active = true;
          listener({ type: "status", source: "browser", status: "active" });
        }

        sequence += 1;
        listener({
          type: "fix",
          source: "browser",
          sequence,
          fix: toFix(position),
        });
      };

      const onError = (error: GeolocationPositionError) => {
        if (stopped) return;
        active = false;
        const sourceError = toSourceError(error);
        listener({
          type: "status",
          source: "browser",
          status: errorStatus(sourceError),
          error: sourceError,
        });
      };

      try {
        watchId = geolocation.watchPosition(
          onPosition,
          onError,
          options.positionOptions ?? DEFAULT_POSITION_OPTIONS,
        );
      } catch (error) {
        const sourceError: PositionSourceError = {
          code: "unknown",
          message: error instanceof Error ? error.message : "Unable to start geolocation.",
        };
        listener({
          type: "status",
          source: "browser",
          status: "error",
          error: sourceError,
        });
        stopped = true;
      }

      return () => {
        if (stopped) return;
        stopped = true;
        if (watchId !== null) geolocation.clearWatch(watchId);
        listener({ type: "status", source: "browser", status: "stopped" });
      };
    },
  };
}
