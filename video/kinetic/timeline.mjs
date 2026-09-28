// Хронометраж и чистая математика кинетического ролика. Модуль общий для
// страницы-сцены (браузер) и скрипта рендера (Node), поэтому без зависимостей.

export const WIDTH = 1080;
export const HEIGHT = 1920;
export const FPS = 30;
/** Доля такта музыки: 120 уд/мин, склейки стоят на ударах. */
export const BEAT = 0.5;

/** Сцены в секундах. Меняйте хронометраж только здесь: музыка строится по нему. */
export const SCENES = Object.freeze([
  {id: "hook", start: 0, end: 3},
  {id: "facade", start: 3, end: 7},
  {id: "map", start: 7, end: 12.5},
  {id: "listen", start: 12.5, end: 17},
  {id: "trust", start: 17, end: 20},
  {id: "brand", start: 20, end: 24},
]);

export const DURATION = SCENES.at(-1).end;
export const FRAME_COUNT = Math.round(DURATION * FPS);

/** Фрагмент озвучки первой остановки под сценой прослушивания, в секундах. */
export const VOICE = Object.freeze({at: 13.1, from: 0, length: 3.6});

/**
 * Время кадра в секундах.
 * @param {number} frame
 */
export function frameTime(frame) {
  if (!Number.isInteger(frame) || frame < 0 || frame >= FRAME_COUNT) {
    throw new RangeError(`Кадр должен быть целым от 0 до ${FRAME_COUNT - 1}`);
  }
  return frame / FPS;
}

/**
 * @param {string} id
 */
export function scene(id) {
  const found = SCENES.find((item) => item.id === id);
  if (!found) throw new RangeError(`Нет сцены ${id}`);
  return found;
}

/**
 * Партитура для синтезатора музыки (`motionBedWav`).
 * @returns {{seconds: number, cuts: number[], duck: [number, number], groove: number, finale: number}}
 */
export function musicScore() {
  return {
    seconds: DURATION,
    cuts: SCENES.slice(1).map(({start}) => start),
    duck: [scene("listen").start, scene("listen").end],
    groove: scene("facade").start,
    finale: scene("brand").start,
  };
}

export {bezier, clamp, ease, hash, lerp, parsePolyline, polyline, progress, spring, stripesPolygon} from "../shared/motion.mjs";
