// @vitest-environment jsdom
import { act, createElement, createRef } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import routeData from "../../../public/data/routes/paveletskaya.json";
import { WalkSession } from "./walk-session";
import { WalkMap } from "./walk-map";
import { getWalkChapters } from "./walk-plan";
import type { Route } from "./types";
import type { OwnWalk } from "../walks/own-walk";

const mapInput = vi.hoisted(() => ({ items: [] as Array<{ id: string; location: { lat: number; lon: number } }>, fitTarget: null as { points: Array<{ lat: number; lon: number }> } | null }));
vi.mock("../explore/explore-map", () => ({ ExploreMap: (props: typeof mapInput) => { mapInput.items = props.items; mapInput.fitTarget = props.fitTarget; return null; } }));

const route = routeData as Route;
const title = "По бульварному кольцу от Кропоткинской до Тверской";
const chapters = getWalkChapters(route);

it.each([
  [title, false, false, title],
  ["", false, false, "Ваш маршрут"],
  ["   ", false, false, "Ваш маршрут"],
  [title, true, false, chapters[0].title],
  [title, false, true, "Прогулка завершена"],
])("отображает заголовок прогулки %s в состоянии active=%s completed=%s", (savedTitle, active, completed, expected) => {
  const markup = renderToStaticMarkup(createElement(WalkSession, {
    route: { ...route, title: savedTitle }, chapters, index: 0, active, completed,
    user: null, positionFailed: false, resume: false,
    titleRef: createRef<HTMLHeadingElement>(), startRef: createRef<HTMLButtonElement>(),
    onStart: () => {}, onSelect: () => {}, onStop: () => {},
    player: null, story: null, settings: null, audioError: "",
  }));
  const document = new DOMParser().parseFromString(markup, "text/html");
  expect(document.querySelector("h1")?.textContent).toBe(expected);
});

it.each(["session", "map"])("%s ставит маркеры в точки прослушивания, сохраняя координаты объектов", component => {
  const listeningPoint = { lat: 55.751, lon: 37.602 };
  const selected = [
    { ...chapters[0], trigger_location: listeningPoint },
    { ...chapters[1], trigger_location: undefined },
  ];
  const originalLocations = selected.map(chapter => ({ ...chapter.location }));
  expect(listeningPoint).not.toEqual(originalLocations[0]);
  if (component === "session") {
    renderToStaticMarkup(createElement(WalkSession, {
      route, chapters: selected, index: 0, active: false, completed: false,
      user: null, positionFailed: false, resume: false,
      titleRef: createRef<HTMLHeadingElement>(), startRef: createRef<HTMLButtonElement>(),
      onStart: () => {}, onSelect: () => {}, onStop: () => {},
      player: null, story: null, settings: null, audioError: "",
    }));
  } else {
    renderToStaticMarkup(createElement(WalkMap, { chapters: selected, index: 0, path: route.walk?.path, user: null, distanceToNextM: null, onSelect: () => {} }));
  }
  expect(mapInput.items.find(item => item.id === selected[0].id)?.location).toEqual(listeningPoint);
  expect(mapInput.items.find(item => item.id === selected[1].id)?.location).toEqual(originalLocations[1]);
  expect(selected.map(chapter => chapter.location)).toEqual(originalLocations);
});

function sessionDocument(props: { active?: boolean; completed?: boolean; ratingLabel?: string; hasReview?: boolean; ratingCount?: number | null; reviews?: string | null; own?: OwnWalk | null; positionFailed?: boolean; user?: { lat: number; lon: number; accuracyM: number } | null }) {
  const markup = renderToStaticMarkup(createElement(WalkSession, {
    route, chapters, index: 0, active: props.active ?? false, completed: props.completed ?? false,
    user: props.user ?? null, positionFailed: props.positionFailed ?? false, resume: false,
    titleRef: createRef<HTMLHeadingElement>(), startRef: createRef<HTMLButtonElement>(),
    onStart: () => {}, onSelect: () => {}, onStop: () => {},
    player: null, story: null, settings: null, audioError: "",
    ratingLabel: props.ratingLabel, hasReview: props.hasReview, ratingCount: props.ratingCount, reviews: props.reviews, own: props.own,
  }));
  return new DOMParser().parseFromString(markup, "text/html");
}
const buttonTexts = (document: Document) => [...document.querySelectorAll("button")].map(button => button.textContent);

