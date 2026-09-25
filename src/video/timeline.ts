export const FPS = 30;

export const SCENES = [
  {id: "intro", start: 0, end: 105},
  {id: "map", start: 105, end: 255},
  {id: "listen", start: 255, end: 435},
  {id: "outro", start: 435, end: 540},
] as const;

export const DURATION_IN_FRAMES = SCENES.at(-1)!.end;

export type SceneId = (typeof SCENES)[number]["id"];

export function getSceneAt(frame: number): {id: SceneId; localFrame: number} {
  if (!Number.isInteger(frame) || frame < 0 || frame >= DURATION_IN_FRAMES) {
    throw new RangeError(`Кадр ${frame} вне ролика`);
  }

  const scene = SCENES.find(({start, end}) => frame >= start && frame < end);
  if (!scene) {
    throw new Error(`Для кадра ${frame} не задана сцена`);
  }

  return {id: scene.id, localFrame: frame - scene.start};
}
