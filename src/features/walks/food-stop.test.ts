import { describe, expect, it } from "vitest";
import { foodPlace } from "../food/test-fixtures";
import { FoodStopError, foodLegRequest, foodStopLeg, foodStopTitle, hasFoodStop, insertFoodStop, viewWithDocument } from "./food-stop";
import type { WalkDocument, WalkView } from "./model";
import type { Plan } from "../walk-builder/model";

// A straight walk north along one meridian: vertex i lies i × ~111 m from the start.
const LON = 37.6;
const at = (i: number) => ({ lat: 55.75 + i * 0.001, lon: LON });
const stop = (id: string, i: number, hint = "") => ({ id, place: { address: id, location: at(i) }, storyRef: null, transition: hint, nextHint: hint });

function walk(overrides: Partial<WalkDocument> = {}): WalkDocument {
  return {
    version: 2, id: "walk-1", title: "Прогулка", description: "", city: "Москва", mode: "open", minutes: 30,
    start: { address: "Старт", location: at(0) }, destination: { address: "Финиш", location: at(10) },
    stops: [stop("a", 3, "Идите к b"), stop("b", 6, "Идите к финишу")],
    route: { geometry: Array.from({ length: 11 }, (_, i) => at(i)), distanceM: 1100, walkingMinutes: 14, attribution: "© OSM", tunnels: [[1, 2], [7, 9]] },
    fieldChecked: false, ...overrides,
  };
}
// A venue 60 m east of the line beside vertex `i`.
const venue = (i: number, name = "Кофейня") => ({ ...foodPlace(`osm:node:${i}`, at(i).lat + 0.0002, LON + 0.001), name });
// The way the router returns from `from` through the venue to `to`.
function way(from: number, to: number, place = venue(4)): Plan {
  return { stops: [{ address: place.name, location: { lat: place.lat, lon: place.lon } }], geometry: [at(from), { lat: place.lat, lon: place.lon }, at(to)], distanceM: 400, walkingMinutes: 5, attribution: "© OSM", tunnels: [[0, 1]] };
}

describe("место заведения в прогулке", () => {
  it.each([
    ["до первой остановки", 1, 0, [0, 3]],
    ["между остановками", 4, 1, [3, 6]],
    ["после последней остановки, на пути к финишу", 8, 2, [6, 10]],
  ])("%s", (_, vertex, position, range) => {
    const leg = foodStopLeg(walk(), venue(vertex));
    expect(leg).toEqual({ position, range, from: at(range[0]), to: at(range[1]) });
  });

  it("путь идёт от предыдущей остановки через заведение к следующей", () => {
    const place = venue(4);
    expect(foodLegRequest(foodStopLeg(walk(), place), place)).toEqual({
      start: { address: "Точка маршрута", location: at(3) }, mode: "open", minutes: 90,
      stops: [{ address: "Кофейня", location: { lat: place.lat, lon: place.lon } }],
      destination: { address: "Точка маршрута", location: at(6) },
    });
  });

  it("участок без длины превращается в маленькую петлю", () => {
    const place = venue(10);
    const request = foodLegRequest({ position: 2, range: [10, 10], from: at(10), to: at(10) }, place);
    expect(request).toMatchObject({ mode: "loop", start: { location: at(10) } });
    expect(request).not.toHaveProperty("destination");
  });

  it("последний отрезок до остановки на финише относится к пути к ней", () => {
    expect(foodStopLeg(walk({ destination: null, stops: [stop("a", 3), stop("b", 10)] }), venue(10))).toMatchObject({ position: 1, range: [3, 10] });
  });

  it("заведению на самой линии новый путь не нужен", () => {
    const place = { ...foodPlace("osm:node:9", at(4).lat, LON), name: "Киоск" };
    expect(foodLegRequest({ position: 1, range: [4, 6], from: at(4), to: at(6) }, place)).toBeNull();
  });

  it.each([
    ["без маршрута", walk({ route: null }), "У прогулки ещё нет маршрута."],
    ["уже добавленное", walk({ stops: [stop("a", 3), { ...stop("cafe", 0), place: { address: "Кофейня", location: { lat: venue(4).lat, lon: venue(4).lon } } }] }), "Заведение уже есть в прогулке."],
    ["в полной прогулке", walk({ stops: Array.from({ length: 40 }, (_, i) => stop(`s${i}`, 3)) }), "В прогулке уже 40 остановок — больше добавить нельзя."],
  ])("отказ: %s", (_, document, message) => {
    expect(() => foodStopLeg(document, venue(4))).toThrow(new FoodStopError(message));
  });
});

