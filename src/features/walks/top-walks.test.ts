// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import metroData from "../../../backend/metro-stations.json";
import { filterTopWalks, formatTopWalkMeta, metroTextColor, searchMetroOptions, storyCountLabel, topWalksUrl, validateTopWalkPage, validateTopWalks } from "./top-model";
import { TopWalks } from "./top-walks";

const TOKEN = "22222222-2222-4222-8222-222222222222";
const lines = [{ id: "2", name: "Замоскворецкая", color: "#4fb04f" }];
const mapPreview = { zoom: 16, tiles: [{ x: 39612, y: 20487, left: -100, top: -100 }], points: [[80, 180], [128, 128], [180, 80]] };
const catalog = { kind: "catalog", id: "msk-walk", title: "Кожевники", walkingMinutes: 45, distanceM: 3200, stopCount: 6, rating: { average: 4.6, count: 12 }, rank: 1,
  preview: [[8, 92], [50, 40], [92, 8]], mapPreview, startMetro: { name: "Павелецкая", distanceM: 120, lines }, endMetro: { name: "Тульская", distanceM: 210, lines } };
const shared = { kind: "shared", id: TOKEN, title: "Арбат", walkingMinutes: 30, distanceM: 1250, stopCount: 1, rating: { average: null, count: 0 }, rank: 2,
  preview: [[8, 50], [92, 50]], mapPreview: null, startMetro: { name: "Арбатская", distanceM: 90, lines: [{ id: "3", name: "Арбатско-Покровская", color: "#0072ba" }] },
  endMetro: { name: "Смоленская", distanceM: 180, lines: [] } };
const page = (walks: unknown[], nextOffset: number | null = null, total = walks.length) => ({ walks, nextOffset, total,
  filters: { starts: ["Арбатская", "Павелецкая"], ends: ["Смоленская", "Тульская"], stations: [
    { name: "Арбатская", lines: [{ id: "3", name: "Арбатско-Покровская", color: "#0072ba" }], insideCircle: true }, { name: "Павелецкая", lines, insideCircle: true },
    { name: "Смоленская", lines: [], insideCircle: true }, { name: "Тульская", lines: [{ id: "9", name: "Серпуховско-Тимирязевская", color: "#adacac" }], insideCircle: false },
  ] } });

