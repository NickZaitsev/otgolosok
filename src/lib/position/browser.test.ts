import { describe, expect, it, vi } from "vitest";
import { createBrowserPositionSource } from "./browser";
import type { PositionSourceUpdate } from "./types";

type WatchCallbacks = {
  success?: PositionCallback;
  error?: PositionErrorCallback;
};

function createGeolocationMock() {
  const callbacks: WatchCallbacks = {};
  const clearWatch = vi.fn();
  const watchPosition = vi.fn(
    (success: PositionCallback, error?: PositionErrorCallback | null) => {
      callbacks.success = success;
      callbacks.error = error ?? undefined;
      return 17;
    },
  );

  return {
    callbacks,
    clearWatch,
    geolocation: { watchPosition, clearWatch } as unknown as Geolocation,
    watchPosition,
  };
}

function position(): GeolocationPosition {
  return {
    coords: {
      accuracy: 7,
      altitude: null,
      altitudeAccuracy: null,
      heading: null,
      latitude: 55.72326,
      longitude: 37.65309,
      speed: null,
      toJSON: () => ({}),
    },
    timestamp: 12_345,
    toJSON: () => ({}),
  };
}

describe("browser position source", () => {
  it("maps browser positions to domain fixes and clears the watch on stop", () => {
    const mock = createGeolocationMock();
    const updates: PositionSourceUpdate[] = [];
    const stop = createBrowserPositionSource({ geolocation: mock.geolocation }).subscribe(
      (update) => updates.push(update),
    );

    expect(updates).toEqual([
      { type: "status", source: "browser", status: "starting" },
    ]);

    mock.callbacks.success?.(position());
    mock.callbacks.success?.(position());

    expect(updates.slice(1)).toEqual([
      { type: "status", source: "browser", status: "active" },
      {
        type: "fix",
        source: "browser",
        sequence: 1,
        fix: {
          lat: 55.72326,
          lon: 37.65309,
          accuracyM: 7,
          timestampMs: 12_345,
        },
      },
      {
        type: "fix",
        source: "browser",
        sequence: 2,
        fix: {
          lat: 55.72326,
          lon: 37.65309,
          accuracyM: 7,
          timestampMs: 12_345,
        },
      },
    ]);

    stop();
    stop();
    expect(mock.clearWatch).toHaveBeenCalledOnce();
    expect(mock.clearWatch).toHaveBeenCalledWith(17);
    expect(updates.at(-1)).toEqual({
      type: "status",
      source: "browser",
      status: "stopped",
    });
  });

  it("reports missing geolocation without touching the browser global", () => {
    const updates: PositionSourceUpdate[] = [];
    createBrowserPositionSource({ geolocation: null }).subscribe((update) =>
      updates.push(update),
    );

    expect(updates.at(-1)).toMatchObject({
      type: "status",
      status: "unavailable",
      error: { code: "position-unavailable" },
    });
  });

  it.each([
    [1, "permission-denied", "permission-denied"],
    [2, "unavailable", "position-unavailable"],
    [3, "error", "timeout"],
  ] as const)("maps geolocation error %s to %s", (code, status, errorCode) => {
    const mock = createGeolocationMock();
    const updates: PositionSourceUpdate[] = [];
    createBrowserPositionSource({ geolocation: mock.geolocation }).subscribe((update) =>
      updates.push(update),
    );

    mock.callbacks.error?.({
      code,
      message: "Location failed",
      PERMISSION_DENIED: 1,
      POSITION_UNAVAILABLE: 2,
      TIMEOUT: 3,
    });

    expect(updates.at(-1)).toMatchObject({
      type: "status",
      status,
      error: { code: errorCode, message: "Location failed" },
    });
  });

  it("reports active again after a temporary positioning error", () => {
    const mock = createGeolocationMock();
    const updates: PositionSourceUpdate[] = [];
    createBrowserPositionSource({ geolocation: mock.geolocation }).subscribe((update) =>
      updates.push(update),
    );

    mock.callbacks.success?.(position());
    mock.callbacks.error?.({
      code: 3,
      message: "Timed out",
      PERMISSION_DENIED: 1,
      POSITION_UNAVAILABLE: 2,
      TIMEOUT: 3,
    });
    mock.callbacks.success?.(position());

    expect(
      updates.filter(
        (update) => update.type === "status" && update.status === "active",
      ),
    ).toHaveLength(2);
  });
});
