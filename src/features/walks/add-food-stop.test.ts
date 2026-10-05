import { describe, expect, it, vi } from "vitest";
import { foodPlace } from "../food/test-fixtures";
import { addFoodStop, type FoodStopSource } from "./add-food-stop";
import { getLocalWalk, saveLocalWalk } from "./local-store";
import { WalkLoadError } from "./walk-loader";
import type { WalkDocument, WalkView } from "./model";

const at = (i: number) => ({ lat: 55.75 + i * 0.001, lon: 37.6 });
const ID = "33333333-3333-4333-8333-333333333333";
const COPY = "44444444-4444-4444-8444-444444444444";
const place = { ...foodPlace("osm:node:7", at(4).lat + 0.0002, 37.601), name: "Кофейня" };

function document(id = ID): WalkDocument {
  return {
    version: 2, id, title: "Прогулка", description: "", city: "Москва", mode: "open", minutes: 30,
    start: { address: "Старт", location: at(0) }, destination: { address: "Финиш", location: at(10) },
    stops: [{ id: "a", place: { address: "a", location: at(3) }, storyRef: null, transition: "", nextHint: "" },
      { id: "b", place: { address: "b", location: at(6) }, storyRef: null, transition: "", nextHint: "" }],
    route: { geometry: Array.from({ length: 11 }, (_, i) => at(i)), distanceM: 1100, walkingMinutes: 14, attribution: "© OSM" },
    fieldChecked: false,
  };
}
const view = (revision = 0, id = ID): WalkView => ({ document: document(id), revision, contentVersion: "v",
  chapters: [{ id: "a", status: "not_requested", story: null, audio: null }, { id: "b", status: "not_requested", story: null, audio: null }] });
const plan = { stops: [{ address: "Кофейня", location: { lat: place.lat, lon: place.lon } }], geometry: [at(3), { lat: place.lat, lon: place.lon }, at(6)], distanceM: 400, walkingMinutes: 5, attribution: "© OSM" };

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, values };
}
function deps(storage = memoryStorage()) {
  return {
    plan: vi.fn<(request: unknown, signal: AbortSignal) => Promise<unknown>>(async () => plan),
    account: vi.fn<(path: string, init: RequestInit) => Promise<unknown>>(async () => ({ walk: { id: ID, revision: 8 } })),
    session: vi.fn(async (): Promise<{ id: string } | null> => null), storage, newId: vi.fn(() => COPY),
  };
}
const run = (source: FoodStopSource, d: ReturnType<typeof deps>, current = view()) => addFoodStop(current, source, place, new AbortController().signal, d);
const stopIds = (value: WalkDocument) => value.stops.map(item => item.id);

describe("добавление заведения в прогулку", () => {
  it("своя прогулка на устройстве меняется на месте с новой ревизией", async () => {
    const d = deps();
    saveLocalWalk(d.storage, document(), null);
    const result = await run({ kind: "local", id: ID }, d);
    expect(result.moved).toBeNull();
    expect(result.view.revision).toBe(1);
    expect(stopIds(result.view.document)).toEqual(["a", COPY, "b"]);
    expect(getLocalWalk(d.storage, ID)?.document).toEqual(result.view.document);
    expect(d.plan).toHaveBeenCalledWith(expect.objectContaining({ start: { address: "Точка маршрута", location: at(3) } }), expect.anything());
  });

  it("прогулка из кабинета сохраняется с прежней ревизией для защиты от гонок", async () => {
    const d = deps();
    const result = await run({ kind: "id", id: ID }, d, view(7));
    expect(d.account).toHaveBeenCalledOnce();
    const [path, init] = d.account.mock.calls[0];
    expect(path).toBe(`/api/me/walks/${ID}`);
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string)).toMatchObject({ revision: 7, title: "Прогулка", snapshot: { id: ID, stops: [{ id: "a" }, { id: COPY }, { id: "b" }] } });
    expect(result).toMatchObject({ moved: null, view: { revision: 8 } });
  });

  it("чужая прогулка без входа копируется на устройство вместе с направлением и местом в истории", async () => {
    const checkpoint = { version: 1, routeId: "catalog-walk", chapterId: "a", audioUrl: "/audio/walk/a.mp3", positionSec: 12 };
    const d = deps(memoryStorage({ "otgolosok:walk-direction:catalog-walk": "reverse", "otgolosok:playback:catalog-walk:reverse": JSON.stringify(checkpoint) }));
    const result = await run({ kind: "catalog", id: "catalog-walk" }, d, view(0, "catalog-walk"));
    expect(result.moved).toEqual({ kind: "local", id: COPY });
    expect(result.view.document.id).toBe(COPY);
    expect(getLocalWalk(d.storage, COPY)?.document.stops).toHaveLength(3);
    expect(d.storage.values.get(`otgolosok:walk-direction:${COPY}`)).toBe("reverse");
    expect(JSON.parse(d.storage.values.get(`otgolosok:playback:${COPY}:reverse`)!)).toEqual({ ...checkpoint, routeId: COPY });
    expect(d.account).not.toHaveBeenCalled();
  });

  it("чужая прогулка при входе копируется в кабинет под ID, который выдал сервер", async () => {
    const d = deps();
    d.session.mockResolvedValue({ id: "user" });
    d.account.mockResolvedValue({ walk: { id: "55555555-5555-4555-8555-555555555555", revision: 0 } });
    const result = await run({ kind: "share", id: "token" }, d, view(0, "shared-walk"));
    const [path, init] = d.account.mock.calls[0];
    expect(path).toBe("/api/me/walks");
    expect(JSON.parse(init.body as string)).toMatchObject({ idempotencyKey: `walk-${COPY}`, snapshot: { id: COPY } });
    expect(result.moved).toEqual({ kind: "id", id: "55555555-5555-4555-8555-555555555555" });
    expect(result.view.document.id).toBe("55555555-5555-4555-8555-555555555555");
  });

  it.each([400, 404])("отказ маршрутизатора %s говорит о пути к заведению", async status => {
    const d = deps();
    d.plan.mockRejectedValue(new WalkLoadError("Отсюда не получилось проложить пешеходную прогулку.", status));
    await expect(run({ kind: "local", id: ID }, d)).rejects.toThrow("Не получилось проложить пешеходный путь к этому заведению.");
  });

  it("недоступный маршрутизатор передаёт своё сообщение и ничего не сохраняет", async () => {
    const d = deps();
    d.plan.mockRejectedValue(new WalkLoadError("Пешеходный маршрутизатор временно недоступен.", 503, true));
    saveLocalWalk(d.storage, document(), null);
    await expect(run({ kind: "local", id: ID }, d)).rejects.toThrow("Пешеходный маршрутизатор временно недоступен.");
    expect(getLocalWalk(d.storage, ID)?.revision).toBe(0);
  });

  it("повреждённый ответ маршрутизатора отклоняется", async () => {
    const d = deps();
    d.plan.mockResolvedValue({ ...plan, stops: [] });
    await expect(run({ kind: "local", id: ID }, d)).rejects.toThrow("Сервис вернул некорректный маршрут. Попробуйте ещё раз.");
  });

  it("ошибка кабинета не подменяется успехом", async () => {
    const d = deps();
    d.account.mockRejectedValue(new Error("Прогулка изменена в другой вкладке."));
    await expect(run({ kind: "id", id: ID }, d)).rejects.toThrow("Прогулка изменена в другой вкладке.");
  });
});
