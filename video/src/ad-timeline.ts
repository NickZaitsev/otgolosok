export const AD_FPS = 30;

export const AD_SCENES = [
  {id: "city", start: 0, end: 105},
  {id: "facade", start: 105, end: 210},
  {id: "route", start: 210, end: 390},
  {id: "listen", start: 390, end: 585},
  {id: "brand", start: 585, end: 720},
] as const;

export const AD_DURATION_IN_FRAMES = AD_SCENES.at(-1)!.end;
export type AdSceneId = (typeof AD_SCENES)[number]["id"];

export function getAdSceneAt(frame: number): {id: AdSceneId; localFrame: number} {
  if (!Number.isInteger(frame) || frame < 0 || frame >= AD_DURATION_IN_FRAMES) {
    throw new RangeError(`Кадр ${frame} вне ролика`);
  }

  const scene = AD_SCENES.find(({start, end}) => frame >= start && frame < end);
  if (!scene) {
    throw new Error(`Для кадра ${frame} не задана сцена`);
  }

  return {id: scene.id, localFrame: frame - scene.start};
}
