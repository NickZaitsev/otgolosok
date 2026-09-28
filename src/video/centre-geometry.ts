import walk from "./centre-walk.json";

// Путь и метки прогулки по центру в координатах карты walk.size × walk.size.
// Данные собирает scripts/build-centre-walk-video.mjs.

export type Point = {x: number; y: number};

export const CENTRE_WALK = walk;
export const CENTRE_STOPS = walk.stops;

const points: Point[] = Array.from(walk.path.matchAll(/[ML](-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g), ([, x, y]) => ({x: Number(x), y: Number(y)}));
const legs = points.slice(1).map((point, index) => Math.hypot(point.x - points[index].x, point.y - points[index].y));

export const CENTRE_PATH_LENGTH = legs.reduce((sum, length) => sum + length, 0);

/** Точка на пути по доле пройденного, 0..1. */
export function centrePointAt(progress: number): Point {
  if (!Number.isFinite(progress) || progress < 0 || progress > 1) {
    throw new RangeError("Прогресс маршрута должен быть от 0 до 1");
  }
  let remaining = progress * CENTRE_PATH_LENGTH;
  for (let index = 0; index < legs.length; index += 1) {
    if (remaining <= legs[index] || index === legs.length - 1) {
      const ratio = legs[index] === 0 ? 0 : Math.min(1, remaining / legs[index]);
      return {
        x: points[index].x + (points[index + 1].x - points[index].x) * ratio,
        y: points[index].y + (points[index + 1].y - points[index].y) * ratio,
      };
    }
    remaining -= legs[index];
  }
  return points.at(-1)!;
}

/** Доля пути до вершины, ближайшей к точке. Метки остановок стоят на вершинах пути. */
export function centreProgressNear(target: Point): number {
  let best = {distance: Infinity, travelled: 0};
  let travelled = 0;
  points.forEach((point, index) => {
    if (index > 0) travelled += legs[index - 1];
    const distance = Math.hypot(point.x - target.x, point.y - target.y);
    if (distance < best.distance) best = {distance, travelled};
  });
  return best.travelled / CENTRE_PATH_LENGTH;
}

export const CENTRE_STOP_PROGRESS: readonly number[] = CENTRE_STOPS.map(centreProgressNear);
