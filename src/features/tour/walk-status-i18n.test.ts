import { describe, expect, it } from "vitest";
import { getStatusText, initialDiagnostics } from "./use-walk-position";

describe("статус прогулки на других языках", () => {
  it("объясняет отсутствие доступа к геолокации на английском", () => {
    expect(getStatusText({ ...initialDiagnostics, sourceStatus: "permission-denied" }, 60, "en"))
      .toBe("Location access denied · audio is available from the button");
  });

  it("показывает точность с параметром на упрощённом китайском", () => {
    expect(getStatusText({
      ...initialDiagnostics,
      sourceStatus: "active",
      lastFix: { lat: 55.75, lon: 37.61, accuracyM: 85, timestampMs: 1 },
    }, 60, "zh")).toBe("正在提高定位精度 · ±85 米");
  });
});
