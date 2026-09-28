import {mkdir, writeFile} from "node:fs/promises";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import config from "../src/video/centre-vertical-scenes.json" with {type: "json"};
import {motionBedWav} from "./build-motion-audio.mjs";
import {prepareCentreVideo} from "./prepare-centre-video.mjs";
import {sceneScore} from "./prepare-video-assets.mjs";

/** Партитура вертикального ролика о центре: склейки, приглушение под голосом, щелчок на каждом месте. */
export function centreVerticalScore() {
  return sceneScore(config, {voice: "listen", groove: "place", finale: "brand"});
}

/**
 * Материалы OtgolosokCentreVertical поверх `video:prepare`: опубликованная озвучка
 * истории (через prepareCentreVideo, со сверкой SHA-256) и своя музыка.
 */
export async function prepareCentreVerticalVideo(publicDir, {prepareStory = prepareCentreVideo} = {}) {
  await prepareStory(publicDir);
  await mkdir(join(publicDir, "centre"), {recursive: true});
  await writeFile(join(publicDir, "centre/vertical-bed.wav"), motionBedWav(centreVerticalScore()));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  try {
    await prepareCentreVerticalVideo(join(root, "artifacts/video/public"));
  } catch (error) {
    console.error("Не удалось подготовить материалы ролика о центре:", error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