describe("вставка заведения", () => {
  it("вшивает путь вместо участка и сохраняет остальной маршрут, туннели и остановки", () => {
    const document = walk(), place = venue(4), leg = foodStopLeg(document, place);
    const result = insertFoodStop(document, place, leg, way(3, 6, place), "cafe-1");
    const route = result.route!;
    // Vertices 0..3, the venue, then 6..10: the old stretch 4..5 is gone.
    expect(route.geometry).toEqual([at(0), at(1), at(2), at(3), { lat: place.lat, lon: place.lon }, at(6), at(7), at(8), at(9), at(10)]);
    // The old tunnel before the leg stays, the new way's tunnel follows it, the one after shifts by −1.
    expect(route.tunnels).toEqual([[1, 2], [3, 4], [6, 8]]);
    // 3 of 10 segments (330 of 1100 m) are replaced by the 400 m way.
    expect(route.distanceM).toBe(1170);
    expect(route.walkingMinutes).toBe(Math.ceil(14 * 0.7 + 5));
    expect(result.stops.map(item => item.id)).toEqual(["a", "cafe-1", "b"]);
    expect(result.stops[1]).toEqual({ id: "cafe-1", place: { address: "Кофейня", location: { lat: place.lat, lon: place.lon } }, storyRef: null, transition: "", nextHint: "" });
    // The hint of the stop before the venue led past it; the next stop keeps its own.
    expect(result.stops[0]).toMatchObject({ transition: "", nextHint: "" });
    expect(result.stops[2]).toMatchObject({ transition: "Идите к финишу", nextHint: "Идите к финишу" });
    expect(hasFoodStop(result, place)).toBe(true);
    expect(document.stops).toHaveLength(2);
  });

  it("туннель, который пересекает участок, обрезается по его краям", () => {
    const document = walk({ route: { ...walk().route!, tunnels: [[2, 8]] } }), place = venue(4);
    const result = insertFoodStop(document, place, foodStopLeg(document, place), { ...way(3, 6, place), tunnels: undefined }, "cafe-1");
    expect(result.route!.tunnels).toEqual([[2, 3], [5, 7]]);
  });

  it("заведение на линии добавляется без изменения маршрута", () => {
    const document = walk(), place = { ...foodPlace("osm:node:9", at(4).lat, LON), name: "Киоск" };
    const result = insertFoodStop(document, place, foodStopLeg(document, place), null, "cafe-1");
    expect(result.route).toEqual(document.route);
    expect(result.stops.map(item => item.id)).toEqual(["a", "cafe-1", "b"]);
  });

  it("длинная прогулка переходит на следующую длительность конструктора", () => {
    const document = walk({ minutes: 15 }), place = venue(4);
    const result = insertFoodStop(document, place, foodStopLeg(document, place), { ...way(3, 6, place), walkingMinutes: 20 }, "cafe-1");
    expect(result.route!.walkingMinutes).toBe(30);
    expect(result.minutes).toBe(30);
  });

  it.each([
    ["разрыв в начале пути", { geometry: [{ lat: at(3).lat, lon: LON + 0.0005 }, at(6)] }, "Не удалось соединить путь к заведению с маршрутом."],
    ["разрыв в конце пути", { geometry: [at(3), { lat: at(6).lat, lon: LON + 0.0005 }] }, "Не удалось соединить путь к заведению с маршрутом."],
    ["прогулка длиннее 90 минут", { walkingMinutes: 85 }, "С этим заведением прогулка станет длиннее 90 минут."],
    ["маршрут длиннее 8,1 км", { distanceM: 7800 }, "С этим заведением прогулка станет длиннее 90 минут."],
  ])("отказ: %s", (_, change, message) => {
    const document = walk(), place = venue(4);
    expect(() => insertFoodStop(document, place, foodStopLeg(document, place), { ...way(3, 6, place), ...change }, "cafe-1")).toThrow(new FoodStopError(message));
  });

  it.each([
    ["Кофейня «Утро»", "Кофейня «Утро»"],
    ["  Бар <b>Ночь</b>​ ", "Бар b Ночь /b"],
    ["я".repeat(200), `${"я".repeat(179)}…`],
    ["<>", "Кофейня"],
  ])("название %j становится остановкой %j", (name, title) => {
    expect(foodStopTitle({ name, kind: "coffee" })).toBe(title);
  });

  it("новая остановка получает пустую главу, остальные сохраняют истории", () => {
    const document = walk(), place = venue(4);
    const story = { title: "a", address: "a", paragraphs: [{ text: "Текст", factIds: [] }], sources: [], facts: [] };
    const view: WalkView = { document, revision: 3, contentVersion: "v", chapters: [
      { id: "a", status: "ready", story, audio: null }, { id: "b", status: "preparing", story: null, audio: null }] };
    const changed = insertFoodStop(document, place, foodStopLeg(document, place), way(3, 6, place), "cafe-1");
    const result = viewWithDocument(view, changed, 4, "local:4");
    expect(result.chapters).toEqual([view.chapters[0], { id: "cafe-1", status: "not_requested", story: null, audio: null }, view.chapters[1]]);
    expect(result).toMatchObject({ revision: 4, contentVersion: "local:4", document: changed });
  });
});
