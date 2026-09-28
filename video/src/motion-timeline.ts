import config from "./motion-scenes.json";

// Хронометраж хранится в JSON: его читает и синтез музыки в scripts,
// чтобы акценты звука совпадали со склейками.
export type SceneConfig<Id extends string> = {
  fps: number;
  transitionFrames: number;
  scenes: readonly {id: Id; start: number; end: number}[];
};

export type SceneFrameState<Id extends string> = {
  id: Id;
  localFrame: number;
  /** Предыдущая сцена ещё видна под переходом в начале текущей. */
  outgoing: {id: Id; localFrame: number} | null;
  /** Прогресс перехода 0..1; 1 — переход завершён. */
  transition: number;
};

export function createSceneTimeline<Id extends string>({fps, transitionFrames, scenes}: SceneConfig<Id>) {
  const duration = scenes.at(-1)!.end;
  function frameState(frame: number): SceneFrameState<Id> {
    if (!Number.isInteger(frame) || frame < 0 || frame >= duration) {
      throw new RangeError(`Кадр ${frame} вне ролика`);
    }
    const index = scenes.findIndex(({start, end}) => frame >= start && frame < end);
    if (index === -1) {
      throw new Error(`Для кадра ${frame} не задана сцена`);
    }
    const scene = scenes[index];
    const localFrame = frame - scene.start;
    const inTransition = index > 0 && localFrame < transitionFrames;
    const previous = scenes[index - 1];
    return {
      id: scene.id,
      localFrame,
      outgoing: inTransition ? {id: previous.id, localFrame: frame - previous.start} : null,
      transition: inTransition ? localFrame / transitionFrames : 1,
    };
  }
  return {fps, transitionFrames, scenes, duration, frameState};
}

export type MotionSceneId = "echo" | "place" | "route" | "listen" | "trust" | "brand";
const motion = createSceneTimeline(config as SceneConfig<MotionSceneId>);

export const MOTION_FPS = motion.fps;
export const MOTION_TRANSITION_FRAMES = motion.transitionFrames;
export const MOTION_SCENES = motion.scenes;
export const MOTION_DURATION_IN_FRAMES = motion.duration;
export type MotionFrameState = SceneFrameState<MotionSceneId>;
export const getMotionFrameState = motion.frameState;