async function mountSession(props: { active?: boolean; completed?: boolean; ratingLabel?: string; ratingCount?: number | null; reviewable?: boolean; improvable?: boolean; walk?: Route["walk"]; offline?: boolean; resume?: boolean; resumeIndex?: number; positionFailed?: boolean; user?: { lat: number; lon: number; accuracyM: number } | null }) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const onRate = vi.fn(), onImprove = vi.fn(), onStart = vi.fn(), onRetryPosition = vi.fn();
  await act(async () => root.render(createElement(WalkSession, {
    route: props.walk ? { ...route, walk: props.walk } : route, chapters, index: 0, active: props.active ?? false, completed: props.completed ?? false,
    user: props.user ?? null, positionFailed: props.positionFailed ?? false, resume: props.resume ?? false, resumeIndex: props.resumeIndex, onRetryPosition,
    titleRef: createRef<HTMLHeadingElement>(), startRef: createRef<HTMLButtonElement>(),
    onStart, onSelect: () => {}, onStop: () => {},
    player: null, story: null, settings: createElement("p", null, "настройки"), audioError: "",
    offline: props.offline ? createElement("p", { "data-testid": "offline" }, "офлайн") : null,
    ratingLabel: props.ratingLabel, ratingCount: props.ratingCount,
    reviews: props.reviewable === false ? null : createElement("p", { "data-testid": "reviews" }, "список"), onRate,
    onImprove: props.improvable === false ? null : onImprove,
  })));
  const find = (text: string) => [...container.querySelectorAll("button")].find(button => button.textContent === text);
  const click = (element: HTMLElement) => act(async () => element.click());
  const unmount = async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); };
  return { container, find, click, onRate, onImprove, onStart, onRetryPosition, unmount };
}

it("во время прогулки показывает состояние геопозиции и следующую остановку", () => {
  const pending = sessionDocument({ active: true });
  expect(pending.querySelector(".walk-session-location")?.textContent).toBe("Определяем положение…");
  expect(pending.querySelector(".walk-session-following")?.textContent).toBe(`Дальше: ${chapters[1].title}`);
  const found = sessionDocument({ active: true, user: { lat: 55.75, lon: 37.62, accuracyM: 12 } });
  expect(found.querySelector(".walk-session-location")?.textContent).toBe("Положение определено");
  expect(sessionDocument({}).querySelector(".walk-session-following")).toBeNull();
});

it("при потере геопозиции с последней известной точкой открывает помощь и повторяет попытку", async () => {
  const session = await mountSession({ active: true, positionFailed: true, user: { lat: 55.75, lon: 37.62, accuracyM: 12 } });
  const status = session.container.querySelector<HTMLButtonElement>(".walk-session-location--failed")!;
  expect(status.textContent).toBe("Геопозиции нет");
  await session.click(status);
  expect(session.onRetryPosition).toHaveBeenCalledTimes(1);
  expect(status.getAttribute("aria-expanded")).toBe("true");
  expect(session.container.querySelector(".walk-session-drawer")?.textContent).toContain("Не удалось определить положение");
  await session.unmount();
});

it.each([
  [{ ratingLabel: "★ 4,6 · 12 оценок" }, true],
  [{ ratingLabel: "" }, false],
  [{ ratingLabel: "★ 4,6 · 12 оценок", active: true }, false],
  [{ ratingLabel: "★ 4,6 · 12 оценок", completed: true }, false],
])("показывает итог оценок в строке описания только до старта: %o", (props, shown) => {
  const meta = sessionDocument(props).querySelector(".walk-session-meta")?.textContent ?? "";
  expect(meta.includes("★ 4,6 · 12 оценок")).toBe(shown);
  if (shown) expect(meta).toMatch(/мин · .* км · ★ 4,6 · 12 оценок$/);
});

