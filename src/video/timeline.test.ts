import {describe, expect, it} from "vitest";
import {DURATION_IN_FRAMES, FPS, getSceneAt, SCENES} from "./timeline";

describe("проморолик", () => {
  it("покрывает 18 секунд без пустых кадров и наложения сцен", () => {
    expect(DURATION_IN_FRAMES / FPS).toBe(18);
    expect(SCENES[0].start).toBe(0);

    for (let index = 1; index < SCENES.length; index += 1) {
      expect(SCENES[index].start).toBe(SCENES[index - 1].end);
    }

    for (let frame = 0; frame < DURATION_IN_FRAMES; frame += 1) {
      expect(getSceneAt(frame).localFrame).toBeGreaterThanOrEqual(0);
    }
  });

  it.each(SCENES.slice(1))("переключает сцену на первом кадре $id", ({id, start}) => {
    expect(getSceneAt(start)).toEqual({id, localFrame: 0});
  });

  it.each([-1, DURATION_IN_FRAMES, 1.5, Number.NaN])("отклоняет недопустимый кадр %s", (frame) => {
    expect(() => getSceneAt(frame)).toThrow(RangeError);
  });
});
