import {copyFile, mkdir, readFile, stat, writeFile} from "node:fs/promises";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import narration from "../src/video/guide-narration.json" with {type: "json"};
import createNarration from "../src/video/create-guide-narration.json" with {type: "json"};
import motion from "../src/video/motion-scenes.json" with {type: "json"};
import {clickWav, guideBedWav} from "./build-guide-audio.mjs";
import {motionBedWav} from "./build-motion-audio.mjs";

/** Фон видеоинструкции с запасом; тест проверяет, что ролик короче. */
export const GUIDE_BED_SECONDS = 180;

const guideScreens = ["home", "history", "catalog", "route", "listen", "read-button", "text", "settings-button", "settings", "stops-button", "stops", "next"];
const createScreens = ["home", "empty", "start", "choices", "time", "time-60", "ready", "preview", "stops", "walk", "listen", "settings", "settings-place", "walking", "arrived", "last", "done"];
const fonts = [
  ...["400", "600", "700"].flatMap(weight => ["cyrillic", "latin"].map(subset => `manrope/files/manrope-${subset}-${weight}-normal.woff2`)),
  ...["500", "600"].flatMap(weight => ["cyrillic", "latin"].map(subset => `cormorant-garamond/files/cormorant-garamond-${subset}-${weight}-normal.woff2`)),
  ...["cyrillic", "latin"].map(subset => `cormorant-garamond/files/cormorant-garamond-${subset}-600-italic.woff2`),
];

export const videoAssets = [
  ["public/data/maps/paveletskaya.svg", "data/maps/paveletskaya.svg"],
  ["public/audio/walk/kozhevniki-d2ccb2df8e45.mp3", "audio/walk/kozhevniki-d2ccb2df8e45.mp3"],
  ["video/assets/video/moscow-evening.webp", "video/moscow-evening.webp"],
  ["video/assets/video/brick-facade.webp", "video/brick-facade.webp"],
  ["video/assets/video/ad-bed.wav", "video/ad-bed.wav"],
  ...guideScreens.map(name => [`video/assets/guide/${name}.png`, `guide/${name}.png`]),
  ...Object.keys(narration).map(id => [`video/assets/guide/voice/${id}.mp3`, `guide/voice/${id}.mp3`]),
  ...createScreens.map(name => [`video/assets/guide/create/${name}.png`, `guide/create/${name}.png`]),
  ...Object.keys(createNarration).map(id => [`video/assets/guide/create/voice/${id}.mp3`, `guide/create/voice/${id}.mp3`]),
  ...fonts.map(path => [`node_modules/@fontsource/${path}`, `fonts/${path.split("/").at(-1)}`]),
];

export async function prepareVideoAssets(root, publicDir, {bedSeconds = GUIDE_BED_SECONDS} = {}) {
  for (const [source, destination] of videoAssets) {
    const sourcePath = join(root, source);
    const destinationPath = join(publicDir, destination);
    const sourceInfo = await stat(sourcePath);
    if (!sourceInfo.isFile()) {
      throw new Error(`Материал ролика не является файлом: ${source}`);
    }
    await mkdir(dirname(destinationPath), {recursive: true});
    await copyFile(sourcePath, destinationPath);
  }
  await mkdir(join(publicDir, "guide"), {recursive: true});
  await writeFile(join(publicDir, "guide/bed.wav"), guideBedWav(bedSeconds));
  await writeFile(join(publicDir, "guide/click.wav"), clickWav());
  await mkdir(join(publicDir, "motion"), {recursive: true});
  const map = await readFile(join(root, "public/data/maps/paveletskaya.svg"), "utf8");
  await writeFile(join(publicDir, "motion/map-base.svg"), stripRouteLayer(map));
  await writeFile(join(publicDir, "motion/bed.wav"), motionBedWav(motionScore()));
}

/**
 * Партитура музыки моушн-ролика из его хронометража, в секундах.
 * @returns {{seconds: number, cuts: number[], duck: [number, number], groove: number, finale: number}}
 */
export function motionScore() {
  const at = (id, edge) => motion.scenes.find((scene) => scene.id === id)[edge] / motion.fps;
  return {
    seconds: motion.scenes.at(-1).end / motion.fps,
    cuts: motion.scenes.slice(1).map(({start}) => start / motion.fps),
    duck: [at("listen", "start"), at("listen", "end")],
    groove: at("place", "start"),
    finale: at("brand", "start"),
  };
}

/**
 * Подложка для моушн-ролика: карта без линии маршрута и меток остановок,
 * которые ролик рисует сам. Если разметка карты изменится, лучше упасть,
 * чем показать маршрут дважды.
 */
export function stripRouteLayer(svg) {
  const layers = [
    [/<path class="walk-path-halo"[^>]*\/>/g, 1],
    [/<path id="walking-path"[^>]*\/>/g, 1],
    [/<g data-step="[^"]*"[^>]*>.*?<\/g>/g, 4],
    [/<text class="poi-label"[^>]*>.*?<\/text>/g, 2],
  ];
  return layers.reduce((result, [pattern, expected]) => {
    const found = result.match(pattern)?.length ?? 0;
    if (found !== expected) {
      throw new Error(`В карте ожидалось ${expected} элементов ${pattern.source}, найдено ${found}`);
    }
    return result.replace(pattern, "");
  }, svg);
}

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  const root = resolve(dirname(scriptPath), "..");
  const publicDir = join(root, "artifacts/video/public");
  try {
    await prepareVideoAssets(root, publicDir);
  } catch (error) {
    console.error("Не удалось подготовить материалы ролика:", error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