it.each([
  [{ reviews: "список" }, true],
  [{ reviews: null }, false],
  [{ reviews: "список", active: true }, false],
])("кнопка «Отзывы» есть только у прогулки с отзывами до старта: %o", (props, shown) => {
  expect(buttonTexts(sessionDocument(props)).includes("Отзывы")).toBe(shown);
});

it.each([
  [{ ratingCount: 0 }, "Оставить отзыв"],
  [{ ratingCount: 0, hasReview: true }, "Изменить отзыв"],
  [{ ratingCount: 3 }, "Отзывы"],
  [{ ratingCount: null }, "Отзывы"],
])("кнопка отзывов до старта без оценок зовёт оставить отзыв: %o", (props, label) => {
  const tools = sessionDocument({ reviews: "список", ...props }).querySelector(".walk-session-tools")!;
  expect([...tools.querySelectorAll("button")].at(-1)?.textContent).toBe(label);
});

it.each([
  [{}, "Оставить отзыв"],
  [{ hasReview: true }, "Изменить отзыв"],
])("после завершения главная кнопка — отзыв, «На карту» второстепенная: %o", (props, label) => {
  const document = sessionDocument({ completed: true, reviews: "список", ...props });
  const actions = document.querySelector(".walk-session-actions")!;
  expect(actions.querySelector(".walk-session-primary")?.textContent).toBe(label);
  expect(actions.querySelector(".walk-session-secondary")?.textContent).toBe("На карту");
});

const own: OwnWalk = { editHref: "/?walk=create&local=walk-1&edit=1", notes: ["У 2 остановок пока нет истории."] };
// Own walks lead back to the builder only before the start; other walks never do.
it.each([
  ["своя до старта", own, false, false, true],
  ["своя во время прогулки", own, true, false, false],
  ["своя после завершения", own, false, true, false],
  ["чужая до старта", null, false, false, false],
])("%s: «Изменить маршрут» и подсказки показаны — %s", (_, ownWalk, active, completed, shown) => {
  const document = sessionDocument({ own: ownWalk, active, completed });
  const edit = document.querySelector(".walk-session-actions a[aria-label='Изменить маршрут']");
  expect(edit?.getAttribute("href") ?? null).toBe(shown ? own.editHref : null);
  expect(document.body.textContent?.includes(own.notes[0])).toBe(shown);
});

it.each([
  [false, false],
  [true, true],
])("кнопка настроек есть только во время прогулки, в строке инструментов: active=%s → %s", (active, shown) => {
  const document = sessionDocument({ active });
  expect(Boolean(document.querySelector(".walk-session-tools [aria-label='Настройки прогулки']"))).toBe(shown);
  // Settings stay out of the heading: it keeps the cross and, for a mouse during the walk, the fold chevron beside it.
  expect(document.querySelectorAll(".walk-session-heading-actions .walk-session-icon:not(.walk-session-fold)")).toHaveLength(1);
  expect(document.querySelectorAll(".walk-session-heading-actions .walk-session-fold")).toHaveLength(active ? 1 : 0);
});

it("адреса старта и финиша не занимают карточку до старта", () => {
  const text = sessionDocument({}).querySelector(".walk-session-panel")?.textContent ?? "";
  expect(text).not.toContain(route.walk!.start.address);
  expect(text).not.toContain(route.walk!.finish.address);
});

