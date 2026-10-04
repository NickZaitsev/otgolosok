import { describe, expect, it, vi } from "vitest";
import { createFoodHoursCache, foodPhone, foodWebsite, groupRouteFood, splitRouteFood, type RouteFoodPlace } from "./food-walk-model";
import { parseOpeningHours } from "./opening-hours";
import { distanceToRoute, matchedRoutePoint, routeVertexDistances } from "./route-proximity";

const place = (id: string, alongM: number): RouteFoodPlace => ({ id, alongM, distanceM: 30, vertex: 0, kind: "coffee", name: id, lat: 55.75, lon: 37.6, openingHours: null, address: null, cuisine: null, website: null, phone: null });
const ids = (places: RouteFoodPlace[]) => places.map(p => p.id);

describe("заведения по ходу прогулки", () => {
  it.each([
    [0, ["a", "b", "c"], []], [100, ["b", "c"], ["a"]], [200, ["c"], ["a", "b"]], [201, [], ["a", "b", "c"]],
  ])("граница участка %s включает его начало", (from, ahead, behind) => {
    const input = [place("c", 200), place("a", 0), place("b", 100)];
    const result = splitRouteFood(input, from as number);
    expect(ids(result.ahead)).toEqual(ahead);
    expect(ids(result.behind)).toEqual(behind);
    expect(ids(input)).toEqual(["c", "a", "b"]);
  });
  it.each([
    [[], [null, null, null]], [[0, 200], [0, 0, 1]], [[200, 0], [1, 0, 0]], [[100], [0, 0, 0]],
  ])("группирует по ближайшей остановке %j, при равенстве выбирает первую", (stops, expected) => {
    const result = groupRouteFood([place("c", 200), place("b", 100), place("a", 0)], (stops as number[]).map(alongM => ({ alongM })));
    expect(result.flatMap(g => g.places.map(() => g.stop))).toEqual(expected);
    expect(result.flatMap(g => ids(g.places))).toEqual(["a", "b", "c"]);
  });
  it("пустые данные не создают пустые группы", () => {
    expect(groupRouteFood([], [{ alongM: 0 }])).toEqual([]);
    expect(splitRouteFood([], 0)).toEqual({ ahead: [], behind: [] });
  });
  it("длина вершины на петле не превращается в самое раннее прохождение", () => {
    const a = { lat: 55.75, lon: 37.6 }, b = { lat: 55.751, lon: 37.6 }, geometry = [a, b, a];
    const distances = routeVertexDistances(geometry);
    expect(distances[2]).toBeCloseTo(222.64);
    expect(distanceToRoute(a, geometry, { mode: "loop" }).alongM).toBe(0);
    expect(splitRouteFood([place("first", 0), place("return", 200)], distances[1]).ahead.map(p => p.id)).toEqual(["return"]);
  });
  it("камера получает проекцию на отрезок, а не ближайшую вершину", () => {
    const geometry = [{ lat: 55.75, lon: 37.6 }, { lat: 55.752, lon: 37.6 }];
    const match = distanceToRoute({ lat: 55.751, lon: 37.601 }, geometry);
    expect(matchedRoutePoint(match, geometry)).toEqual({ lat: 55.751, lon: 37.6 });
    expect(matchedRoutePoint(match, [])).toBeNull();
    expect(matchedRoutePoint({ ...match, vertex: 0 }, geometry.slice(0, 1))).toEqual(geometry[0]);
  });
});

describe("мемоизация часов", () => {
  it("разбирает одинаковую строку один раз и меняет статус на границе минуты", () => {
    const parse = vi.fn(parseOpeningHours), hours = createFoodHoursCache(parse);
    const before = new Date("2026-10-04T18:59:00Z"), after = new Date("2026-10-04T19:00:00Z");
    expect(hours("Mo-Su 09:00-22:00", before)).toMatchObject({ state: "open", until: "22:00" });
    expect(hours("Mo-Su 09:00-22:00", before)).toMatchObject({ state: "open" });
    expect(hours("Mo-Su 09:00-22:00", after)).toMatchObject({ state: "closed", opensAt: { time: "09:00", daysAhead: 1 } });
    expect(parse).toHaveBeenCalledTimes(1);
  });
  it.each([null, "sunrise-sunset", ""])("кеширует и неизвестное правило %s", value => {
    const parse = vi.fn(parseOpeningHours), hours = createFoodHoursCache(parse), now = new Date("2026-10-04T12:00:00Z");
    expect(hours(value, now).state).toBe("unknown");
    expect(hours(value, now).state).toBe("unknown");
    expect(parse).toHaveBeenCalledTimes(1);
  });
  it("не смешивает разные строки и сохраняет праздничную оговорку", () => {
    const hours = createFoodHoursCache(), now = new Date("2026-10-04T12:00:00Z");
    expect(hours("24/7; PH off", now)).toMatchObject({ state: "open", holidayCaveat: true });
    expect(hours("Mo-Su off", now)).toMatchObject({ state: "closed", holidayCaveat: false });
  });
});

it.each([[null, null], ["+7 (999) 123-45-67", "tel:+79991234567"], ["123.45", "tel:12345"], ["123 ext 45", null], ["++123", null], ["12+34", null], ["javascript:123", null], ["", null], ["+7 495 111-22-33; +7 495 444-55-66", "tel:+74951112233"], ["+7 495 111-22-33, доб. 5", "tel:+74951112233"]])("безопасный телефон %s", (input, expected) => expect(foodPhone(input)).toBe(expected));
it.each([[null, null], ["https://example.com", "https://example.com/"], ["http://example.com/menu", "http://example.com/menu"], ["javascript:alert(1)", null], ["//example.com", null], ["tel:+123", null], ["https://", null]])("безопасный сайт %s", (input, expected) => expect(foodWebsite(input)).toBe(expected));
