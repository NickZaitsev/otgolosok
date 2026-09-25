// «Камера» видеоинструкции: какую часть снимка сайта 1280×800 (CSS-пиксели)
// показать в окне браузера и где на экране окажется точка интерфейса.

export const PAGE_WIDTH = 1280;
export const PAGE_HEIGHT = 800;
/** Предел увеличения: снимки сделаны в 2×, выше 1,8× текст начинает терять резкость. */
export const MAX_ZOOM = 1.8;

export type Rect = {x: number; y: number; width: number; height: number};
export type Camera = {zoom: number; cx: number; cy: number};
export type Viewport = {width: number; height: number};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function contain(camera: Camera): Camera {
  const zoom = clamp(camera.zoom, 1, MAX_ZOOM);
  const halfWidth = PAGE_WIDTH / (2 * zoom);
  const halfHeight = PAGE_HEIGHT / (2 * zoom);
  return {zoom, cx: clamp(camera.cx, halfWidth, PAGE_WIDTH - halfWidth), cy: clamp(camera.cy, halfHeight, PAGE_HEIGHT - halfHeight)};
}

/** Наибольшее увеличение, при котором область целиком видна; за край снимка камера не выходит. */
export function cameraFor(focus?: Rect): Camera {
  if (!focus) return {zoom: 1, cx: PAGE_WIDTH / 2, cy: PAGE_HEIGHT / 2};
  if (!(focus.width > 0 && focus.height > 0)) throw new RangeError("Область камеры должна иметь положительный размер");
  return contain({
    zoom: Math.min(PAGE_WIDTH / focus.width, PAGE_HEIGHT / focus.height),
    cx: focus.x + focus.width / 2,
    cy: focus.y + focus.height / 2,
  });
}

/** Масштаб интерполируется логарифмически: наезд воспринимается равномерным. */
export function mixCamera(from: Camera, to: Camera, progress: number): Camera {
  const t = clamp(progress, 0, 1);
  return contain({
    zoom: Math.exp(Math.log(from.zoom) + (Math.log(to.zoom) - Math.log(from.zoom)) * t),
    cx: from.cx + (to.cx - from.cx) * t,
    cy: from.cy + (to.cy - from.cy) * t,
  });
}

/** Во сколько раз CSS-пиксель снимка увеличен на экране ролика. */
export function screenScale(camera: Camera, viewport: Viewport) {
  return (viewport.width / PAGE_WIDTH) * camera.zoom;
}

/** Точка снимка → координаты внутри окна браузера на экране ролика. */
export function project(point: {x: number; y: number}, camera: Camera, viewport: Viewport) {
  const scale = screenScale(camera, viewport);
  return {x: (point.x - camera.cx) * scale + viewport.width / 2, y: (point.y - camera.cy) * scale + viewport.height / 2};
}