const start = { ...route.walk!.start, address: "Москва, Никитский бульвар, 8" };
it.each([
  ["разные адреса", { ...route.walk!.finish, address: "Москва, Тверская, 1" }, ["Старт: Москва, Никитский бульвар, 8", "Финиш: Москва, Тверская, 1"]],
  ["кольцевой маршрут", { ...route.walk!.finish, address: start.address }, ["Старт и финиш: Москва, Никитский бульвар, 8"]],
])("«Остановки» показывают старт и финиш маршрута, %s", async (_, finish, expected) => {
  const session = await mountSession({ walk: { ...route.walk!, start, finish } });
  await session.click(session.find(`Остановки · ${chapters.length}`)!);
  expect([...session.container.querySelectorAll(".walk-session-endpoint")].map(line => line.textContent)).toEqual(expected);
  await session.unmount();
});

it("во время прогулки «Остановки» — только список остановок, без адресов старта и финиша", async () => {
  const session = await mountSession({ active: true });
  await session.click(session.find(`Остановка 1 из ${chapters.length}`)!);
  expect(session.container.querySelector(".walk-session-stops")).not.toBeNull();
  expect(session.container.querySelector(".walk-session-endpoint")).toBeNull();
  await session.unmount();
});

it("начатую прогулку можно продолжить с любой остановки из «Остановок»", async () => {
  const session = await mountSession({ resume: true, resumeIndex: 1 });
  await session.click(session.find(`Остановки · ${chapters.length}`)!);
  const stops = [...session.container.querySelectorAll<HTMLButtonElement>(".walk-session-stops button")];
  expect(stops).toHaveLength(chapters.length);
  expect(stops.map(stop => stop.getAttribute("aria-current"))).toEqual(chapters.map((_, i) => i === 1 ? "step" : null));
  await session.click(stops.at(-1)!);
  expect(session.onStart).toHaveBeenCalledWith(chapters.length - 1);
  expect(session.container.querySelector(".walk-session-stops")).toBeNull();
  await session.click(session.container.querySelector<HTMLButtonElement>(".walk-session-primary")!);
  expect(session.container.querySelector(".walk-session-primary")?.textContent).toContain("Продолжить прогулку");
  expect(session.onStart).toHaveBeenLastCalledWith(undefined);
  await session.unmount();
});

it("до первого старта остановки в списке — только для чтения", async () => {
  const session = await mountSession({});
  await session.click(session.find(`Остановки · ${chapters.length}`)!);
  expect(session.container.querySelectorAll(".walk-session-stops button")).toHaveLength(0);
  expect(session.container.querySelectorAll(".walk-session-stops p")).toHaveLength(chapters.length);
  await session.unmount();
});

it.each([[false, true], [true, false]])("офлайн-копия в «Остановках» при active=%s показана — %s", async (active, shown) => {
  const session = await mountSession({ active, offline: true });
  await session.click(session.find(active ? `Остановка 1 из ${chapters.length}` : `Остановки · ${chapters.length}`)!);
  expect(Boolean(session.container.querySelector("[data-testid=offline]"))).toBe(shown);
  await session.unmount();
});

it("после завершения прогулки без отзывов главная кнопка — «На карту»", () => {
  const document = sessionDocument({ completed: true, reviews: null });
  expect(document.querySelector(".walk-session-primary")?.textContent).toBe("На карту");
  expect(document.querySelector(".walk-session-secondary")).toBeNull();
  expect(buttonTexts(document)).not.toContain("Оставить отзыв");
});

it("форма отзыва не встраивается в панель: все кнопки оценки открывают отдельное окно", async () => {
  const finished = await mountSession({ completed: true });
  await finished.click(finished.find("Оставить отзыв")!);
  expect(finished.onRate).toHaveBeenCalledTimes(1);
  expect(finished.container.querySelector("form, textarea")).toBeNull();
  await finished.unmount();

  const empty = await mountSession({ ratingCount: 0 });
  await empty.click(empty.find("Оставить отзыв")!);
  expect(empty.onRate).toHaveBeenCalledTimes(1);
  expect(empty.container.querySelector(".walk-session-drawer")).toBeNull();
  await empty.unmount();
});

