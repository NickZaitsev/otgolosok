import config from "./motion-centre-scenes.json";
import {layoutWideScenes} from "./motion-wide-timeline";

// Хронометраж ролика «Прогулка по центру». JSON читает и синтез музыки,
// чтобы удары совпадали со склейками, а щелчки — с названиями мест.
export type CentreSceneId = "hook" | "logo" | "map" | "facts" | "outro";

export const CENTRE_FPS = config.fps;
export const CENTRE_LOCKUP_FRAME = config.lockupFrame;
export const CENTRE_TRANSITIONS: readonly number[] = config.transitions;
/** Перечисление мест в хуке: начало и длительность одного названия, кадры. */
export const CENTRE_FIRE_START = config.hook.fireStart;
export const CENTRE_ITEM_FRAMES = config.hook.itemFrames;

export const CENTRE_SCENES = layoutWideScenes(config.scenes as {id: CentreSceneId; frames: number}[], CENTRE_TRANSITIONS);
export const CENTRE_DURATION_IN_FRAMES = CENTRE_SCENES.at(-1)!.end;

export function centreScene(id: CentreSceneId) {
  const scene = CENTRE_SCENES.find((item) => item.id === id);
  if (!scene) throw new Error(`Сцена «${id}» не найдена`);
  return scene;
}
