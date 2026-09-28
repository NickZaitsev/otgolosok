import {readFileSync} from "node:fs";
import {describe, expect, it} from "vitest";
import {sceneData, voiceLevels} from "../../scripts/render-kinetic-video.mjs";
import {
  BEAT, DURATION, FPS, FRAME_COUNT, SCENES, VOICE,
  bezier, frameTime, musicScore, parsePolyline, polyline, progress, scene, stripesPolygon,
} from "../../video/kinetic/timeline.mjs";

describe("хронометраж кинетического ролика", () => {
  it("сцены идут встык от нуля, склейки стоят на ударах", () => {
    expect(SCENES[0].start).toBe(0);
    SCENES.forEach((item, index) => {
      expect(item.end).toBeGreaterThan(item.start);
      if (index > 0) expect(item.start).toBe(SCENES[index - 1].end);
      expect((item.start / BEAT) % 1).toBe(0);
    });
    expect(FRAME_COUNT).toBe(DURATION * FPS);
  });

  it("фрагмент голоса целиком лежит в сцене прослушивания", () => {
    const listen = scene("listen");
    expect(VOICE.at).toBeGreaterThanOrEqual(listen.start);
    expect(VOICE.at + VOICE.length).toBeLessThanOrEqual(listen.end);
  });

  it("музыка получает склейки и приглушение из сцен", () => {
    expect(musicScore()).toEqual({
      seconds: DURATION,
      cuts: SCENES.slice(1).map(({start}) => start),
      duck: [scene("listen").start, scene("listen").end],
      groove: scene("facade").start,
      finale: scene("brand").start,
    });
  });

  it.each([-1, 0.5, FRAME_COUNT])("отвергает кадр %s", (frame) => {
    expect(() => frameTime(frame)).toThrow(RangeError);
  });

  it("последний кадр раньше конца ролика", () => {
    expect(frameTime(FRAME_COUNT - 1)).toBeLessThan(DURATION);
  });

  it("неизвестная сцена — ошибка", () => {
    expect(() => scene("nope")).toThrow(RangeError);
  });
});

describe("анимационная математика", () => {
  it("кривая Безье проходит через концы и монотонна", () => {
    const curve = bezier(0.16, 1, 0.3, 1);
    expect(curve(0)).toBe(0);
    expect(curve(1)).toBe(1);
    const samples = Array.from({length: 21}, (_, index) => curve(index / 20));
    samples.slice(1).forEach((value, index) => expect(value).toBeGreaterThanOrEqual(samples[index] - 1e-9));
  });

  it("прогресс зажат вне отрезка и требует длины", () => {
    expect(progress(-5, 0, 1)).toBe(0);
    expect(progress(5, 0, 1)).toBe(1);
    expect(() => progress(0, 1, 1)).toThrow(RangeError);
  });

  it("полосы: закрытая полоса нулевой ширины, открытая — во всю ширину", () => {
    expect(stripesPolygon([0, 1])).toBe("polygon(0% 0%, 0% 0%, 0% 50%, 0% 50%, 0% 50%, 100% 50%, 100% 100%, 0% 100%)");
    expect(() => stripesPolygon([])).toThrow(RangeError);
  });

  it("ломаная: точка по доле пути и обратное вычисление доли", () => {
    const line = polyline(parsePolyline("M0,0L10,0L10,10"));
    expect(line.length).toBe(20);
    expect(line.at(0.25)).toEqual({x: 5, y: 0});
    expect(line.at(0.75)).toEqual({x: 10, y: 5});
    expect(line.shareNear({x: 12, y: 5})).toBeCloseTo(0.75);
    expect(() => parsePolyline("M1,1")).toThrow(RangeError);
    expect(() => polyline([{x: 1, y: 1}, {x: 1, y: 1}])).toThrow(RangeError);
  });
});

describe("данные сцены", () => {
  const route = JSON.parse(readFileSync("public/data/routes/paveletskaya.json", "utf8"));
  const map = readFileSync("public/data/maps/paveletskaya.svg", "utf8");

  it("берёт путь, метки и подписи из карты и маршрута", () => {
    const data = sceneData(route, map);
    expect(data.distanceM).toBe(Math.round(route.distance_km * 1000));
    expect(data.stops).toHaveLength(route.notes.length + route.pois.length);
    expect(data.stops[0].label).toBe(route.notes[0].story.opening);
    expect(data.stops.at(-1)?.label).toBe(route.pois.at(-1).story.opening);
    const line = polyline(parsePolyline(data.path));
    // Первая и последняя метки стоят на концах пути: рисование доходит до них.
    expect(line.shareNear(data.stops[0])).toBeCloseTo(0);
    expect(line.shareNear(data.stops.at(-1)!)).toBeCloseTo(1);
  });

  it("падает, если меток на карте не столько, сколько историй", () => {
    expect(() => sceneData({...route, pois: []}, map)).toThrow(/Меток на карте/);
    expect(() => sceneData(route, "<svg/>")).toThrow(/walking-path/);
  });
});

describe("уровни озвучки", () => {
  function pcm(samples: number[]) {
    const buffer = Buffer.alloc(samples.length * 2);
    samples.forEach((sample, index) => buffer.writeInt16LE(sample, index * 2));
    return buffer;
  }

  it("нормирует громкость кадров к самому громкому", () => {
    const levels = voiceLevels(pcm([0, 0, 1000, -1000, 4000, -4000]), 60, {fps: 30, seconds: 0.1});
    expect(levels).toEqual([0, 0.5, 1]);
  });

  it("беззвучный фрагмент — ошибка", () => {
    expect(() => voiceLevels(pcm([0, 0, 0, 0]), 40, {fps: 20, seconds: 0.1})).toThrow(/беззвучен/);
  });
});
