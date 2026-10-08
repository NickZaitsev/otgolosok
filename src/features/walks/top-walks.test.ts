// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { filterTopWalks, formatTopWalkMeta, storyCountLabel, validateTopWalks } from "./top-model";
import { TopWalks } from "./top-walks";

const TOKEN = "22222222-2222-4222-8222-222222222222";
const catalog = { kind: "catalog", id: "msk-walk", title: "Кожевники", walkingMinutes: 45, distanceM: 3200, stopCount: 6, rating: { average: 4.6, count: 12 },
  preview: [[8, 92], [50, 40], [92, 8]], startMetro: { name: "Павелецкая", distanceM: 120 }, endMetro: { name: "Тульская", distanceM: 210 } };
const shared = { kind: "shared", id: TOKEN, title: "Арбат", walkingMinutes: 30, distanceM: 1250, stopCount: 1, rating: { average: null, count: 0 },
  preview: [[8, 50], [92, 50]], startMetro: { name: "Арбатская", distanceM: 90 }, endMetro: { name: "Смоленская", distanceM: 180 } };

describe("модель топа", () => {
  it("принимает схему маршрута и ближайшие станции", () => {
    expect(validateTopWalks({ walks: [catalog, shared] })).toEqual([catalog, shared]);
    expect(validateTopWalks({ walks: [{ ...catalog, preview: undefined, startMetro: undefined, endMetro: undefined }] })[0])
      .toMatchObject({ preview: null, startMetro: null, endMetro: null });
  });

  it.each([
    ["не объект", null],
    ["нет списка", { walks: {} }],
    ["неизвестный вид", { walks: [{ ...catalog, kind: "account" }] }],
    ["некорректный слаг", { walks: [{ ...catalog, id: "Bad Slug" }] }],
    ["слаг вместо токена", { walks: [{ ...shared, id: "msk-walk" }] }],
    ["пустое название", { walks: [{ ...catalog, title: " " }] }],
    ["нулевая длина", { walks: [{ ...catalog, distanceM: 0 }] }],
    ["дробное число историй", { walks: [{ ...catalog, stopCount: 1.5 }] }],
    ["средняя без оценок", { walks: [{ ...shared, rating: { average: 4, count: 0 } }] }],
    ["оценка вне шкалы", { walks: [{ ...catalog, rating: { average: 6, count: 1 } }] }],
    ["координата схемы вне карточки", { walks: [{ ...catalog, preview: [[8, 92], [101, 8]] }] }],
    ["больше 80 точек схемы", { walks: [{ ...catalog, preview: Array.from({ length: 81 }, () => [8, 92]) }] }],
    ["пустое название метро", { walks: [{ ...catalog, startMetro: { name: " ", distanceM: 5 } }] }],
    ["метро слишком далеко", { walks: [{ ...catalog, endMetro: { name: "Тульская", distanceM: 1501 } }] }],
  ])("отклоняет: %s", (_name, value) => {
    expect(() => validateTopWalks(value)).toThrow(TypeError);
  });

  it("фильтрует старт и финиш вместе, сохраняя рейтинг списка", () => {
    const walks = validateTopWalks({ walks: [catalog, shared] });
    expect(filterTopWalks(walks, "Павелецкая", "").map(walk => walk.id)).toEqual([catalog.id]);
    expect(filterTopWalks(walks, "", "Смоленская").map(walk => walk.id)).toEqual([shared.id]);
    expect(filterTopWalks(walks, "Павелецкая", "Смоленская")).toEqual([]);
  });

  it.each([[1, "1 история"], [2, "2 истории"], [5, "5 историй"], [11, "11 историй"], [21, "21 история"], [22, "22 истории"]])("%i → %s", (count, label) => {
    expect(storyCountLabel(count)).toBe(label);
  });

  it("собирает строку времени, длины и историй", () => {
    expect(formatTopWalkMeta(catalog)).toBe("45 мин · 3,2 км · 6 историй");
  });

  it.each([
    ["en", "45 min · 3.2 km · 6 stories"],
    ["zh", "45 分钟 · 3.2 公里 · 6 个故事"],
  ] as const)("форматирует описание прогулки для %s", (locale, label) => {
    expect(formatTopWalkMeta(catalog, locale)).toBe(label);
  });
});

