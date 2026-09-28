import {readFileSync} from "node:fs";
import {describe, expect, it} from "vitest";
import {AD_DURATION_IN_FRAMES, AD_FPS, AD_SCENES, getAdSceneAt} from "./ad-timeline";
import {MAP_STOPS, pointOnRoute, routeProgressNear, ROUTE_LENGTH, ROUTE_PATH} from "./route-geometry";

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

  it("находит остановки встроенной карты на маршруте по порядку", () => {
    const map = readFileSync("public/data/maps/paveletskaya.svg", "utf8");
    for (const {x, y} of MAP_STOPS) expect(map).toContain(`transform="translate(${x} ${y})"`);
    const progress = MAP_STOPS.map(routeProgressNear);
    expect(progress[0]).toBe(0);
    expect(progress[3]).toBeCloseTo(1, 6);
    expect(progress[1]).toBeGreaterThan(progress[0]);
    expect(progress[2]).toBeGreaterThan(progress[1]);
    expect(progress[3]).toBeGreaterThan(progress[2]);
  });
});
