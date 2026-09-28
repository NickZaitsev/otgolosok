import { describe, expect, it } from "vitest";
import type { TriggerState } from "@/lib/geo/types";
import { getStatusText, initialDiagnostics, positionFailed, signalTone, type Diagnostics } from "./use-walk-position";

const fix = (accuracyM: number) => ({ lat: 55.75, lon: 37.6, accuracyM, timestampMs: 0 });
const state = (patch: Partial<Diagnostics>, phase: TriggerState["phase"] = "outside"): Diagnostics =>
  ({ ...initialDiagnostics, ...patch, trigger: { ...initialDiagnostics.trigger, phase } });

describe("состояние геопозиции на экране прогулки", () => {
  it.each([
    ["доступ запрещён", state({ sourceStatus: "permission-denied" }), "Нет доступа к геолокации · звук доступен по кнопке", "warning", true],
    ["нет сигнала", state({ sourceStatus: "unavailable" }), "Нет сигнала GPS · звук доступен по кнопке", "warning", true],
    ["ошибка источника", state({ sourceStatus: "error" }), "Нет сигнала GPS · звук доступен по кнопке", "warning", true],
    ["тестовый трек закончился", state({ sourceStatus: "complete" }), "Тестовый трек завершён", "neutral", false],
    ["ещё нет координат", state({ sourceStatus: "active" }), "Ищем сигнал GPS…", "neutral", false],
    ["точность хуже порога", state({ sourceStatus: "active", lastFix: fix(80) }), "Уточняем позицию · ±80 м", "warning", false],
    ["точность на пороге", state({ sourceStatus: "active", lastFix: fix(35) }), "Слушаем город · ±35 м", "good", false],
    ["в зоне точки", state({ sourceStatus: "active", lastFix: fix(10) }, "inside"), "Вы у точки", "good", false],
    ["точка пройдена", state({ sourceStatus: "active", lastFix: fix(10) }, "cooldown"), "Точка пройдена", "good", false],
  ] as const)("%s", (_, diagnostics, text, tone, failed) => {
    expect(getStatusText(diagnostics, 35)).toBe(text);
    expect(signalTone(diagnostics, 35)).toBe(tone);
    expect(positionFailed(diagnostics)).toBe(failed);
  });
});
