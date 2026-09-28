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

export const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));
export const lerp = (from, to, amount) => from + (to - from) * amount;

/** Кубическая кривая Безье как в CSS: x — время, y — прогресс. */
export function bezier(x1, y1, x2, y2) {
  const coordinate = (t, a, b) => 3 * a * t * (1 - t) ** 2 + 3 * b * t * t * (1 - t) + t ** 3;
  const slope = (t, a, b) => 3 * a * (1 - t) ** 2 + 6 * (b - a) * t * (1 - t) + 3 * (1 - b) * t * t;
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let step = 0; step < 8; step += 1) {
      const error = coordinate(t, x1, x2) - x;
      const derivative = slope(t, x1, x2);
      if (Math.abs(error) < 1e-6 || derivative === 0) break;
      t = clamp(t - error / derivative);
    }
    return coordinate(t, y1, y2);
  };
}

export const ease = Object.freeze({
  linear: (x) => clamp(x),
  expo: bezier(0.16, 1, 0.3, 1),
  swing: bezier(0.65, 0, 0.35, 1),
  inQuart: bezier(0.5, 0, 0.75, 0),
  outCubic: bezier(0.33, 1, 0.68, 1),
});

/**
 * Прогресс 0…1 на отрезке [from, to] с кривой.
 * @param {number} time
 * @param {number} from
 * @param {number} to
 */
export function progress(time, from, to, curve = ease.expo) {
  if (!(to > from)) throw new RangeError("Отрезок анимации должен иметь длину");
  return curve(clamp((time - from) / (to - from)));
}

/**
 * Затухающая пружина: 0 до начала, затем колебание вокруг 1.
 * @param {number} elapsed секунды от старта
 */
export function spring(elapsed, {frequency = 2.4, damping = 7} = {}) {
  if (elapsed <= 0) return 0;
  return 1 - Math.exp(-damping * elapsed) * Math.cos(2 * Math.PI * frequency * elapsed);
}

/**
 * Многоугольник для clip-path из горизонтальных полос, выезжающих слева.
 * Полосы соединены по левому краю отрезками нулевой площади.
 * @param {number[]} widths доли ширины каждой полосы, 0…1
 */
export function stripesPolygon(widths) {
  if (widths.length === 0) throw new RangeError("Нужна хотя бы одна полоса");
  const band = 100 / widths.length;
  const points = widths.flatMap((width, index) => {
    const top = index * band;
    const bottom = top + band;
    const right = clamp(width) * 100;
    return [`0% ${top}%`, `${right}% ${top}%`, `${right}% ${bottom}%`, `0% ${bottom}%`];
  });
  return `polygon(${points.join(", ")})`;
}

/**
 * Точки ломаной из атрибута d вида "M x,y L x,y …".
 * @param {string} d
 */
export function parsePolyline(d) {
  const points = Array.from(d.matchAll(/[ML]\s*(-?\d+(?:\.\d+)?)[ ,](-?\d+(?:\.\d+)?)/g), ([, x, y]) => ({x: Number(x), y: Number(y)}));
  if (points.length < 2) throw new RangeError("В пути должно быть хотя бы две точки");
  return points;
}

/**
 * Ломаная с измеренной длиной: точка по доле пути и доля пути ближайшей точки.
 * @param {{x: number, y: number}[]} points
 */
export function polyline(points) {
  const legs = points.slice(1).map((point, index) => Math.hypot(point.x - points[index].x, point.y - points[index].y));
  const length = legs.reduce((sum, leg) => sum + leg, 0);
  if (!(length > 0)) throw new RangeError("Путь нулевой длины");

  function at(share) {
    let remaining = clamp(share) * length;
    for (let index = 0; index < legs.length; index += 1) {
      if (remaining <= legs[index] || index === legs.length - 1) {
        const ratio = legs[index] === 0 ? 0 : clamp(remaining / legs[index]);
        return {x: lerp(points[index].x, points[index + 1].x, ratio), y: lerp(points[index].y, points[index + 1].y, ratio)};
      }
      remaining -= legs[index];
    }
    return points.at(-1);
  }

  /** Доля пути в ближайшей к точке позиции ломаной. */
  function shareNear(target) {
    let best = {distance: Infinity, share: 0};
    let walked = 0;
    legs.forEach((leg, index) => {
      const a = points[index];
      const b = points[index + 1];
      const ratio = leg === 0 ? 0 : clamp(((target.x - a.x) * (b.x - a.x) + (target.y - a.y) * (b.y - a.y)) / leg ** 2);
      const distance = Math.hypot(lerp(a.x, b.x, ratio) - target.x, lerp(a.y, b.y, ratio) - target.y);
      if (distance < best.distance) best = {distance, share: (walked + ratio * leg) / length};
      walked += leg;
    });
    return best.share;
  }

  return {length, at, shareNear};
}

/** Детерминированный шум 0…1 для зерна и «случайных» смещений. */
export function hash(seed) {
  const value = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return value - Math.floor(value);
}
