import {readFile} from "node:fs/promises";
import {describe, expect, it} from "vitest";
import targets from "../../video/assets/guide/targets.json";
import {GUIDE_STEPS, guidePhase} from "./guide-timeline";

describe("демонстрация действий в видеоинструкции", () => {
  it("показывает исходный экран до нажатия и результат с кадра нажатия", () => {
    expect(guidePhase(119, 300).clicked).toBe(false);
    expect(guidePhase(120, 300).clicked).toBe(true);
    expect(guidePhase(299, 300).clicked).toBe(true);
    expect(guidePhase(74, 150).clicked).toBe(false);
    expect(guidePhase(75, 150).clicked).toBe(true);
  });

  it.each([-1, 300, NaN, Infinity, 1.5])("не допускает кадр %s вне сцены", frame => {
    expect(() => guidePhase(frame, 300)).toThrow(RangeError);
  });

  it("все состояния имеют реальные кадры нужного размера, а подсветка попадает внутрь экрана", async () => {
    for (const name of new Set(GUIDE_STEPS.flatMap(step => [step.before, step.after]))) {
      const png = await readFile(`video/assets/guide/${name}.png`);
      expect(png.subarray(1, 4).toString()).toBe("PNG");
      expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1280, 800]);
      const box = targets[name];
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.width).toBeGreaterThan(0);
      expect(box.height).toBeGreaterThan(0);
      expect(box.x + box.width).toBeLessThanOrEqual(1280);
      expect(box.y + box.height).toBeLessThanOrEqual(800);
    }
  });
});
