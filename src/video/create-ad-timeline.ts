import config from "./create-ad-scenes.json";
import {createSceneTimeline, type SceneConfig} from "./motion-timeline";

export type CreateAdSceneId = "hook" | "start" | "time" | "build" | "walk" | "brand";

const timeline = createSceneTimeline(config as SceneConfig<CreateAdSceneId>);

export const CREATE_AD_FPS = timeline.fps;
export const CREATE_AD_TRANSITION_FRAMES = timeline.transitionFrames;
export const CREATE_AD_SCENES = timeline.scenes;
export const CREATE_AD_DURATION_IN_FRAMES = timeline.duration;
export const getCreateAdFrameState = timeline.frameState;

/** Кадры нажатий внутри сцен; по ним же синтезируются щелчки в музыке. */
export const CREATE_AD_TAPS = config.taps as Partial<Record<CreateAdSceneId, number[]>>;

export function tapAt(id: CreateAdSceneId): number {
  const frame = CREATE_AD_TAPS[id]?.[0];
  if (frame === undefined) throw new Error(`В сцене «${id}» нет нажатия`);
  return frame;
}
