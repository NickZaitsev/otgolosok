import {describe, expect, it} from "vitest";
import {wideMotionScore} from "../../scripts/motion-wide-score.mjs";
import {WIDE_DURATION_IN_FRAMES, WIDE_FPS, WIDE_LOCKUP_FRAME, WIDE_SCENES, layoutWideScenes, wideScene} from "./motion-wide-timeline";

describe("горизонтальный моушн-ролик", () => {
  it("идёт около 30 секунд, сцены перекрываются ровно на длину перехода", () => {
    expect(WIDE_DURATION_IN_FRAMES / WIDE_FPS).toBeGreaterThan(28);
    expect(WIDE_DURATION_IN_FRAMES / WIDE_FPS).toBeLessThanOrEqual(31);
    expect(WIDE_SCENES[0].start).toBe(0);
  });

  it("ставит удары музыки на склейки и эхо на сборку логотипа", () => {
    const score = wideMotionScore();
    expect(score.seconds * WIDE_FPS).toBe(WIDE_DURATION_IN_FRAMES);
    expect(score.cuts.map((cut) => Math.round(cut * WIDE_FPS))).toEqual(WIDE_SCENES.slice(1).map(({start}) => start));
    expect(score.duck.map((time) => Math.round(time * WIDE_FPS))).toEqual([wideScene("facts").start, wideScene("facts").end]);
    expect(Math.round(score.finale * WIDE_FPS)).toBe(wideScene("outro").start + WIDE_LOCKUP_FRAME);
  });

  it("раскладывает сцены с учётом наложений", () => {
    expect(layoutWideScenes([{id: "hook", frames: 30}, {id: "logo", frames: 40}, {id: "claim", frames: 20}], [10, 5]).map(({start, end}) => [start, end])).toEqual([[0, 30], [20, 60], [55, 75]]);
  });

  it.each([
    {name: "лишний переход", transitions: [5, 5]},
    {name: "переход длиннее сцены", transitions: [30]},
  ])("отклоняет раскладку: $name", ({transitions}) => {
    expect(() => layoutWideScenes([{id: "hook", frames: 30}, {id: "logo", frames: 40}], transitions)).toThrow(RangeError);
  });
});
