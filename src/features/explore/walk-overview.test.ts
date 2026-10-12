import { describe, expect, it, vi } from "vitest";
import { RequestError } from "../walk-builder/request";
import type { CatalogBounds } from "./catalog-bounds";
import {
  contains, createWalkOverviewStore, overviewArea, overviewUrl, validateMapWalks, WALK_OVERVIEW_COLORS, WALK_OVERVIEW_TTL_MS,
  WALK_REGION, walkColorIndex, walksAtPoint,
} from "./walk-overview";

const UUID = "00000000-0000-4000-8000-000000000001";
const raw = (id: string, line: Array<[number, number]>, kind: "catalog" | "shared" = "catalog") =>
  ({ kind, id, title: `Прогулка ${id}`, walkingMinutes: 40, distanceM: 3000, stopCount: 5, rating: { average: null, count: 0 }, line });
const view = (west: number, south: number, east: number, north: number) => ({ required: { west, south, east, north } });

describe("validateMapWalks", () => {
  it("принимает прогулку и считает рамку её линии", () => {
    const { walks: [walk], complete } = validateMapWalks({ walks: [raw("arbat", [[55.75, 37.6], [55.76, 37.58]])] });
    expect(complete).toBe(true);
    expect(walk).toMatchObject({ key: "catalog:arbat", bounds: { west: 37.58, south: 55.75, east: 37.6, north: 55.76 } });
  });
  it.each([
    ["неизвестный вид", { ...raw("arbat", [[55.75, 37.6], [55.76, 37.6]]), kind: "own" }],
    ["недопустимый слаг у каталожной", raw("Arbat walk", [[55.75, 37.6], [55.76, 37.6]])],
    ["слаг вместо токена у открытой", raw("arbat", [[55.75, 37.6], [55.76, 37.6]], "shared")],
    ["линия из одной точки", raw("arbat", [[55.75, 37.6]])],
    ["широта вне диапазона", raw("arbat", [[95, 37.6], [55.76, 37.6]])],
    ["вершина не пара", raw("arbat", [[55.75, 37.6, 1] as unknown as [number, number], [55.76, 37.6]])],
  ])("отклоняет: %s", (_name, walk) => expect(() => validateMapWalks({ walks: [walk] })).toThrow(TypeError));
  it("читает признак неполного ответа и отклоняет неверный", () => {
    expect(validateMapWalks({ walks: [], complete: false }).complete).toBe(false);
    expect(() => validateMapWalks({ walks: [], complete: "no" })).toThrow(TypeError);
  });
});

describe("overviewArea", () => {
  it("берёт вдвое больше видимой области и привязывает края к сетке 0,01°", () => {
    // required уже на полшага шире видимой области: ещё √2 дают ровно вдвое.
    const area = overviewArea(view(37.6, 55.75, 37.62, 55.76))!;
    expect(area.east - area.west).toBeGreaterThanOrEqual(0.02 * Math.SQRT2 - 1e-9);
    expect(area.north - area.south).toBeGreaterThanOrEqual(0.01 * Math.SQRT2 - 1e-9);
    expect(contains(area, { west: 37.6, south: 55.75, east: 37.62, north: 55.76 })).toBe(true);
    for (const edge of Object.values(area)) expect(Math.round(edge * 100) / 100).toBe(edge);
    expect(overviewUrl(area)).toMatch(/^\/api\/walks\/map\?west=\d+\.\d{2}&south=\d+\.\d{2}&east=\d+\.\d{2}&north=\d+\.\d{2}$/);
  });
  it("обрезает отдалённую карту по региону прогулок", () => {
    expect(overviewArea(view(34, 54, 41, 57.5))).toEqual(WALK_REGION);
  });
  it.each([
    ["Петербург", view(30.2, 59.9, 30.4, 60)],
    ["западнее региона даже вдвое шире", view(35, 55.7, 36, 55.8)],
  ])("без пересечения с регионом ничего не грузит: %s", (_name, value) => expect(overviewArea(value)).toBeNull());
});

