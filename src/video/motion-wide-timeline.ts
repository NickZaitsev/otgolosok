import config from "./motion-wide-scenes.json";

// Хронометраж горизонтального ролика хранится в JSON: его же читает синтез
// музыки в scripts, чтобы удары совпадали со склейками TransitionSeries.
export type WideSceneId = "hook" | "logo" | "claim" | "steps" | "map" | "facts" | "outro";
export type WideScene = {id: WideSceneId; frames: number; start: number; end: number};

export const WIDE_FPS = config.fps;
/** Кадр внутри финальной сцены, когда собирается логотип. */
export const WIDE_LOCKUP_FRAME = config.lockupFrame;
export const WIDE_TRANSITIONS: readonly number[] = config.transitions;

/**
 * Начало каждой сцены на общей шкале: переход TransitionSeries накладывает
 * соседние сцены, поэтому следующая начинается раньше конца предыдущей.
 */
export function layoutWideScenes<Id extends string = WideSceneId>(scenes: readonly {id: Id; frames: number}[], transitions: readonly number[]): {id: Id; frames: number; start: number; end: number}[] {
  if (transitions.length !== scenes.length - 1) {
    throw new RangeError("Переходов должно быть на один меньше, чем сцен");
  }
  let start = 0;
  return scenes.map((scene, index) => {
    if (index > 0) {
      const overlap = transitions[index - 1];
      // Переход длиннее одной из сцен TransitionSeries не допускает.
      if (overlap >= scenes[index - 1].frames || overlap >= scene.frames) {
        throw new RangeError(`Переход ${overlap} кадров длиннее сцены «${scene.id}» или предыдущей`);
      }
      start += scenes[index - 1].frames - overlap;
    }
    return {...scene, start, end: start + scene.frames};
  });
}

export const WIDE_SCENES = layoutWideScenes(config.scenes as {id: WideSceneId; frames: number}[], WIDE_TRANSITIONS);
export const WIDE_DURATION_IN_FRAMES = WIDE_SCENES.at(-1)!.end;

export function wideScene(id: WideSceneId): WideScene {
  const scene = WIDE_SCENES.find((item) => item.id === id);
  if (!scene) throw new Error(`Сцена «${id}» не найдена`);
  return scene;
}
