import {readFileSync} from "node:fs";
import {describe, expect, it} from "vitest";
import {AD_DURATION_IN_FRAMES, AD_FPS, AD_SCENES, getAdSceneAt} from "./ad-timeline";
import {pointOnRoute, ROUTE_LENGTH, ROUTE_PATH} from "./route-geometry";

describe("рекламный ролик", () => {
  it("покрывает 24 секунды без дыр между сценами", () => {
    expect(AD_DURATION_IN_FRAMES / AD_FPS).toBe(24);
    expect(AD_SCENES[0].start).toBe(0);
    for (let index = 1; index < AD_SCENES.length; index += 1) {
      expect(AD_SCENES[index].start).toBe(AD_SCENES[index - 1].end);
      expect(getAdSceneAt(AD_SCENES[index].start)).toEqual({id: AD_SCENES[index].id, localFrame: 0});
    }
    expect(getAdSceneAt(AD_DURATION_IN_FRAMES - 1).id).toBe("brand");
    expect(() => getAdSceneAt(AD_DURATION_IN_FRAMES)).toThrow(RangeError);
  });

  it("ведёт маркер по фактической линии встроенной карты", () => {
    const map = readFileSync("public/data/maps/paveletskaya.svg", "utf8");
    expect(map).toContain(`<path id="walking-path" d="${ROUTE_PATH}"`);
    expect(ROUTE_LENGTH).toBeGreaterThan(200);
    expect(pointOnRoute(0)).toEqual({x: 83.71, y: 94.04});
    expect(pointOnRoute(1)).toEqual({x: 177.63, y: 309.89});
    const middle = pointOnRoute(0.5);
    expect(middle.x).toBeGreaterThan(0);
    expect(middle.y).toBeLessThan(400);
    expect(() => pointOnRoute(1.01)).toThrow(RangeError);
  });
});