describe("walksAtPoint", () => {
  const lines = [
    { key: "a", pixels: [{ x: 0, y: 0 }, { x: 100, y: 0 }] },
    { key: "b", pixels: [{ x: 0, y: 10 }, { x: 100, y: 10 }] },
    { key: "c", pixels: [{ x: 0, y: 200 }, { x: 100, y: 200 }] },
  ];
  it.each([
    ["две линии рядом — ближайшая первой", { x: 50, y: 7 }, ["b", "a"]],
    ["на границе допуска", { x: 50, y: 216 }, ["c"]],
    ["за допуском", { x: 50, y: 217 }, []],
    ["за концом отрезка считается до вершины", { x: 112, y: 0 }, ["a", "b"]],
  ])("%s", (_name, point, expected) => expect(walksAtPoint(point, lines)).toEqual(expected));
});

it("цвет прогулки постоянен и лежит в палитре", () => {
  const keys = ["catalog:arbat", `shared:${UUID}`, "catalog:ordynka", "catalog:x"];
  for (const key of keys) {
    expect(walkColorIndex(key)).toBe(walkColorIndex(key));
    expect(walkColorIndex(key)).toBeGreaterThanOrEqual(1);
    expect(walkColorIndex(key)).toBeLessThanOrEqual(WALK_OVERVIEW_COLORS);
  }
});

