import {describe, expect, it} from "vitest";
import {dropLoops, publishedStop, shortestWalk, walkGraph} from "../../scripts/build-centre-walk-video.mjs";
import {centreMotionScore} from "../../scripts/motion-centre-score.mjs";
import {CENTRE_STOP_PROGRESS, CENTRE_STOPS, CENTRE_WALK, centrePointAt} from "./centre-geometry";
import {CENTRE_DURATION_IN_FRAMES, CENTRE_FIRE_START, CENTRE_FPS, CENTRE_ITEM_FRAMES, CENTRE_LOCKUP_FRAME, CENTRE_SCENES, centreScene} from "./motion-centre-timeline";
import {plural} from "./russian-plural";

describe("ролик «Прогулка по центру»", () => {
  it("идёт 40–45 секунд, а на каждое место в хуке — больше секунды", () => {
    expect(CENTRE_DURATION_IN_FRAMES / CENTRE_FPS).toBeGreaterThan(40);
    expect(CENTRE_DURATION_IN_FRAMES / CENTRE_FPS).toBeLessThanOrEqual(45);
    expect(CENTRE_ITEM_FRAMES / CENTRE_FPS).toBeGreaterThan(1);
    // Перечисление заканчивается раньше, чем хук уходит в переход.
    expect(CENTRE_FIRE_START + CENTRE_STOPS.length * CENTRE_ITEM_FRAMES).toBeLessThan(centreScene("hook").end - 40);
  });

  it("ставит удары на склейки, щелчки на названия мест и эхо на логотип", () => {
    const score = centreMotionScore();
    expect(score.seconds * CENTRE_FPS).toBe(CENTRE_DURATION_IN_FRAMES);
    expect(score.cuts.map((cut) => Math.round(cut * CENTRE_FPS))).toEqual(CENTRE_SCENES.slice(1).map(({start}) => start));
    expect(score.duck.map((time) => Math.round(time * CENTRE_FPS))).toEqual([centreScene("facts").start, centreScene("facts").end]);
    expect(Math.round(score.finale * CENTRE_FPS)).toBe(centreScene("outro").start + CENTRE_LOCKUP_FRAME);
    expect(score.taps.map((tap) => Math.round(tap * CENTRE_FPS))).toEqual(CENTRE_STOPS.map((_, index) => CENTRE_FIRE_START + index * CENTRE_ITEM_FRAMES));
  });
});

describe("данные прогулки по центру", () => {
  it("ведёт путь через остановки по порядку", () => {
    expect(CENTRE_STOP_PROGRESS[0]).toBe(0);
    expect(CENTRE_STOP_PROGRESS.at(-1)).toBeCloseTo(1, 5);
    CENTRE_STOP_PROGRESS.slice(1).forEach((share, index) => expect(share).toBeGreaterThan(CENTRE_STOP_PROGRESS[index]));
    const last = CENTRE_STOPS.at(-1)!;
    expect(centrePointAt(1)).toEqual({x: last.x, y: last.y});
    expect(() => centrePointAt(1.1)).toThrow(RangeError);
  });

  it("у каждой остановки есть опубликованный текст и источники", () => {
    for (const stop of CENTRE_STOPS) {
      expect(stop.paragraph.length).toBeGreaterThan(40);
      expect(stop.sources.length).toBeGreaterThan(0);
    }
    expect(CENTRE_WALK.distanceM).toBeGreaterThan(2000);
  });

  it("склоняет подписи счётчиков", () => {
    const forms = ["история", "истории", "историй"] as const;
    expect([1, 3, 8, 11, 21, 22, 112].map((count) => plural(count, forms))).toEqual(["история", "истории", "историй", "историй", "история", "истории", "историй"]);
  });
});

describe("сборка пути по графу OSM", () => {
  const point = (lat: number, lon: number) => ({lat, lon});
  const way = (id: number, nodes: number[], geometry: {lat: number; lon: number}[], tags: Record<string, string> = {highway: "footway", name: "Тест"}) => ({type: "way", id, nodes, geometry, tags});

  it("идёт кратчайшим путём и не ходит по закрытым дорогам", () => {
    const a = point(55.75, 37.6);
    const b = point(55.75, 37.601);
    const c = point(55.751, 37.6005);
    const graph = walkGraph([
      way(1, [1, 2], [a, b], {highway: "service", access: "private"}),
      way(2, [1, 3, 2], [a, c, b]),
    ]);
    const walk = shortestWalk(graph, 1, 2);
    expect(walk.points).toEqual([a, c, b]);
    expect(walk.meters).toBeGreaterThan(100);
  });

  it("вырезает петли и заходы туда и обратно", () => {
    const [a, b, c, d] = [point(1, 1), point(1, 2), point(1, 3), point(1, 4)];
    expect(dropLoops([a, b, c, b, d])).toEqual([a, b, d]);
    expect(dropLoops([a, b, b, c])).toEqual([a, b, c]);
  });

  it("берёт только опубликованные истории с источниками", () => {
    const place = {id: "osm:way:1", name: "Дом", address: "Москва, улица, 1", location: point(55.7, 37.6), archived: false, textStatus: "approved", story: {title: "Дом", paragraphs: [{text: "Текст истории."}], sources: [{title: "Источник", publisher: "example.org", url: "https://example.org"}]}, audio: {url: "/api/story-audio/x.mp3", durationSec: 10}};
    expect(publishedStop([place], {id: "osm:way:1", label: "Дом"}).audio?.url).toBe("https://otgolosok.online/api/story-audio/x.mp3");
    expect(() => publishedStop([{...place, textStatus: "draft"}], {id: "osm:way:1", label: "Дом"})).toThrow("не опубликована");
    expect(() => publishedStop([{...place, story: {...place.story, sources: []}}], {id: "osm:way:1", label: "Дом"})).toThrow("источников");
  });
});
