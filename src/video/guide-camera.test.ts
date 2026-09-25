import {describe, expect, it} from "vitest";
import {MAX_ZOOM, PAGE_HEIGHT, PAGE_WIDTH, cameraFor, mixCamera, project} from "./guide-camera";

const viewport = {width: 1248, height: 780};

describe("камера видеоинструкции", () => {
  it("без области показывает снимок целиком", () => {
    expect(cameraFor()).toEqual({zoom: 1, cx: PAGE_WIDTH / 2, cy: PAGE_HEIGHT / 2});
  });

  it.each([
    ["маленькая кнопка упирается в предел увеличения", {x: 600, y: 400, width: 40, height: 40}, MAX_ZOOM],
    ["широкая область ограничена шириной", {x: 0, y: 300, width: 1024, height: 100}, 1.25],
    ["высокая область ограничена высотой", {x: 500, y: 0, width: 100, height: 640}, 1.25],
    ["область больше снимка не уменьшает его", {x: -100, y: -100, width: 2000, height: 1200}, 1],
  ])("%s", (_, focus, zoom) => {
    expect(cameraFor(focus).zoom).toBeCloseTo(zoom);
  });

  it("не выводит за край снимка область у границы", () => {
    const camera = cameraFor({x: 1200, y: 760, width: 80, height: 40});
    const topLeft = project({x: 0, y: 0}, camera, viewport);
    const bottomRight = project({x: PAGE_WIDTH, y: PAGE_HEIGHT}, camera, viewport);
    expect(topLeft.x).toBeLessThanOrEqual(0);
    expect(topLeft.y).toBeLessThanOrEqual(0);
    expect(bottomRight.x).toBeCloseTo(viewport.width);
    expect(bottomRight.y).toBeCloseTo(viewport.height);
  });

  it("ставит центр области в центр окна", () => {
    const camera = cameraFor({x: 500, y: 300, width: 300, height: 200});
    expect(project({x: 650, y: 400}, camera, viewport)).toEqual({x: viewport.width / 2, y: viewport.height / 2});
  });

  it("интерполирует масштаб логарифмически и держит концы", () => {
    const from = cameraFor();
    const to = {...cameraFor({x: 560, y: 350, width: 160, height: 100}), zoom: 1.69};
    expect(mixCamera(from, to, 0)).toEqual(from);
    expect(mixCamera(from, to, 1).zoom).toBeCloseTo(1.69);
    expect(mixCamera(from, to, 0.5).zoom).toBeCloseTo(1.3);
    expect(mixCamera(from, to, 2).zoom).toBeCloseTo(1.69);
  });

  it("отклоняет пустую область", () => {
    expect(() => cameraFor({x: 0, y: 0, width: 0, height: 10})).toThrow(RangeError);
  });
});
