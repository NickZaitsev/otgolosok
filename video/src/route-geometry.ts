// Тот же путь, что и в public/data/maps/paveletskaya.svg (#walking-path).
export const ROUTE_PATH = "M83.71,94.04L94.31,97.74L94.99,98.95L81.82,120.90L76.36,129.21L76.10,130.77L76.23,132.56L77.33,134.01L78.73,135.51L102.80,144.00L127.58,152.37L128.13,152.89L128.07,154.04L127.74,155.49L131.32,156.81L133.56,157.68L130.31,166.98L129.72,168.59L104.16,238.18L110.76,240.60L112.36,242.45L117.01,247.36L118.96,249.55L124.07,255.50L132.88,263.18L145.59,271.32L153.24,271.38L161.33,271.61L149.11,289.74L150.70,290.95L177.63,309.89";

type Point = {x: number; y: number};

const points: Point[] = Array.from(ROUTE_PATH.matchAll(/[ML](-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g), ([, x, y]) => ({x: Number(x), y: Number(y)}));

const legs = points.slice(1).map((point, index) => Math.hypot(point.x - points[index].x, point.y - points[index].y));

export const ROUTE_LENGTH = legs.reduce((sum, length) => sum + length, 0);

export function pointOnRoute(progress: number): Point {
  if (!Number.isFinite(progress) || progress < 0 || progress > 1) {
    throw new RangeError("Прогресс маршрута должен быть от 0 до 1");
  }
  if (progress === 0) return points[0];
  if (progress === 1) return points.at(-1)!;

  let remaining = progress * ROUTE_LENGTH;
  for (let index = 0; index < legs.length; index += 1) {
    if (remaining <= legs[index] || index === legs.length - 1) {
      const ratio = remaining / legs[index];
      return {
        x: points[index].x + (points[index + 1].x - points[index].x) * ratio,
        y: points[index].y + (points[index + 1].y - points[index].y) * ratio,
      };
    }
    remaining -= legs[index];
  }

  return points.at(-1)!;
}

/** Метки остановок встроенной карты (#walk-stops, transform="translate(...)"). */
export const MAP_STOPS: readonly Point[] = [
  {x: 83.71, y: 94.04},
  {x: 127.58, y: 152.37},
  {x: 115.45, y: 207.51},
  {x: 177.63, y: 309.89},
];

/** Доля пути до ближайшей к точке позиции на маршруте, 0..1. */
export function routeProgressNear(target: Point): number {
  let best = {distance: Infinity, travelled: 0};
  let travelled = 0;
  for (let index = 0; index < legs.length; index += 1) {
    const from = points[index];
    const to = points[index + 1];
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const ratio = legs[index] === 0 ? 0 : Math.max(0, Math.min(1, ((target.x - from.x) * dx + (target.y - from.y) * dy) / legs[index] ** 2));
    const distance = Math.hypot(from.x + dx * ratio - target.x, from.y + dy * ratio - target.y);
    if (distance < best.distance) best = {distance, travelled: travelled + legs[index] * ratio};
    travelled += legs[index];
  }
  return best.travelled / ROUTE_LENGTH;
}
