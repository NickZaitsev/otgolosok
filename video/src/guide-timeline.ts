import voiceManifest from "../assets/guide/voice/manifest.json";
import narration from "./guide-narration.json";
import targets from "../assets/guide/targets.json";
import type {Rect} from "./guide-camera";

export const GUIDE_FPS = 30;
export const GUIDE_WIDTH = 1920;
export const GUIDE_HEIGHT = 1080;
export const GUIDE_TRANSITION_FRAMES = 15;

/** Шаг инструкции; tip заменяет подсказку «Нажмите «action»», если нажимают не на кнопку. */
export type GuideStepSpec = {
  id: string; before: string; after: string; page: string; resultPage: string;
  title: string; description: string; result: string; action: string; focus: Rect; resultFocus: Rect;
  tip?: string;
};
export type VoiceManifest = Partial<Record<string, {durationSeconds: number}>>;
/** Всё, что отличает одну видеоинструкцию от другой. */
export type GuideSpec = {
  label: string; voiceDir: string; steps: readonly GuideStepSpec[];
  targets: Record<string, Rect>; voice: VoiceManifest;
};

// Области камеры в CSS-пикселях снимка 1280×800.
const PANEL: Rect = {x: 405, y: 330, width: 470, height: 380};
const PANEL_TALL: Rect = {x: 395, y: 175, width: 490, height: 530};

export const GUIDE_STEPS = [
  {id: "home", before: "home", after: "history", page: "Рядом", resultPage: "История", title: "Откройте «Историю»", description: "В нижнем меню нажмите «История».", result: "Здесь ваши прогулки и готовые маршруты.", action: "История",
    focus: {x: 300, y: 430, width: 680, height: 370}, resultFocus: {x: 100, y: 0, width: 1080, height: 680}},
  {id: "catalog", before: "catalog", after: "route", page: "История", resultPage: "Прогулка", title: "Выберите прогулку", description: "Прокрутите к готовому маршруту и нажмите «Открыть прогулку».", result: "Откроется карта с путём и остановками.", action: "Открыть прогулку",
    focus: {x: 120, y: 380, width: 1040, height: 420}, resultFocus: {x: 300, y: 30, width: 680, height: 760}},
  {id: "start", before: "route", after: "listen", page: "Прогулка", resultPage: "Прогулка", title: "Начните маршрут", description: "Посмотрите путь и нажмите «Начать прогулку».", result: "Появится первая остановка, зазвучит рассказ.", action: "Начать прогулку",
    focus: {x: 400, y: 420, width: 480, height: 300}, resultFocus: {x: 380, y: 60, width: 520, height: 650}},
  {id: "pause", before: "listen", after: "read-button", page: "Прогулка", resultPage: "Прогулка", title: "Управляйте звуком", description: "Круглая кнопка ставит рассказ на паузу.", result: "Нажмите ещё раз, чтобы продолжить.", action: "Пауза",
    focus: PANEL, resultFocus: PANEL},
  {id: "read", before: "read-button", after: "text", page: "Прогулка", resultPage: "Прогулка", title: "Читайте историю", description: "Нажмите «Читать историю» — текст откроется в карточке.", result: "Повторное нажатие свернёт текст.", action: "Читать историю",
    focus: PANEL, resultFocus: PANEL_TALL},
  {id: "settings", before: "settings-button", after: "settings", page: "Прогулка", resultPage: "Прогулка", title: "Настройте под себя", description: "Кнопка с ползунками открывает настройки прогулки.", result: "Переключение остановок и скорость аудио.", action: "Настройки",
    focus: PANEL, resultFocus: PANEL_TALL},
  {id: "stops", before: "stops-button", after: "stops", page: "Прогулка", resultPage: "Прогулка", title: "Откройте остановки", description: "Нажмите «Остановки», чтобы увидеть все части прогулки.", result: "Любую можно выбрать из списка.", action: "Остановки",
    focus: PANEL, resultFocus: PANEL_TALL},
  {id: "next", before: "stops", after: "next", page: "Прогулка", resultPage: "Прогулка", title: "Продолжайте путь", description: "Выберите следующую историю в списке.", result: "«Дальше» тоже переключает. Без геопозиции — вручную.", action: "Следующая история",
    focus: PANEL_TALL, resultFocus: {x: 405, y: 290, width: 470, height: 420}},
] as const satisfies readonly (GuideStepSpec & {before: keyof typeof targets})[];

export type GuideStep = GuideStepSpec;
export type VoiceClip = keyof typeof narration;
// Manifest создаётся скриптом озвучки; отсутствие клипа — ошибка сборки ролика, а не тихая пауза.
const voice: VoiceManifest = voiceManifest;

const LEAD_FRAMES = 15;
const MIN_CLICK_FRAME = 80;
const AFTER_CLICK_FRAMES = 18;
const TAIL_FRAMES = 30;

export function voiceFrames(id: VoiceClip) {
  return voiceFramesIn(voice, id);
}

export function voiceFramesIn(manifest: VoiceManifest, id: string) {
  const seconds = manifest[id]?.durationSeconds;
  if (!(typeof seconds === "number" && seconds > 0)) throw new Error(`Нет озвучки «${id}»: запустите pnpm video:voice`);
  return Math.ceil(seconds * GUIDE_FPS);
}

/**
 * Хронометраж шага по озвучке: инструкция → нажатие → результат.
 * Нажатие не раньше 80-го кадра, чтобы камера и курсор успели дойти до цели.
 */
export function stepTiming(doFrames: number, doneFrames: number) {
  if (![doFrames, doneFrames].every(value => Number.isInteger(value) && value > 0)) throw new RangeError("Длительность озвучки должна быть положительным числом кадров");
  const clickFrame = Math.max(MIN_CLICK_FRAME, LEAD_FRAMES + doFrames + 10);
  const doneFrom = clickFrame + AFTER_CLICK_FRAMES;
  return {doFrom: LEAD_FRAMES, clickFrame, doneFrom, duration: doneFrom + doneFrames + TAIL_FRAMES};
}

export const BOOKEND_VOICE_FROM = 24;

/** Хронометраж всего ролика: вступление, шаги с переходами и финал. */
export function guideTimeline(steps: readonly GuideStepSpec[], manifest: VoiceManifest) {
  const timings = steps.map(step => stepTiming(voiceFramesIn(manifest, `${step.id}-do`), voiceFramesIn(manifest, `${step.id}-done`)));
  const introFrames = Math.max(165, BOOKEND_VOICE_FROM + voiceFramesIn(manifest, "intro") + 45);
  const outroFrames = Math.max(195, BOOKEND_VOICE_FROM + voiceFramesIn(manifest, "outro") + 75);
  const scenes = [introFrames, ...timings.map(timing => timing.duration), outroFrames];
  const duration = scenes.reduce((total, frames) => total + frames, 0) - (scenes.length - 1) * GUIDE_TRANSITION_FRAMES;
  return {timings, introFrames, outroFrames, duration};
}

const guideTimelineValue = guideTimeline(GUIDE_STEPS, voice);
export const GUIDE_TIMINGS = guideTimelineValue.timings;
export const GUIDE_INTRO_FRAMES = guideTimelineValue.introFrames;
export const GUIDE_OUTRO_FRAMES = guideTimelineValue.outroFrames;
export const GUIDE_DURATION_IN_FRAMES = guideTimelineValue.duration;
export const GUIDE: GuideSpec = {label: "Как пользоваться сайтом", voiceDir: "guide/voice", steps: GUIDE_STEPS, targets, voice};
