export const GUIDE_FPS = 30;
export const GUIDE_WIDTH = 1920;
export const GUIDE_HEIGHT = 1080;

export const GUIDE_STEPS = [
  {id: "catalog", seconds: 10, before: "catalog", after: "route", title: "Выберите прогулку", description: "Откройте «История». Прокрутите до готового маршрута и нажмите на него.", result: "Откроется карта с остановками.", action: "Открыть прогулку", zoom: 1},
  {id: "start", seconds: 10, before: "route", after: "listen", title: "Начните маршрут", description: "Посмотрите путь и нажмите «Начать прогулку».", result: "Появится первая остановка и включится рассказ.", action: "Начать прогулку", zoom: 1.2},
  {id: "pause", seconds: 8, before: "listen", after: "read-button", title: "Управляйте звуком", description: "Круглая кнопка ставит рассказ на паузу. Нажмите ещё раз, чтобы продолжить.", result: "Можно остановиться и осмотреться.", action: "Пауза", zoom: 1.2},
  {id: "read", seconds: 10, before: "read-button", after: "text", title: "Читайте историю", description: "Нажмите «Читать историю», чтобы открыть текст прямо на карте.", result: "Повторное нажатие свернёт текст.", action: "Читать историю", zoom: 1.2},
  {id: "settings", seconds: 12, before: "settings-button", after: "settings", title: "Настройте под себя", description: "Откройте настройки. Здесь меняются скорость аудио и переключение остановок.", result: "В примере: вручную и скорость 1,25×.", action: "Настройки прогулки", zoom: 1.2},
  {id: "stops", seconds: 9, before: "stops-button", after: "stops", title: "Откройте остановки", description: "Нажмите «Остановки», чтобы увидеть все части прогулки.", result: "Любую остановку можно выбрать из списка.", action: "Остановки", zoom: 1.2},
  {id: "next", seconds: 9, before: "stops", after: "next", title: "Продолжайте путь", description: "Выберите следующую историю. Кнопка «Дальше» тоже переключает остановки.", result: "Без геопозиции переходите вручную.", action: "Следующая история", zoom: 1.2},
] as const;

export const GUIDE_INTRO_FRAMES = 150;
export const GUIDE_OUTRO_FRAMES = 180;
export const GUIDE_DURATION_IN_FRAMES = GUIDE_INTRO_FRAMES + GUIDE_STEPS.reduce((total, step) => total + step.seconds * GUIDE_FPS, 0) + GUIDE_OUTRO_FRAMES;
export type GuideStep = (typeof GUIDE_STEPS)[number];

export function guidePhase(frame: number, duration: number) {
  if (!Number.isInteger(frame) || !Number.isInteger(duration) || duration <= 90 || frame < 0 || frame >= duration) {
    throw new RangeError("Кадр вне сцены видеоинструкции");
  }
  // Четыре секунды на чтение перед действием; результат держится до конца сцены.
  const clickFrame = Math.min(120, Math.floor(duration / 2));
  return {clicked: frame >= clickFrame, clickFrame};
}
