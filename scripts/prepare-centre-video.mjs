import {createHash} from "node:crypto";
import {mkdir, readFile, writeFile} from "node:fs/promises";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import walk from "../src/video/centre-walk.json" with {type: "json"};
import {motionBedWav} from "./build-motion-audio.mjs";
import {centreMotionScore} from "./motion-centre-score.mjs";

/** Остановка, чью историю ролик показывает на карточке и даёт послушать. */
export const CENTRE_VOICE_STOP = "osm:relation:3030568";

/**
 * Материалы ролика «Прогулка по центру» поверх `video:prepare`: музыка по его
 * хронометражу и опубликованная озвучка истории. Файл озвучки скачивается один
 * раз и сверяется с SHA-256 из его адреса.
 */
export async function prepareCentreVideo(publicDir, {download = fetch} = {}) {
  await mkdir(join(publicDir, "centre"), {recursive: true});
  await writeFile(join(publicDir, "centre/bed.wav"), motionBedWav(centreMotionScore()));

  const stop = walk.stops.find(({id}) => id === CENTRE_VOICE_STOP);
  if (!stop?.audio) throw new Error("У истории для карточки нет озвучки");
  const expected = stop.audio.url.match(/([0-9a-f]{64})\.mp3$/)?.[1];
  if (!expected) throw new Error("В адресе озвучки нет SHA-256");
  const target = join(publicDir, "centre/story.mp3");
  const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
  const cached = await readFile(target).catch(() => null);
  if (cached && sha(cached) === expected) return;
  const response = await download(stop.audio.url);
  if (!response.ok) throw new Error(`Озвучка не скачалась: ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (sha(bytes) !== expected) throw new Error("Озвучка не совпала с SHA-256 из адреса");
  await writeFile(target, bytes);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  await prepareCentreVideo(join(root, "artifacts/video/public"));
}