describe("модель топа", () => {
  it("принимает карту, линии метро и метаданные страницы", () => {
    expect(validateTopWalkPage(page([catalog, shared]))).toEqual(page([catalog, shared]));
    expect(validateTopWalks({ walks: [{ ...catalog, preview: undefined, mapPreview: undefined, startMetro: undefined, endMetro: undefined }] })[0])
      .toMatchObject({ preview: null, mapPreview: null, startMetro: null, endMetro: null });
  });

  it.each([
    ["не объект", null], ["нет списка", { walks: {} }],
    ["неизвестный вид", page([{ ...catalog, kind: "account" }])],
    ["некорректный слаг", page([{ ...catalog, id: "Bad Slug" }])],
    ["слаг вместо токена", page([{ ...shared, id: "msk-walk" }])],
    ["пустое название", page([{ ...catalog, title: " " }])],
    ["нулевая длина", page([{ ...catalog, distanceM: 0 }])],
    ["дробное число историй", page([{ ...catalog, stopCount: 1.5 }])],
    ["средняя без оценок", page([{ ...shared, rating: { average: 4, count: 0 } }])],
    ["оценка вне шкалы", page([{ ...catalog, rating: { average: 6, count: 1 } }])],
    ["координата схемы вне карточки", page([{ ...catalog, preview: [[8, 92], [101, 8]] }])],
    ["больше 80 точек схемы", page([{ ...catalog, preview: Array.from({ length: 81 }, () => [8, 92]) }])],
    ["пустое название метро", page([{ ...catalog, startMetro: { name: " ", distanceM: 5, lines } }])],
    ["метро слишком далеко", page([{ ...catalog, endMetro: { name: "Тульская", distanceM: 1501, lines } }])],
    ["небезопасный цвет линии", page([{ ...catalog, startMetro: { name: "Павелецкая", distanceM: 5, lines: [{ ...lines[0], color: "red;" }] } }])],
    ["тайл вне карты", page([{ ...catalog, mapPreview: { ...mapPreview, tiles: [{ ...mapPreview.tiles[0], x: -1 }] } }])],
    ["слишком много прогулок", page(Array.from({ length: 21 }, () => catalog))],
    ["непродвигающаяся страница", page([catalog], 0)],
    ["неверный список станций", { ...page([catalog]), filters: { starts: [""], ends: [], stations: [] } }],
    ["станция фильтра без названия", { ...page([catalog]), filters: { starts: [], ends: [], stations: [{ name: "", lines: [] }] } }],
    ["зона станции не флаг", { ...page([catalog]), filters: { starts: [], ends: [], stations: [{ name: "Тульская", lines: [], insideCircle: "да" }] } }],
    ["небезопасный цвет линии в фильтре", { ...page([catalog]), filters: { starts: [], ends: [], stations: [{ name: "Тульская", lines: [{ ...lines[0], color: "url(x)" }] }] } }],
  ])("отклоняет: %s", (_name, value) => {
    expect(() => validateTopWalkPage(value)).toThrow(TypeError);
  });

  it("без линий от сервера берёт их из станций прогулок", () => {
    const legacy = validateTopWalkPage({ ...page([catalog, shared]), filters: { starts: ["Павелецкая"], ends: ["Тульская"] } });
    expect(legacy.filters.stations).toEqual([
      { name: "Павелецкая", lines, insideCircle: false }, { name: "Тульская", lines, insideCircle: false },
      { name: "Арбатская", lines: shared.startMetro.lines, insideCircle: false }, { name: "Смоленская", lines: [], insideCircle: false },
    ]);
  });

  const options = [
    { name: "Белорусская", lines: [{ id: "2", name: "Замоскворецкая", color: "#4fb04f" }] },
    { name: "Китай-город", lines: [{ id: "6", name: "Калужско-Рижская", color: "#f07e24" }] },
    { name: "Новокузнецкая", lines: [] },
    { name: "Кузнецкий Мост", lines: [] },
    { name: "Щёлковская", lines: [] },
    { name: "@circle", lines: [{ id: "5", name: "Кольцевая", color: "#915133" }], label: "Внутри Кольцевой", hint: "Станции Кольцевой линии и центра" },
  ];
  it.each([
    ["пустой запрос оставляет порядок", "  ", ["Белорусская", "Китай-город", "Новокузнецкая", "Кузнецкий Мост", "Щёлковская", "@circle"]],
    ["зону ищут по её подписи, а не по значению", "внутри", ["@circle"]],
    ["зону находят по подсказке", "центр", ["@circle"]],
    ["значение зоны не ищется", "circle", []],
    ["начало названия раньше середины", "кузн", ["Кузнецкий Мост", "Новокузнецкая"]],
    ["второе слово через дефис", "город", ["Китай-город"]],
    ["регистр и ё не важны", "ЩЕЛК", ["Щёлковская"]],
    ["по названию линии", "замоскв", ["Белорусская"]],
    ["нет совпадений", "xyz", []],
  ])("поиск станции: %s", (_name, query, expected) => {
    expect(searchMetroOptions(options, query).map(option => option.name)).toEqual(expected);
  });

  it("фильтрует границы длительности вместе с метро", () => {
    const walks = validateTopWalks({ walks: [catalog, shared] });
    expect(filterTopWalks(walks, "Павелецкая", "").map(walk => walk.id)).toEqual([catalog.id]);
    expect(filterTopWalks(walks, "", "Смоленская", "up-to-30").map(walk => walk.id)).toEqual([shared.id]);
    expect(filterTopWalks(walks, "Павелецкая", "Смоленская")).toEqual([]);
    expect(filterTopWalks(walks, "", "", "31-to-60").map(walk => walk.id)).toEqual([catalog.id]);
    expect(topWalksUrl(20, { start: "Арбатская", end: "", duration: "up-to-30" })).toBe("/api/top-walks?offset=20&start=%D0%90%D1%80%D0%B1%D0%B0%D1%82%D1%81%D0%BA%D0%B0%D1%8F&duration=up-to-30");
  });

  it("все цвета линий метро дают читаемую букву M", () => {
    const luminance = (hex: string) => {
      const [red, green, blue] = [1, 3, 5].map(index => Number.parseInt(hex.slice(index, index + 2), 16) / 255)
        .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
      return red * 0.2126 + green * 0.7152 + blue * 0.0722;
    };
    for (const color of new Set(metroData.stations.map(station => station.line.color))) {
      const foreground = metroTextColor(color);
      const brighter = Math.max(luminance(color), luminance(foreground));
      const darker = Math.min(luminance(color), luminance(foreground));
      expect((brighter + 0.05) / (darker + 0.05), color).toBeGreaterThanOrEqual(4.5);
    }
  });

  it.each([[1, "1 история"], [2, "2 истории"], [5, "5 историй"], [11, "11 историй"], [21, "21 история"], [22, "22 истории"]])("%i → %s", (count, label) => {
    expect(storyCountLabel(count)).toBe(label);
  });
  it("собирает строку времени, длины и историй", () => {
    expect(formatTopWalkMeta(catalog)).toBe("45 мин · 3,2 км · 6 историй");
  });
  it.each([["en", "45 min · 3.2 km · 6 stories"], ["zh", "45 分钟 · 3.2 公里 · 6 个故事"]] as const)("форматирует описание прогулки для %s", (locale, label) => {
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

  it("показывает карту маршрута, цвета линий метро и ссылку на подробную прогулку", async () => {
    fetcher.mockResolvedValue(ok(page([catalog, shared])));
    await render();
    expect(fetcher).toHaveBeenCalledWith("/api/top-walks", expect.objectContaining({ credentials: "same-origin" }));
    const items = [...container.querySelectorAll("ol > li")];
    expect(items.map(item => item.querySelector("span[class*=rank]")?.textContent)).toEqual(["1", "2"]);
    expect(items.map(item => item.querySelector("a")?.getAttribute("href"))).toEqual(["/walk?catalog=msk-walk", `/walk?share=${TOKEN}`]);
    expect(items[0].querySelector("a")?.getAttribute("aria-label")).toBe("Подробнее о маршруте «Кожевники»");
    expect(items[0].querySelector("image")?.getAttribute("href")).toBe("https://tile.openstreetmap.org/16/39612/20487.png");
    expect(items[0].querySelectorAll("a")[1]?.getAttribute("href")).toBe("https://www.openstreetmap.org/copyright");
    expect(items[0].querySelector("polyline")?.getAttribute("points")).toBe("80,180 128,128 180,80");
    expect(items[0].textContent).toContain("OpenStreetMap");
    expect(items[0].querySelector("span[title=Замоскворецкая]")?.getAttribute("style")).toContain("background-color: rgb(79, 176, 79)");
    expect(items[0].textContent).toContain("Старт: м. Павелецкая");
    expect(items[0].textContent).toContain("Финиш: м. Тульская");
    expect(items[0].textContent).toContain("★ 4,6 · 12 оценок");
  });

  it("при сбое тайла один раз повторяет загрузку и показывает схему маршрута", async () => {
    fetcher.mockResolvedValue(ok(page([catalog])));
    await render();
    vi.useFakeTimers();
    try {
      await act(async () => { container.querySelector("image")!.dispatchEvent(new Event("error")); });
      await act(async () => { vi.advanceTimersByTime(500); });
      expect(container.querySelector("image")).not.toBeNull();
      await act(async () => { container.querySelector("image")!.dispatchEvent(new Event("error")); });
      expect(container.querySelector("image")).toBeNull();
      expect(container.querySelector("polyline")?.getAttribute("points")).toBe("8,92 50,40 92,8");
    } finally { vi.useRealTimers(); }
  });

  it("отправляет фильтры по метро и длительности на сервер", async () => {
    fetcher.mockImplementation((url: string) => {
      const params = new URL(url, "http://local.test").searchParams;
      return Promise.resolve(ok(page(params.get("duration") === "up-to-30" ? [shared] : [catalog, shared], null, params.get("duration") === "up-to-30" ? 1 : 2)));
    });
    await render(true);
    const selects = [...container.querySelectorAll<HTMLSelectElement>("select")];
    expect(selects).toHaveLength(1);
    await act(async () => { selects[0].value = "up-to-30"; selects[0].dispatchEvent(new Event("change", { bubbles: true })); });
    expect(container.querySelectorAll("ol > li")).toHaveLength(1);
    expect(container.querySelector("ol > li span[class*=rank]")?.textContent).toBe("2");
    expect(container.querySelector("[role=status]")?.textContent).toBe("Найдено: 1");
    expect(fetcher.mock.calls.at(-1)?.[0]).toBe("/api/top-walks?duration=up-to-30");
    await act(async () => { [...container.querySelectorAll("button")].find(button => button.textContent === "Сбросить фильтры")!.click(); });
    expect(container.querySelectorAll("ol > li")).toHaveLength(2);
  });

  it("при прокрутке последовательно добавляет страницы по 20 без повторных запросов", async () => {
    const observers: Array<{ target: Element | null; trigger: () => void }> = [];
    vi.stubGlobal("IntersectionObserver", class {
      target: Element | null = null;
      callback: IntersectionObserverCallback;
      constructor(callback: IntersectionObserverCallback) { this.callback = callback; observers.push(this); }
      observe(target: Element) { this.target = target; }
      disconnect() {}
      trigger() { this.callback([{ isIntersecting: true } as IntersectionObserverEntry], this as unknown as IntersectionObserver); }
    });
    const first = Array.from({ length: 20 }, (_, index) => ({ ...catalog, id: `walk-${index + 1}`, rank: index + 1 }));
    const second = Array.from({ length: 20 }, (_, index) => ({ ...catalog, id: `walk-${index + 21}`, rank: index + 21 }));
    const third = Array.from({ length: 3 }, (_, index) => ({ ...catalog, id: `walk-${index + 41}`, rank: index + 41 }));
    fetcher.mockImplementation((url: string) => Promise.resolve(ok(url.includes("offset=40") ? page(third, null, 43) : url.includes("offset=20") ? page(second, 40, 43) : page(first, 20, 43))));
    await render();
    const lastLoader = () => observers.filter(observer => observer.target?.className.includes("loadMore")).at(-1);
    const loader = lastLoader();
    expect(loader).toBeDefined();
    await act(async () => { loader!.trigger(); loader!.trigger(); });
    expect(container.querySelectorAll("ol > li")).toHaveLength(40);
    await act(async () => { lastLoader()!.trigger(); });
    expect(container.querySelectorAll("ol > li")).toHaveLength(43);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(container.querySelector("button[class*=moreButton]")).toBeNull();
  });

  it("смена фильтра отменяет старую подгрузку и сохраняет фокус на поле", async () => {
    let resolveMore: ((response: Response) => void) | undefined;
    fetcher.mockImplementation((url: string) => {
      if (url.includes("offset=1")) return new Promise<Response>(resolve => { resolveMore = resolve; });
      return Promise.resolve(ok(url.includes("duration=up-to-30") ? page([shared], null, 1) : page([catalog], 1, 2)));
    });
    await render(true);
    await act(async () => { container.querySelector<HTMLButtonElement>("button[class*=moreButton]")!.click(); });
    expect(resolveMore).toBeDefined();
    const duration = container.querySelectorAll<HTMLSelectElement>("select")[0];
    duration.focus();
    await act(async () => { duration.value = "up-to-30"; duration.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(document.activeElement).toBe(duration);
    expect(container.querySelectorAll("ol > li")).toHaveLength(1);
    expect(container.querySelector("ol > li")?.textContent).toContain("Арбат");
    await act(async () => { resolveMore!(ok(page([{ ...catalog, id: "stale-walk" }], null, 2))); });
    expect(container.querySelectorAll("ol > li")).toHaveLength(1);
    expect(container.querySelector("ol > li")?.textContent).not.toContain("Кожевники");
    expect(container.querySelector("[role=alert]")).toBeNull();
  });

  const picker = (label: string) => {
    const field = [...container.querySelectorAll("div")].find(div => div.firstElementChild?.textContent === label && div.querySelector("button[aria-haspopup=listbox]"))!;
    return { field, trigger: field.querySelector<HTMLButtonElement>("button[aria-haspopup=listbox]")!, search: () => field.querySelector<HTMLInputElement>("input[role=combobox]") };
  };
  const key = (target: Element, name: string) => act(async () => { target.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true })); });
  const type = (input: HTMLInputElement, text: string) => act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });

  it("станцию находят поиском с клавиатуры и видят цвета её линий", async () => {
    fetcher.mockResolvedValue(ok(page([catalog, shared])));
    await render(true);
    const start = picker("Ближайшее метро к старту");
    expect(start.trigger.getAttribute("aria-expanded")).toBe("false");
    expect(start.trigger.textContent).toBe("Любая станция");
    await act(async () => { start.trigger.click(); });
    const search = start.search()!;
    expect(document.activeElement).toBe(search);
    const options = () => [...start.field.querySelectorAll("[role=option]")];
    expect(options().map(option => option.textContent)).toEqual(["Любая станция", "Внутри КольцевойСтанции Кольцевой линии и центра", "АрбатскаяАрбатско-Покровская", "ПавелецкаяЗамоскворецкая"]);
    expect(options()[0].getAttribute("aria-selected")).toBe("true");
    expect(options()[3].querySelector("[title=Замоскворецкая]")?.getAttribute("style")).toContain("background-color: rgb(79, 176, 79)");
    await type(search, "пав");
    expect(options().map(option => option.getAttribute("id"))).toEqual([search.getAttribute("aria-activedescendant")]);
    await key(search, "Enter");
    expect(fetcher.mock.calls.at(-1)?.[0]).toBe(`/api/top-walks?start=${encodeURIComponent("Павелецкая")}`);
    expect(start.search()).toBeNull();
    expect(document.activeElement).toBe(start.trigger);
    expect(start.trigger.textContent).toBe("Павелецкая");
    expect(start.trigger.querySelector("[title=Замоскворецкая]")).not.toBeNull();
  });

  it("«Внутри Кольцевой» выбирает зону и остаётся на кнопке", async () => {
    fetcher.mockResolvedValue(ok(page([catalog, shared])));
    await render(true);
    const start = picker("Ближайшее метро к старту");
    await act(async () => { start.trigger.click(); });
    await type(start.search()!, "кольц");
    expect(start.field.querySelector("[role=option]")?.textContent).toContain("Внутри Кольцевой");
    expect(start.field.querySelector<HTMLElement>("[role=option] [title=Кольцевая]")?.style.borderColor).toBe("rgb(145, 81, 51)");
    await key(start.search()!, "Enter");
    expect(fetcher.mock.calls.at(-1)?.[0]).toBe("/api/top-walks?start=%40circle");
    expect(start.trigger.textContent).toBe("Внутри Кольцевой");
  });

  it("переключатель города сбрасывает метро, сохраняет длительность и запоминает выбор", async () => {
    const kazanWalk = { ...shared, title: "Кремль", startMetro: { name: "Кремлевская", distanceM: 80, lines: [{ id: "49", name: "Центральная", color: "#cd0505" }] }, endMetro: null };
    fetcher.mockImplementation((url: string) => Promise.resolve(ok(new URL(url, "http://local.test").searchParams.get("city") === "kazan" ? page([kazanWalk]) : page([catalog, shared]))));
    try {
      await render(true);
      const cities = () => [...container.querySelectorAll<HTMLButtonElement>("[role=group][aria-label=Город] button")];
      expect(cities().map(button => [button.textContent, button.getAttribute("aria-pressed")])).toEqual([["Москва", "true"], ["Казань", "false"]]);
      const start = picker("Ближайшее метро к старту");
      await act(async () => { start.trigger.click(); });
      await type(start.search()!, "Арбат");
      await key(start.search()!, "Enter");
      const duration = container.querySelector<HTMLSelectElement>("select")!;
      await act(async () => { duration.value = "61-to-90"; duration.dispatchEvent(new Event("change", { bubbles: true })); });
      await act(async () => { cities()[1].click(); });
      await act(async () => {});
      expect(fetcher.mock.calls.at(-1)?.[0]).toBe("/api/top-walks?city=kazan&duration=61-to-90");
      expect(cities()[1].getAttribute("aria-pressed")).toBe("true");
      expect(localStorage.getItem("otgolosok:city:v1")).toBe("kazan");
      expect(container.querySelector("ol > li")?.textContent).toContain("Старт: м. Кремлевская");
    } finally { localStorage.clear(); }
  });

  it("смена города в другой вкладке сбрасывает метро и не показывает старый список", async () => {
    const kazanWalk = { ...shared, id: "33333333-3333-4333-8333-333333333333", title: "Кремль", startMetro: null, endMetro: null };
    let release: (value: Response) => void = () => {};
    fetcher.mockImplementation((url: string) => new URL(url, "http://local.test").searchParams.get("city") === "kazan"
      ? new Promise<Response>(resolve => { release = resolve; }) : Promise.resolve(ok(page([catalog, shared], 20, 40))));
    try {
      await render(true);
      const start = picker("Ближайшее метро к старту");
      await act(async () => { start.trigger.click(); });
      await type(start.search()!, "Арбат");
      await key(start.search()!, "Enter");
      await act(async () => {
        localStorage.setItem("otgolosok:city:v1", "kazan");
        window.dispatchEvent(new StorageEvent("storage", { key: "otgolosok:city:v1", newValue: "kazan" }));
      });
      expect(fetcher.mock.calls.at(-1)?.[0]).toBe("/api/top-walks?city=kazan");
      expect(container.querySelectorAll("ol > li")).toHaveLength(0);
      expect(container.textContent).not.toContain("Кожевники");
      await act(async () => { release(ok(page([kazanWalk]))); });
      expect([...container.querySelectorAll("ol > li strong")].map(item => item.textContent)).toEqual(["Кремль"]);
    } finally { localStorage.clear(); }
  });

  it("без станций внутри Кольцевой пункта зоны нет", async () => {
    const outside = page([catalog]);
    fetcher.mockResolvedValue(ok({ ...outside, filters: { ...outside.filters, stations: outside.filters.stations.map(station => ({ ...station, insideCircle: false })) } }));
    await render(true);
    const start = picker("Ближайшее метро к старту");
    await act(async () => { start.trigger.click(); });
    expect([...start.field.querySelectorAll("[role=option]")].map(option => option.textContent)).toEqual(["Любая станция", "АрбатскаяАрбатско-Покровская", "ПавелецкаяЗамоскворецкая"]);
  });

  it("буква на закрытом поле начинает поиск, Escape закрывает без выбора, пустой поиск сообщает об этом", async () => {
    fetcher.mockResolvedValue(ok(page([catalog, shared])));
    await render(true);
    const end = picker("Ближайшее метро к финишу");
    await key(end.trigger, "т");
    expect(end.search()?.value).toBe("т");
    expect([...end.field.querySelectorAll("[role=option]")].map(option => option.textContent)).toEqual(["ТульскаяСерпуховско-Тимирязевская", "Внутри КольцевойСтанции Кольцевой линии и центра"]);
    await type(end.search()!, "метро без названия");
    expect(end.field.querySelector("[role=status]")?.textContent).toBe("Станция не найдена");
    await key(end.search()!, "Escape");
    expect(end.search()).toBeNull();
    expect(document.activeElement).toBe(end.trigger);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("стрелками доходят до «Любая станция» и снимают фильтр; щелчок вне списка закрывает его", async () => {
    fetcher.mockResolvedValue(ok(page([catalog, shared])));
    await render(true);
    const start = picker("Ближайшее метро к старту");
    await act(async () => { start.trigger.click(); });
    await key(start.search()!, "ArrowDown");
    await key(start.search()!, "ArrowDown");
    await key(start.search()!, "Enter");
    expect(fetcher.mock.calls.at(-1)?.[0]).toBe(`/api/top-walks?start=${encodeURIComponent("Арбатская")}`);
    await act(async () => { start.trigger.click(); });
    expect(start.field.querySelector("[aria-selected=true]")?.textContent).toContain("Арбатская");
    await key(start.search()!, "PageUp");
    await key(start.search()!, "Enter");
    expect(fetcher.mock.calls.at(-1)?.[0]).toBe("/api/top-walks");
    await act(async () => { start.trigger.click(); });
    await act(async () => { document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })); });
    expect(start.search()).toBeNull();
  });

  it("пустой топ зовёт открыть свою прогулку", async () => {
    fetcher.mockResolvedValue(ok(page([])));
    await render();
    expect(container.textContent).toContain("В топе пока пусто. Откройте свою прогулку всем");
  });

  it("ошибка следующей страницы допускает повтор без потери первой", async () => {
    fetcher.mockResolvedValueOnce(ok(page([catalog], 1, 2)))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "Временно недоступно" } }), { status: 400 }))
      .mockResolvedValueOnce(ok(page([shared], null, 2)));
    await render(true);
    await act(async () => { container.querySelector<HTMLButtonElement>("button[class*=moreButton]")!.click(); });
    expect(container.querySelector("[role=alert]")?.textContent).toContain("Временно недоступно");
    await act(async () => { container.querySelector<HTMLButtonElement>("[role=alert] button")!.click(); });
    await act(async () => { container.querySelector<HTMLButtonElement>("button[class*=moreButton]")!.click(); });
    expect(container.querySelectorAll("ol > li")).toHaveLength(2);
  });
});