it.each([[true, true], [false, false]])("«Оценить прогулку» в настройках у прогулки с отзывами=%s открывает окно и закрывает настройки", async (reviewable, shown) => {
  const session = await mountSession({ active: true, reviewable });
  await session.click(session.container.querySelector<HTMLButtonElement>("[aria-label='Настройки прогулки']")!);
  expect(Boolean(session.find("Оценить прогулку"))).toBe(shown);
  if (shown) {
    await session.click(session.find("Оценить прогулку")!);
    expect(session.onRate).toHaveBeenCalledTimes(1);
    expect(session.container.querySelector(".walk-session-drawer")).toBeNull();
  }
  await session.unmount();
});

it.each([[true, true], [false, false]])("«Что улучшить в прогулке?» в настройках, когда прогулка принимает запросы=%s, открывает окно и закрывает настройки", async (improvable, shown) => {
  const session = await mountSession({ active: true, improvable });
  await session.click(session.container.querySelector<HTMLButtonElement>("[aria-label='Настройки прогулки']")!);
  expect(Boolean(session.find("Что улучшить в прогулке?"))).toBe(shown);
  if (shown) {
    await session.click(session.find("Что улучшить в прогулке?")!);
    expect(session.onImprove).toHaveBeenCalledTimes(1);
    expect(session.container.querySelector(".walk-session-drawer")).toBeNull();
  }
  await session.unmount();
});

it("экран завершения предлагает запросить улучшение, но не до старта", async () => {
  const finished = await mountSession({ completed: true });
  await finished.click(finished.find("Что улучшить в прогулке?")!);
  expect(finished.onImprove).toHaveBeenCalledTimes(1);
  await finished.unmount();

  const before = await mountSession({});
  expect(before.find("Что улучшить в прогулке?")).toBeUndefined();
  await before.unmount();
});

it("итог оценок в описании — кнопка, открывающая и закрывающая список отзывов", async () => {
  const session = await mountSession({ ratingLabel: "★ 4,3 · 4 оценки", ratingCount: 4 });
  const rating = session.container.querySelector<HTMLButtonElement>(".walk-session-meta button")!;
  expect(rating.textContent).toBe("★ 4,3 · 4 оценки");
  await session.click(rating);
  expect(session.container.querySelector("[data-testid=reviews]")?.textContent).toBe("список");
  expect(rating.getAttribute("aria-expanded")).toBe("true");
  await session.click(rating);
  expect(session.container.querySelector("[data-testid=reviews]")).toBeNull();
  expect(session.onRate).not.toHaveBeenCalled();
  await session.unmount();
});

it.each([
  { stage: "approach" as const, advance: "place" as const, audio: true, meta: "Начнётся, когда подойдёте" },
  { stage: "approach" as const, advance: "manual" as const, audio: true, meta: null },
  { stage: "approach" as const, advance: "sequence" as const, audio: true, meta: null },
  { stage: "approach" as const, advance: "place" as const, audio: false, meta: null },
  { stage: "stop" as const, advance: "place" as const, audio: true, meta: null },
  { stage: "stop" as const, advance: "manual" as const, audio: true, meta: null },
])("номер остановки — на кнопке списка, над заголовком только подсказка: $stage, $advance, аудио $audio", ({ stage, advance, audio, meta }) => {
  const stops = chapters.map(chapter => ({ ...chapter, audio: audio ? chapter.audio : undefined }));
  expect(stops[1].audio === undefined).toBe(!audio);
  const markup = renderToStaticMarkup(createElement(WalkSession, {
    route, chapters: stops, index: 1, stage, advance, active: true, completed: false,
    user: null, positionFailed: false, resume: false,
    titleRef: createRef<HTMLHeadingElement>(), startRef: createRef<HTMLButtonElement>(),
    onStart: () => {}, onSelect: () => {}, onStop: () => {},
    player: null, story: null, settings: null, audioError: "",
  }));
  const document = new DOMParser().parseFromString(markup, "text/html");
  expect(document.querySelector(".walk-session-meta")?.textContent ?? null).toBe(meta);
  expect(document.querySelector(".walk-session-tools button")?.textContent).toBe(`Остановка 2 из ${chapters.length}`);
});

