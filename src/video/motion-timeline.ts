import config from "./motion-scenes.json";

// Хронометраж хранится в JSON: его читает и синтез музыки в scripts,
// чтобы акценты звука совпадали со склейками.
export const MOTION_FPS = config.fps;
export const MOTION_TRANSITION_FRAMES = config.transitionFrames;
export const MOTION_SCENES = config.scenes as readonly MotionScene[];
export const MOTION_DURATION_IN_FRAMES = MOTION_SCENES.at(-1)!.end;

export type MotionSceneId = "echo" | "place" | "route" | "listen" | "trust" | "brand";
type MotionScene = {id: MotionSceneId; start: number; end: number};

export type MotionFrameState = {
  id: MotionSceneId;
  localFrame: number;
  /** Предыдущая сцена ещё видна под переходом в начале текущей. */
  outgoing: {id: MotionSceneId; localFrame: number} | null;
  /** Прогресс перехода 0..1; 1 — переход завершён. */
  transition: number;
};

export function getMotionFrameState(frame: number): MotionFrameState {
  if (!Number.isInteger(frame) || frame < 0 || frame >= MOTION_DURATION_IN_FRAMES) {
    throw new RangeError(`Кадр ${frame} вне ролика`);
  }
  const index = MOTION_SCENES.findIndex(({start, end}) => frame >= start && frame < end);
  if (index === -1) {
    throw new Error(`Для кадра ${frame} не задана сцена`);
  }
  const scene = MOTION_SCENES[index];
  const localFrame = frame - scene.start;
  const inTransition = index > 0 && localFrame < MOTION_TRANSITION_FRAMES;
  const previous = MOTION_SCENES[index - 1];
  return {
    id: scene.id,
    localFrame,
    outgoing: inTransition ? {id: previous.id, localFrame: frame - previous.start} : null,
    transition: inTransition ? localFrame / MOTION_TRANSITION_FRAMES : 1,
  };
}