describe("список топа", () => {
  let root: Root;
  let container: HTMLDivElement;
  const fetcher = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("fetch", fetcher);
    fetcher.mockReset();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => { root.unmount(); });
    container.remove();
    vi.unstubAllGlobals();
  });
  const render = async (filterable = false) => { await act(async () => { root.render(createElement(TopWalks, { filterable })); }); await act(async () => {}); };
  const ok = (value: unknown) => new Response(JSON.stringify(value), { status: 200 });

  it("показывает весь маршрут справа, метро и ссылку на подробную прогулку", async () => {
    fetcher.mockResolvedValue(ok({ walks: [catalog, shared] }));
    await render();
    expect(fetcher).toHaveBeenCalledWith("/api/top-walks", expect.objectContaining({ credentials: "same-origin" }));
    const items = [...container.querySelectorAll("ol > li")];
    expect(items.map(item => item.querySelector("span[class*=rank]")?.textContent)).toEqual(["1", "2"]);
    expect(items.map(item => item.querySelector("a")?.getAttribute("href"))).toEqual(["/walk?catalog=msk-walk", `/walk?share=${TOKEN}`]);
    expect(items[0].querySelector("a")?.getAttribute("aria-label")).toBe("Подробнее о маршруте «Кожевники»");
    expect(items[0].querySelector("polyline")?.getAttribute("points")).toBe("8,92 50,40 92,8");
    expect(items[0].textContent).toContain("Старт: м. Павелецкая");
    expect(items[0].textContent).toContain("Финиш: м. Тульская");
    expect(items[0].textContent).toContain("★ 4,6 · 12 оценок");
    expect(items[1].textContent).toContain("Пока без оценок");
    expect(items[1].textContent).toContain("30 мин · 1,3 км · 1 история");
  });

  it("фильтрует по метро старта и финиша, сохраняя исходное место в топе", async () => {
    fetcher.mockResolvedValue(ok({ walks: [catalog, shared] }));
    await render(true);
    const selects = [...container.querySelectorAll<HTMLSelectElement>("select")];
    expect(selects).toHaveLength(2);
    await act(async () => { selects[0].value = "Арбатская"; selects[0].dispatchEvent(new Event("change", { bubbles: true })); });
    expect(container.querySelectorAll("ol > li")).toHaveLength(1);
    expect(container.querySelector("ol > li span[class*=rank]")?.textContent).toBe("2");
    expect(container.querySelector("[role=status]")?.textContent).toBe("Найдено: 1");
    await act(async () => { selects[1].value = "Тульская"; selects[1].dispatchEvent(new Event("change", { bubbles: true })); });
    expect(container.textContent).toContain("По выбранным станциям прогулок нет.");
    await act(async () => { [...container.querySelectorAll("button")].find(button => button.textContent === "Сбросить фильтры")!.click(); });
    expect(container.querySelectorAll("ol > li")).toHaveLength(2);
  });

  it("пустой топ зовёт открыть свою прогулку", async () => {
    fetcher.mockResolvedValue(ok({ walks: [] }));
    await render();
    expect(container.textContent).toBe("В топе пока пусто. Откройте свою прогулку всем — после проверки она появится здесь.");
  });

  it("повреждённый ответ — ошибка с повтором, который загружает топ заново", async () => {
    fetcher.mockResolvedValueOnce(ok({ walks: [{ kind: "catalog" }] })).mockResolvedValueOnce(ok({ walks: [catalog] }));
    await render();
    const alert = container.querySelector("[role=alert]");
    expect(alert?.textContent).toContain("Сервис вернул повреждённую прогулку.");
    expect(fetcher).toHaveBeenCalledTimes(1);
    await act(async () => { alert!.querySelector("button")!.click(); });
    await act(async () => {});
    expect(container.querySelectorAll("ol > li")).toHaveLength(1);
  });
});