it("на пути к финишу после последней остановки кнопка списка снова называет все остановки", () => {
  const markup = renderToStaticMarkup(createElement(WalkSession, {
    route, chapters, index: chapters.length, finishLeg: true, active: true, completed: false,
    user: null, positionFailed: false, resume: false,
    titleRef: createRef<HTMLHeadingElement>(), startRef: createRef<HTMLButtonElement>(),
    onStart: () => {}, onSelect: () => {}, onStop: () => {},
    player: null, story: null, settings: null, audioError: "",
  }));
  const document = new DOMParser().parseFromString(markup, "text/html");
  expect(document.querySelector(".walk-session-meta")?.textContent).toBe("До финиша");
  expect(document.querySelector(".walk-session-tools button")?.textContent).toBe(`Остановки · ${chapters.length}`);
});

async function mountPosition(denied: boolean) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const onRetryPosition = vi.fn();
  const render = (positionFailed: boolean, user: { lat: number; lon: number; accuracyM: number } | null) => act(async () => root.render(createElement(WalkSession, {
    route, chapters, index: 0, active: true, completed: false,
    user, positionFailed, positionDenied: denied && positionFailed, onRetryPosition, resume: false,
    titleRef: createRef<HTMLHeadingElement>(), startRef: createRef<HTMLButtonElement>(),
    onStart: () => {}, onSelect: () => {}, onStop: () => {},
    player: null, story: null, settings: null, audioError: "",
  })));
  await render(true, null);
  const button = () => container.querySelector<HTMLButtonElement>(".walk-session-location--failed");
  const drawer = () => container.querySelector(".walk-session-drawer");
  const unmount = async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); };
  return { container, render, button, drawer, onRetryPosition, unmount };
}

it.each([
  [true, "Сайту запрещён доступ к геопозиции", true],
  [false, "Не удалось определить положение", false],
])("«Геопозиции нет» открывает помощь и снова запрашивает доступ (запрещён=%s)", async (denied, message, helpOpen) => {
  const session = await mountPosition(denied);
  expect(session.button()?.textContent).toBe("Геопозиции нет");
  expect(session.container.textContent).not.toContain("Геопозиция недоступна");

  await act(async () => session.button()!.click());
  expect(session.onRetryPosition).toHaveBeenCalledTimes(1);
  expect(session.button()?.getAttribute("aria-expanded")).toBe("true");
  expect(session.drawer()?.textContent).toContain(message);
  expect(session.drawer()?.querySelector("details")?.open).toBe(helpOpen);

  // «Проверить снова» внутри подсказки тоже запрашивает положение заново.
  await act(async () => [...session.drawer()!.querySelectorAll("button")].find(item => item.textContent === "Проверить снова")!.click());
  expect(session.onRetryPosition).toHaveBeenCalledTimes(2);

  // Пока браузер ищет положение, панель остаётся открытой и говорит об этом.
  await session.render(false, null);
  expect(session.drawer()?.textContent).toBe("Определяем положение…");
  // Пришли координаты — подсказка и кнопка исчезают сами.
  await session.render(false, { lat: 55.75, lon: 37.6, accuracyM: 10 });
  expect(session.drawer()).toBeNull();
  expect(session.button()).toBeNull();
  await session.unmount();
});

