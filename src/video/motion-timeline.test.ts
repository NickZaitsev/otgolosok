import {describe, expect, it} from "vitest";
import {MOTION_DURATION_IN_FRAMES, MOTION_FPS, MOTION_SCENES, MOTION_TRANSITION_FRAMES, getMotionFrameState} from "./motion-timeline";

describe("моушн-ролик", () => {
  it("длится 30 секунд без дыр и наложений между сценами", () => {
    expect(MOTION_DURATION_IN_FRAMES / MOTION_FPS).toBe(30);
    expect(MOTION_SCENES[0].start).toBe(0);
    for (let index = 1; index < MOTION_SCENES.length; index += 1) {
      expect(MOTION_SCENES[index].start).toBe(MOTION_SCENES[index - 1].end);
      // Переход не должен быть длиннее сцены, иначе под ним окажутся две сцены назад.
      expect(MOTION_SCENES[index].end - MOTION_SCENES[index].start).toBeGreaterThan(MOTION_TRANSITION_FRAMES);
    }
  });

  it("показывает уходящую сцену только в начале перехода", () => {
    const [echo, place] = MOTION_SCENES;
    expect(getMotionFrameState(0)).toEqual({id: "echo", localFrame: 0, outgoing: null, transition: 1});
    expect(getMotionFrameState(place.start)).toEqual({id: "place", localFrame: 0, outgoing: {id: "echo", localFrame: echo.end - echo.start}, transition: 0});
    const last = getMotionFrameState(place.start + MOTION_TRANSITION_FRAMES - 1);
    expect(last.outgoing?.id).toBe("echo");
    expect(last.transition).toBeLessThan(1);
    expect(getMotionFrameState(place.start + MOTION_TRANSITION_FRAMES)).toMatchObject({outgoing: null, transition: 1});
  });

  it.each([-1, 0.5, MOTION_DURATION_IN_FRAMES])("отклоняет кадр %s", (frame) => {
    expect(() => getMotionFrameState(frame)).toThrow(RangeError);
  });
});
