import {createHash} from "node:crypto";
import {existsSync} from "node:fs";
import {readFile} from "node:fs/promises";
import {describe, expect, it} from "vitest";
import narration from "./guide-narration.json";
import createNarration from "./create-guide-narration.json";
import voice from "../assets/guide/voice/manifest.json";
import createVoice from "../assets/guide/create/voice/manifest.json";
import {GUIDE_BED_SECONDS} from "../scripts/prepare-video-assets.mjs";
import {PAGE_HEIGHT, PAGE_WIDTH} from "./guide-camera";
import {GUIDE, GUIDE_DURATION_IN_FRAMES, GUIDE_FPS, GUIDE_TRANSITION_FRAMES, guideTimeline, stepTiming, type GuideSpec} from "./guide-timeline";
import {CREATE_GUIDE, CREATE_GUIDE_DURATION_IN_FRAMES} from "./create-guide-timeline";
import {repoPath} from "../scripts/lib/paths.mjs";

const guides: [string, GuideSpec, Record<string, string>, Record<string, {text: string; sha256: string; durationSeconds: number}>, string, number][] = [
  ["как пользоваться сайтом", GUIDE, narration, voice, "video/assets/guide/voice", GUIDE_DURATION_IN_FRAMES],
  ["своя прогулка", CREATE_GUIDE, createNarration, createVoice, "video/assets/guide/create/voice", CREATE_GUIDE_DURATION_IN_FRAMES],
];

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

  it.each(guides)("ролик «%s» длится от одной до трёх минут и короче фоновой музыки", (_, guide, _narration, _voice, _dir, duration) => {
    expect(guideTimeline(guide.steps, guide.voice).timings).toHaveLength(guide.steps.length);
    expect(duration / GUIDE_FPS).toBeGreaterThan(60);
    expect(duration / GUIDE_FPS).toBeLessThan(Math.min(180, GUIDE_BED_SECONDS));
  });

  it("сообщает об отсутствующей озвучке, а не молчит", () => {
    expect(() => guideTimeline(GUIDE.steps, {})).toThrow("pnpm video:voice");
  });
});

describe.each(guides)("материалы инструкции «%s»", (_, guide, text, clips, voiceDir) => {
  const screens = [...new Set(guide.steps.flatMap(step => [step.before, step.after]))];
  // Снимки не хранятся в git и появляются только после съёмки (docs/agents/video-guide.md).
  const captured = screens.every(name => existsSync(repoPath(`video/assets/guide/${name}.png`)));

  it.skipIf(!captured)("каждое состояние снято в 2×", async () => {
    for (const name of screens) {
      const png = await readFile(repoPath(`video/assets/guide/${name}.png`));
      expect(png.subarray(1, 4).toString()).toBe("PNG");
      expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([PAGE_WIDTH * 2, PAGE_HEIGHT * 2]);
    }
  });

  it("цели нажатий лежат внутри снимка", () => {
    for (const step of guide.steps) expect(inside(guide.targets[step.before]), step.before).toBe(true);
  });

  it("камера каждого шага видит цель нажатия", () => {
    for (const step of guide.steps) {
      const target = guide.targets[step.before];
      const focus = step.focus;
      expect(target.x >= focus.x && target.y >= focus.y && target.x + target.width <= focus.x + focus.width && target.y + target.height <= focus.y + focus.height, step.id).toBe(true);
    }
  });

  it("озвучка соответствует текущему тексту и файлам", async () => {
    const needed = ["intro", "outro", ...guide.steps.flatMap(step => [`${step.id}-do`, `${step.id}-done`])];
    expect(Object.keys(text).sort()).toEqual([...needed].sort());
    for (const [id, phrase] of Object.entries(text)) {
      const clip = clips[id];
      expect(clip?.text, `${id}: перегенерируйте pnpm video:voice`).toBe(phrase);
      const bytes = await readFile(repoPath(`${voiceDir}/${id}.mp3`));
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(clip.sha256);
      expect(clip.durationSeconds).toBeGreaterThan(0.5);
    }
  });
});