it("адрес остановки показывается в «Читать историю», а не на карточке", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  const stop = { ...chapters[0], title: "Дом Пашкова", place: "Москва, Моховая улица, 26" };
  expect(stop.content.story.paragraphs.length).toBeGreaterThan(0);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(createElement(WalkSession, {
    route, chapters: [stop, ...chapters.slice(1)], index: 0, active: true, completed: false,
    user: null, positionFailed: false, resume: false,
    titleRef: createRef<HTMLHeadingElement>(), startRef: createRef<HTMLButtonElement>(),
    onStart: () => {}, onSelect: () => {}, onStop: () => {},
    player: null, story: createElement("p", null, "текст истории"), settings: null, audioError: "",
  })));
  expect(container.textContent).not.toContain(stop.place);

  const read = [...container.querySelectorAll<HTMLButtonElement>(".walk-session-tools button")].find(item => item.textContent === "Читать историю")!;
  await act(async () => read.click());
  const drawer = container.querySelector(".walk-session-drawer");
  expect(drawer?.querySelector(".walk-session-address")?.textContent).toBe(stop.place);
  expect(drawer?.textContent).toBe(`${stop.place}текст истории`);

  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});


it("карта перед промежуточным стартом показывает выбранный участок, оставляя начало маршрута за кадром", () => {
  const geometry = [0, 1, 2, 3, 4].map(i => ({ lat: 55.7 + i * .01, lon: 37.6 }));
  const entryChapters = chapters.slice(0, 3).map((chapter, i) => ({ ...chapter, location: geometry[i + 1], trigger_location: undefined }));
  const entryRoute: Route = { ...route, walk: { ...route.walk!, start: { ...route.walk!.start, location: geometry[0] }, path: { ...route.walk!.path, coordinates: geometry.map(point => [point.lon, point.lat]) } } };
  renderToStaticMarkup(createElement(WalkSession, {
    route: entryRoute, chapters: entryChapters, index: 2, openingIndex: 2, active: false, completed: false,
    user: null, positionFailed: false, resume: false,
    titleRef: createRef<HTMLHeadingElement>(), startRef: createRef<HTMLButtonElement>(),
    onStart: () => {}, onSelect: () => {}, onStop: () => {}, player: null, story: null, settings: null, audioError: "",
  }));
  const shownPoints = mapInput.fitTarget!.points;
  const south = Math.min(...shownPoints.map(point => point.lat));
  const north = Math.max(...shownPoints.map(point => point.lat));
  expect(south).toBeLessThanOrEqual(entryChapters[2].location.lat);
  expect(north).toBeGreaterThanOrEqual(entryChapters[2].location.lat);
  expect(south).toBeGreaterThan(entryRoute.walk!.start.location.lat);
  expect(south).toBeGreaterThan(entryChapters[0].location.lat);
});

it("при переходе к другой остановке возвращает карточку к фото, сохраняя прокрутку той же остановки", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const props = {
    route, chapters, active: true, completed: false, user: null, positionFailed: false, resume: false,
    titleRef: createRef<HTMLHeadingElement>(), startRef: createRef<HTMLButtonElement>(),
    onStart: () => {}, onSelect: () => {}, onStop: () => {}, player: null, story: null, settings: null, audioError: "",
  };
  try {
    await act(async () => root.render(createElement(WalkSession, { ...props, index: 0 })));
    const panel = container.querySelector<HTMLElement>(".walk-session-panel")!;
    panel.scrollTop = 180;
    await act(async () => root.render(createElement(WalkSession, { ...props, index: 0, positionFailed: true })));
    expect(panel.scrollTop).toBe(180);
    await act(async () => root.render(createElement(WalkSession, { ...props, index: 1 })));
    expect(panel.scrollTop).toBe(0);
    expect(container.querySelector("h1")?.textContent).toBe(chapters[1].title);
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});

async function mountFoldable() {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const props = {
    route, chapters, index: 0, completed: false, user: null, positionFailed: false, resume: false,
    titleRef: createRef<HTMLHeadingElement>(), startRef: createRef<HTMLButtonElement>(),
    onStart: () => {}, onSelect: () => {}, onStop: () => {}, story: null, audioError: "",
    player: createElement("p", { "data-testid": "player" }, "плеер"), miniPlayer: createElement("p", { "data-testid": "mini" }, "мини"),
    settings: createElement("p", null, "настройки"),
  };
  const render = (active: boolean, index = 0) => act(async () => root.render(createElement(WalkSession, { ...props, active, index })));
  await render(true);
  const panel = () => container.querySelector<HTMLElement>(".walk-session-panel")!;
  const fold = () => container.querySelector<HTMLButtonElement>(".walk-session-fold")!;
  const grip = () => container.querySelector<HTMLButtonElement>(".walk-session-handle button")!;
  const has = (selector: string) => container.querySelector(selector) !== null;
  const unmount = async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); };
  return { container, render, panel, fold, grip, has, unmount };
}

