import config from "./centre-vertical-scenes.json";
import {CENTRE_STOPS} from "./centre-geometry";
import {createSceneTimeline, type MotionSceneId, type SceneConfig} from "./motion-timeline";

// Вертикальный ролик о прогулке по центру: те же шесть сцен, что у OtgolosokMotion,
// с остановками и озвучкой из опубликованных историй (centre-walk.json).
const timeline = createSceneTimeline(config as SceneConfig<MotionSceneId>);

export const CENTRE_VERTICAL_FPS = timeline.fps;
export const CENTRE_VERTICAL_SCENES = timeline.scenes;
export const CENTRE_VERTICAL_DURATION_IN_FRAMES = timeline.duration;
export const getCentreVerticalFrameState = timeline.frameState;

function stopById(id: string) {
  const stop = CENTRE_STOPS.find((item) => item.id === id);
  if (!stop) throw new Error(`В centre-walk.json нет остановки ${id}`);
  return stop;
}

/** Места, которые по очереди показывает сцена «place», с кадром появления каждого. */
export const CENTRE_VERTICAL_PLACES = config.placeStops.map((id, index) => ({
  index: CENTRE_STOPS.indexOf(stopById(id)),
  stop: stopById(id),
  at: config.taps.place[index],
}));

const voiceStop = stopById(config.voice.stop);
const sentences = voiceStop.paragraph.split(/(?<=[.!?])\s+/);
const voiceAudio = voiceStop.audio;
if (!voiceAudio) throw new Error(`У остановки ${voiceStop.id} нет озвучки`);
const voiceSentence = sentences[config.voice.sentence];
if (!voiceSentence) throw new Error(`В абзаце остановки ${voiceStop.id} нет предложения ${config.voice.sentence}`);

/**
 * Фрагмент опубликованной озвучки: одно предложение первого абзаца.
 * Границы — паузы в MP3 (ffmpeg silencedetect), см. docs/agents/motion-video.md.
 */
export const CENTRE_VERTICAL_VOICE = {
  stop: voiceStop,
  stopNumber: CENTRE_STOPS.indexOf(voiceStop) + 1,
  audio: voiceAudio,
  sentence: voiceSentence,
  /** С какой секунды файла начинается фрагмент (чуть раньше речи). */
  fromSec: config.voice.fromSec,
  speechSec: config.voice.speechSec,
  toSec: config.voice.toSec,
  /** Кадр сцены «listen», на котором вступает голос. */
  delay: config.voice.delay,
};
