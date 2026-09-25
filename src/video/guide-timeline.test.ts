import {createHash} from "node:crypto";
import {readFile} from "node:fs/promises";
import {describe, expect, it} from "vitest";
import narration from "./guide-narration.json";
import voice from "../../video/assets/guide/voice/manifest.json";
import targets from "../../video/assets/guide/targets.json";
import {GUIDE_BED_SECONDS} from "../../scripts/prepare-video-assets.mjs";
import {PAGE_HEIGHT, PAGE_WIDTH} from "./guide-camera";
import {GUIDE_DURATION_IN_FRAMES, GUIDE_FPS, GUIDE_STEPS, GUIDE_TIMINGS, GUIDE_TRANSITION_FRAMES, stepTiming} from "./guide-timeline";

const inside = (box: {x: number; y: number; width: number; height: number}) =>
  box.x >= 0 && box.y >= 0 && box.width > 0 && box.height > 0 && box.x + box.width <= PAGE_WIDTH && box.y + box.height <= PAGE_HEIGHT;

describe("хронометраж видеоинструкции", () => {
  it.each([
    ["короткая инструкция — нажатие не раньше 80-го кадра", 30, 60, 80],
    ["длинная инструкция — нажатие после её окончания", 120, 60, 145],
    ["граница: 55 кадров дают ровно 80", 55, 45, 80],
  ])("%s", (_, doFrames, doneFrames, click) => {
    const timing = stepTiming(doFrames, doneFrames);
    expect(timing.clickFrame).toBe(click);
    expect(timing.doFrom + doFrames).toBeLessThan(timing.clickFrame);
    expect(timing.doneFrom).toBeGreaterThan(timing.clickFrame);
    // Голос результата заканчивается до начала перехода к следующей сцене.
    expect(timing.doneFrom + doneFrames).toBeLessThanOrEqual(timing.duration - GUIDE_TRANSITION_FRAMES);
  });

  it.each([[0, 30], [30, -1], [1.5, 30], [NaN, 30]])("отклоняет длительность %s/%s", (doFrames, doneFrames) => {
    expect(() => stepTiming(doFrames, doneFrames)).toThrow(RangeError);
  });

  it("ролик длится от одной до трёх минут и короче фоновой музыки", () => {
    expect(GUIDE_TIMINGS).toHaveLength(GUIDE_STEPS.length);
    expect(GUIDE_DURATION_IN_FRAMES / GUIDE_FPS).toBeGreaterThan(60);
    expect(GUIDE_DURATION_IN_FRAMES / GUIDE_FPS).toBeLessThan(Math.min(180, GUIDE_BED_SECONDS));
  });
});

describe("материалы видеоинструкции", () => {
  it("каждое состояние снято в 2× и цели лежат внутри снимка", async () => {
    for (const name of new Set(GUIDE_STEPS.flatMap(step => [step.before, step.after]))) {
      const png = await readFile(`video/assets/guide/${name}.png`);
      expect(png.subarray(1, 4).toString()).toBe("PNG");
      expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([PAGE_WIDTH * 2, PAGE_HEIGHT * 2]);
      expect(inside(targets[name as keyof typeof targets]), name).toBe(true);
    }
  });

  it("камера каждого шага видит цель нажатия", () => {
    for (const step of GUIDE_STEPS) {
      const target = targets[step.before];
      const focus = step.focus;
      expect(target.x >= focus.x && target.y >= focus.y && target.x + target.width <= focus.x + focus.width && target.y + target.height <= focus.y + focus.height, step.id).toBe(true);
    }
  });

  it("озвучка соответствует текущему тексту и файлам", async () => {
    const needed = ["intro", "outro", ...GUIDE_STEPS.flatMap(step => [`${step.id}-do`, `${step.id}-done`])];
    expect(Object.keys(narration).sort()).toEqual([...needed].sort());
    for (const [id, text] of Object.entries(narration)) {
      const clip = voice[id as keyof typeof voice];
      expect(clip?.text, `${id}: перегенерируйте pnpm video:voice`).toBe(text);
      const bytes = await readFile(`video/assets/guide/voice/${id}.mp3`);
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(clip.sha256);
      expect(clip.durationSeconds).toBeGreaterThan(0.5);
    }
  });
});