it("свёрнутая карточка прогулки оставляет заголовок, мини-плеер и кнопки, а шеврон разворачивает её", async () => {
  const card = await mountFoldable();
  try {
    expect(card.panel().hasAttribute("data-folded")).toBe(false);
    expect(card.has("[data-testid=player]")).toBe(true);
    expect(card.fold().getAttribute("aria-label")).toBe("Свернуть карточку");

    await act(async () => card.fold().click());
    expect(card.panel().hasAttribute("data-folded")).toBe(true);
    expect(card.has("[data-testid=player]")).toBe(false);
    expect(card.container.querySelector(".walk-session-mini [data-testid=mini]")).not.toBeNull();
    expect(card.has(".walk-session-tools")).toBe(false);
    expect(card.has(".walk-session-context")).toBe(false);
    expect(card.has(".walk-session-following")).toBe(false);
    expect(card.container.querySelector("h1")?.textContent).toBe(chapters[0].title);
    expect(card.container.querySelector(".walk-session-primary")?.textContent).toBe("Дальше");
    expect(card.fold().getAttribute("aria-expanded")).toBe("false");
    expect(card.grip().getAttribute("aria-label")).toBe("Развернуть карточку");

    // The walker goes on with the card folded: the next stop keeps it so.
    await card.render(true, 1);
    expect(card.panel().hasAttribute("data-folded")).toBe(true);

    await act(async () => card.fold().click());
    expect(card.panel().hasAttribute("data-folded")).toBe(false);
    expect(card.has("[data-testid=player]")).toBe(true);
    expect(card.has(".walk-session-mini")).toBe(false);
  } finally {
    await card.unmount();
  }
});

it("сворачивание закрывает открытую шторку, а новая прогулка начинается развёрнутой", async () => {
  const card = await mountFoldable();
  try {
    const settings = [...card.container.querySelectorAll<HTMLButtonElement>(".walk-session-tools button")].find(button => button.textContent === "Настройки")!;
    await act(async () => settings.click());
    expect(card.has(".walk-session-drawer")).toBe(true);
    await act(async () => card.grip().click());
    expect(card.has(".walk-session-drawer")).toBe(false);
    expect(card.panel().hasAttribute("data-folded")).toBe(true);

    await card.render(false);
    expect(card.has(".walk-session-handle")).toBe(false);
    expect(card.has(".walk-session-fold")).toBe(false);
    await card.render(true);
    expect(card.panel().hasAttribute("data-folded")).toBe(false);
  } finally {
    await card.unmount();
  }
});

it.each([
  ["вниз", 0, 80, true],
  ["вверх после сворачивания", 80, 0, false],
  ["вбок", 0, 0, false],
])("свайп по ручке %s сворачивает карточку — %s", async (_, fromY, toY, folded) => {
  const card = await mountFoldable();
  try {
    if (fromY > toY) await act(async () => card.grip().click());
    const sideways = fromY === toY;
    const grip = card.grip();
    grip.setPointerCapture = () => {};
    const pointer = (type: string, x: number, y: number) => grip.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 1, button: 0, clientX: x, clientY: y }));
    await act(async () => {
      pointer("pointerdown", 100, fromY);
      pointer("pointerup", sideways ? 180 : 100, toY);
      grip.click();
    });
    expect(card.panel().hasAttribute("data-folded")).toBe(folded);
  } finally {
    await card.unmount();
  }
});
