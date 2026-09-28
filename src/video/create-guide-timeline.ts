import voiceManifest from "../../video/assets/guide/create/voice/manifest.json";
import targets from "../../video/assets/guide/create/targets.json";
import type {Rect} from "./guide-camera";
import {guideTimeline, type GuideSpec, type GuideStepSpec, type VoiceManifest} from "./guide-timeline";

// Вторая инструкция: своя прогулка по времени и путь по ней.
// Снимки — e2e/video-create-guide.spec.ts, области камеры в CSS-пикселях снимка 1280×800.
const DRAFT: Rect = {x: 380, y: 90, width: 520, height: 400};
const TIME_PICKER: Rect = {x: 360, y: 90, width: 560, height: 560};
const ROUTE: Rect = {x: 400, y: 80, width: 800, height: 520};
const STOPS_LIST: Rect = {x: 360, y: 80, width: 620, height: 620};
const WALK_PAGE: Rect = {x: 320, y: 60, width: 640, height: 660};
const WALK_PANEL: Rect = {x: 395, y: 360, width: 490, height: 350};
const WALK_SETTINGS: Rect = {x: 395, y: 200, width: 490, height: 510};

export const CREATE_GUIDE_STEPS = [
  {id: "tab", before: "create/home", after: "create/empty", page: "Рядом", resultPage: "Новая прогулка", title: "Откройте «Прогулку»", description: "В нижнем меню нажмите «Прогулка».", result: "Над картой откроется панель новой прогулки.", action: "Прогулка",
    focus: {x: 300, y: 430, width: 680, height: 370}, resultFocus: {x: 40, y: 90, width: 900, height: 560}},
  {id: "map", before: "create/empty", after: "create/start", page: "Новая прогулка", resultPage: "Новая прогулка", title: "Отметьте начало", description: "Нажмите на карту там, откуда хотите начать.", result: "Адрес ближайшего дома встанет в «Откуда».", action: "карта", tip: "Нажмите на место старта",
    focus: {x: 40, y: 90, width: 900, height: 560}, resultFocus: {x: 400, y: 90, width: 760, height: 480}},
  {id: "where", before: "create/start", after: "create/choices", page: "Новая прогулка", resultPage: "Новая прогулка", title: "Куда идём?", description: "Вторая точка или прогулка по времени: нажмите «Куда».", result: "Адрес, точка на карте или время.", action: "Куда",
    focus: DRAFT, resultFocus: DRAFT},
  {id: "time", before: "create/choices", after: "create/time", page: "Новая прогулка", resultPage: "Новая прогулка", title: "Гуляйте по времени", description: "Нажмите «По времени».", result: "Маршрут подстроится под ваше время.", action: "По времени",
    focus: DRAFT, resultFocus: TIME_PICKER},
  {id: "minutes", before: "create/time", after: "create/time-60", page: "Новая прогулка", resultPage: "Новая прогулка", title: "Сколько гулять?", description: "Выберите 30, 60 или 90 минут.", result: "С «Вернуться к началу» путь будет кольцом.", action: "60 мин",
    focus: TIME_PICKER, resultFocus: TIME_PICKER},
  {id: "done", before: "create/time-60", after: "create/ready", page: "Новая прогулка", resultPage: "Новая прогулка", title: "Подтвердите выбор", description: "Нажмите «Готово».", result: "В «Куда» — 60 минут с возвращением.", action: "Готово",
    focus: TIME_PICKER, resultFocus: DRAFT},
  {id: "build", before: "create/ready", after: "create/preview", page: "Новая прогулка", resultPage: "Новая прогулка", title: "Постройте маршрут", description: "Нажмите «Построить прогулку».", result: "Путь, остановки, время и расстояние.", action: "Построить прогулку",
    focus: DRAFT, resultFocus: ROUTE},
  {id: "stops", before: "create/preview", after: "create/stops", page: "Новая прогулка", resultPage: "Новая прогулка", title: "Проверьте остановки", description: "Раскройте «Остановки» — адреса идут по порядку.", result: "Не нравится — «Изменить маршрут».", action: "Остановки",
    focus: ROUTE, resultFocus: STOPS_LIST},
  {id: "open", before: "create/stops", after: "create/walk", page: "Новая прогулка", resultPage: "Прогулка", title: "Откройте прогулку", description: "Нажмите «Начать прогулку».", result: "Карта и остановки в режиме прогулки.", action: "Начать прогулку",
    focus: STOPS_LIST, resultFocus: WALK_PAGE},
  {id: "start", before: "create/walk", after: "create/listen", page: "Прогулка", resultPage: "Прогулка", title: "Начните у первой точки", description: "Ещё раз нажмите «Начать прогулку».", result: "Сайт спросит геопозицию, зазвучит история.", action: "Начать прогулку",
    focus: WALK_PAGE, resultFocus: WALK_PANEL},
  {id: "place", before: "create/settings", after: "create/settings-place", page: "Прогулка", resultPage: "Прогулка", title: "Включите «По месту»", description: "В настройках выберите переключение «По месту».", result: "Истории сменяются, когда вы подходите к дому.", action: "По месту",
    focus: WALK_SETTINGS, resultFocus: WALK_SETTINGS},
  {id: "walk", before: "create/walking", after: "create/arrived", page: "Прогулка", resultPage: "Прогулка", title: "Идите по маршруту", description: "Синяя точка на карте — это вы.", result: "У дома — новая история. Без геопозиции — «Дальше».", action: "Идти", gesture: "look", tip: "Идите по линии маршрута",
    focus: {x: 400, y: 60, width: 480, height: 330}, resultFocus: {x: 360, y: 60, width: 560, height: 440}},
  {id: "finish", before: "create/last", after: "create/done", page: "Прогулка", resultPage: "Прогулка", title: "Завершите прогулку", description: "На последней остановке нажмите «Завершить».", result: "Прогулка останется в «Истории».", action: "Завершить",
    focus: WALK_PANEL, resultFocus: {x: 300, y: 60, width: 700, height: 660}},
] as const satisfies readonly (GuideStepSpec & {before: keyof typeof targets})[];

// Manifest создаётся скриптом озвучки; отсутствие клипа — ошибка сборки ролика.
const voice: VoiceManifest = voiceManifest;

export const CREATE_GUIDE: GuideSpec = {label: "Своя прогулка", voiceDir: "guide/create/voice", steps: CREATE_GUIDE_STEPS, targets, voice};
const timeline = guideTimeline(CREATE_GUIDE_STEPS, voice);
export const CREATE_GUIDE_TIMINGS = timeline.timings;
export const CREATE_GUIDE_INTRO_FRAMES = timeline.introFrames;
export const CREATE_GUIDE_OUTRO_FRAMES = timeline.outroFrames;
export const CREATE_GUIDE_DURATION_IN_FRAMES = timeline.duration;