describe("createWalkOverviewStore", () => {
  function server(walks: Record<string, ReturnType<typeof raw>> = {}) {
    const state = { walks, requests: [] as string[], failure: null as Error | null, limit: Infinity };
    const fetch = vi.fn(async (path: string) => {
      state.requests.push(path);
      if (state.failure) throw state.failure;
      const query = new URL(path, "https://x.test").searchParams;
      const area: CatalogBounds = { west: Number(query.get("west")), south: Number(query.get("south")), east: Number(query.get("east")), north: Number(query.get("north")) };
      const inside = Object.values(state.walks).filter(walk => walk.line.some(([lat, lon]) => lon >= area.west && lon <= area.east && lat >= area.south && lat <= area.north));
      return new Response(JSON.stringify({ walks: inside.slice(0, state.limit), complete: inside.length <= state.limit }));
    });
    return { state, fetch };
  }
  const center = view(37.6, 55.75, 37.62, 55.76);

  it("грузит вдвое больше вида и не повторяет запрос, пока вид внутри загруженного", async () => {
    const { state, fetch } = server({ arbat: raw("arbat", [[55.755, 37.61], [55.756, 37.61]]) });
    const store = createWalkOverviewStore({ fetch });
    await store.ensure(center);
    await store.ensure(view(37.601, 55.751, 37.621, 55.761));
    expect(state.requests).toHaveLength(1);
    expect(store.snapshot()).toMatchObject({ status: "ready", walks: [{ key: "catalog:arbat" }] });
  });

  it("новый вид за пределами загруженного дозагружает и объединяет прогулки", async () => {
    const { state, fetch } = server({ arbat: raw("arbat", [[55.755, 37.61], [55.756, 37.61]]), far: raw("far", [[55.85, 37.71], [55.851, 37.71]]) });
    const store = createWalkOverviewStore({ fetch });
    await store.ensure(center);
    await store.ensure(view(37.7, 55.845, 37.72, 55.855));
    expect(state.requests).toHaveLength(2);
    expect(store.snapshot().walks.map(walk => walk.key).sort()).toEqual(["catalog:arbat", "catalog:far"]);
  });

  it("после срока свежести переспрашивает и убирает снятые с публикации прогулки", async () => {
    let time = 0;
    const { state, fetch } = server({ arbat: raw("arbat", [[55.755, 37.61], [55.756, 37.61]]) });
    const store = createWalkOverviewStore({ fetch, now: () => time });
    await store.ensure(center);
    state.walks = {};
    time = WALK_OVERVIEW_TTL_MS + 1;
    await store.ensure(center);
    expect(state.requests).toHaveLength(2);
    expect(store.snapshot().walks).toEqual([]);
  });

  it("ошибку показывает и повторяет по запросу", async () => {
    const { state, fetch } = server({ arbat: raw("arbat", [[55.755, 37.61], [55.756, 37.61]]) });
    const store = createWalkOverviewStore({ fetch });
    state.failure = new TypeError("offline");
    await store.ensure(center);
    expect(store.snapshot().status).toBe("error");
    state.failure = null;
    await store.retry();
    expect(store.snapshot()).toMatchObject({ status: "ready", walks: [{ key: "catalog:arbat" }] });
  });

  it("503 обслуживания — обычная ошибка с повтором, слой не выключается", async () => {
    const { state, fetch } = server({ arbat: raw("arbat", [[55.755, 37.61], [55.756, 37.61]]) });
    const store = createWalkOverviewStore({ fetch });
    state.failure = new RequestError("Обновление", "SERVICE_MAINTENANCE", 503);
    await store.ensure(center);
    expect(store.snapshot()).toMatchObject({ status: "error", unavailable: false });
    state.failure = null;
    await store.retry();
    expect(store.snapshot()).toMatchObject({ status: "ready", walks: [{ key: "catalog:arbat" }] });
  });

  it("обрезанный лимитом ответ не делает область загруженной и ничего не удаляет", async () => {
    const { state, fetch } = server({ arbat: raw("arbat", [[55.755, 37.61], [55.756, 37.61]]), ordynka: raw("ordynka", [[55.757, 37.611], [55.758, 37.611]]) });
    const store = createWalkOverviewStore({ fetch });
    await store.ensure(center);
    state.limit = 1;
    // Отдалённый вид шире: ответ обрезан, но прежние прогулки остаются, а повтор того же вида не отправляется.
    const wide = view(37.55, 55.72, 37.67, 55.79);
    await store.ensure(wide);
    await store.ensure(wide);
    expect(state.requests).toHaveLength(2);
    expect(store.snapshot().walks.map(walk => walk.key).sort()).toEqual(["catalog:arbat", "catalog:ordynka"]);
    // Приближение внутри обрезанной области загружает её заново.
    state.limit = Infinity;
    await store.ensure(view(37.63, 55.76, 37.65, 55.77));
    expect(state.requests).toHaveLength(3);
  });

  it("503 UNAVAILABLE выключает слой без новых запросов", async () => {
    const { state, fetch } = server();
    const store = createWalkOverviewStore({ fetch });
    state.failure = new RequestError("Нет", "UNAVAILABLE", 503);
    await store.ensure(center);
    await store.ensure(view(37.7, 55.845, 37.72, 55.855));
    expect(store.snapshot().unavailable).toBe(true);
    expect(state.requests).toHaveLength(1);
  });

  it("быстрый переход отменяет запрос покинутой области", async () => {
    const signals: AbortSignal[] = [];
    let release = () => {};
    const fetch = vi.fn((_path: string, signal: AbortSignal) => {
      signals.push(signal);
      return signals.length === 1
        ? new Promise<Response>(resolve => { release = () => resolve(new Response(JSON.stringify({ walks: [raw("old", [[55.755, 37.61], [55.756, 37.61]])] }))); })
        : Promise.resolve(new Response(JSON.stringify({ walks: [] })));
    });
    const store = createWalkOverviewStore({ fetch });
    const first = store.ensure(center);
    await store.ensure(view(37.7, 55.845, 37.72, 55.855));
    release();
    await first;
    expect(signals[0].aborted).toBe(true);
    expect(store.snapshot()).toMatchObject({ status: "ready", walks: [] });
  });

  it("возврат в загруженную область отменяет запрос покинутой и снимает загрузку и ошибку", async () => {
    const { state, fetch } = server({ arbat: raw("arbat", [[55.755, 37.61], [55.756, 37.61]]) });
    const store = createWalkOverviewStore({ fetch });
    await store.ensure(center);
    state.failure = new TypeError("offline");
    await store.ensure(view(37.7, 55.845, 37.72, 55.855));
    expect(store.snapshot().status).toBe("error");
    await store.ensure(center);
    expect(store.snapshot()).toMatchObject({ status: "ready", walks: [{ key: "catalog:arbat" }] });
    // Повтор относится к текущему виду, а не к покинутой области.
    state.failure = null;
    await store.retry();
    expect(state.requests.at(-1)).toBe(state.requests[0]);
  });
});
