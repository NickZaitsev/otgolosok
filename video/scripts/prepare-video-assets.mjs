import {copyFile, mkdir, readFile, stat, writeFile} from "node:fs/promises";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import narration from "../src/guide-narration.json" with {type: "json"};
import createNarration from "../src/create-guide-narration.json" with {type: "json"};
import createAdNarration from "../src/create-ad-narration.json" with {type: "json"};
import motion from "../src/motion-scenes.json" with {type: "json"};
import createAd from "../src/create-ad-scenes.json" with {type: "json"};
import {clickWav, guideBedWav} from "./build-guide-audio.mjs";
import {motionBedWav} from "./build-motion-audio.mjs";
import {adBedWav} from "./build-video-bed.mjs";
import {wideMotionScore} from "./motion-wide-score.mjs";

/** Фон видеоинструкции с запасом; тест проверяет, что ролик короче. */
export const GUIDE_BED_SECONDS = 180;

const guideScreens = ["home", "history", "catalog", "route", "listen", "read-button", "text", "settings-button", "settings", "stops-button", "stops", "next"];
const createScreens = ["home", "empty", "start", "choices", "time", "time-60", "ready", "preview", "walk", "listen", "walking", "arrived", "last", "done"];
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
  ...guideScreens.map(name => [`video/assets/guide/${name}.png`, `guide/${name}.png`]),
  ...Object.keys(narration).map(id => [`video/assets/guide/voice/${id}.mp3`, `guide/voice/${id}.mp3`]),
  ...createScreens.map(name => [`video/assets/guide/create/${name}.png`, `guide/create/${name}.png`]),
  ...Object.keys(createNarration).map(id => [`video/assets/guide/create/voice/${id}.mp3`, `guide/create/voice/${id}.mp3`]),
  ...Object.keys(createAdNarration).map(id => [`video/assets/guide/create-ad/voice/${id}.mp3`, `guide/create-ad/voice/${id}.mp3`]),
  ...fonts.map(path => [`video/node_modules/@fontsource/${path}`, `fonts/${path.split("/").at(-1)}`]),
];

/** Снимки экранов инструкций не хранятся в git: их снимают тесты Playwright. */
const CAPTURE_HINT = "Снимите экраны инструкций с переменной окружения CAPTURE_VIDEO_GUIDE=1: pnpm exec playwright test e2e/video-guide.spec.ts e2e/video-create-guide.spec.ts --workers=1 (см. docs/agents/video-guide.md).";

async function sourceStat(root, source) {
  try {
    return await stat(join(root, source));
  } catch (error) {
    if (error?.code === "ENOENT" && source.startsWith("video/assets/guide/") && source.endsWith(".png")) {
      throw Object.assign(new Error(`Нет снимка ${source}. ${CAPTURE_HINT}`), {code: "ENOENT"});
    }
    throw error;
  }
}

export async function prepareVideoAssets(root, publicDir, {bedSeconds = GUIDE_BED_SECONDS} = {}) {
  for (const [source, destination] of videoAssets) {
    const sourcePath = join(root, source);
    const destinationPath = join(publicDir, destination);
    const sourceInfo = await sourceStat(root, source);
    if (!sourceInfo.isFile()) {
      throw new Error(`Материал ролика не является файлом: ${source}`);
    }
    await mkdir(dirname(destinationPath), {recursive: true});
    await copyFile(sourcePath, destinationPath);
  }
  await mkdir(join(publicDir, "video"), {recursive: true});
  await writeFile(join(publicDir, "video/ad-bed.wav"), adBedWav());
  await mkdir(join(publicDir, "guide"), {recursive: true});
  await writeFile(join(publicDir, "guide/bed.wav"), guideBedWav(bedSeconds));
  await writeFile(join(publicDir, "guide/click.wav"), clickWav());
  await mkdir(join(publicDir, "motion"), {recursive: true});
  const map = await readFile(join(root, "public/data/maps/paveletskaya.svg"), "utf8");
  await writeFile(join(publicDir, "motion/map-base.svg"), stripRouteLayer(map));
  await writeFile(join(publicDir, "motion/bed.wav"), motionBedWav(motionScore()));
  await writeFile(join(publicDir, "motion/wide-bed.wav"), motionBedWav(wideMotionScore()));
  await writeFile(join(publicDir, "motion/create-bed.wav"), motionBedWav(createAdScore()));
}

/**
 * Партитура музыки вертикального ролика из его хронометража, в секундах.
 * @param {{fps: number, scenes: {id: string, start: number, end: number}[], taps?: Record<string, number[]>}} config
 * @param {{voice: string | null, groove: string, finale: string}} cues — сцены с голосом, началом ритма и финалом.
 * @returns {{seconds: number, cuts: number[], duck: [number, number] | null, groove: number, finale: number, taps: number[]}}
 */
export function sceneScore(config, cues) {
  const scene = (id) => {
    const found = config.scenes.find((item) => item.id === id);
    if (!found) throw new Error(`В хронометраже нет сцены «${id}»`);
    return found;
  };
  const seconds = (frame) => frame / config.fps;
  return {
    seconds: seconds(config.scenes.at(-1).end),
    cuts: config.scenes.slice(1).map(({start}) => seconds(start)),
    duck: cues.voice ? [seconds(scene(cues.voice).start), seconds(scene(cues.voice).end)] : null,
    groove: seconds(scene(cues.groove).start),
    finale: seconds(scene(cues.finale).start),
    taps: Object.entries(config.taps ?? {}).flatMap(([id, frames]) => frames.map((frame) => seconds(scene(id).start + frame))),
  };
}

export function motionScore() {
  return sceneScore(motion, {voice: "listen", groove: "place", finale: "brand"});
}

/** @returns {ReturnType<typeof sceneScore>} */
export function createAdScore() {
  const score = sceneScore(createAd, {voice: null, groove: "start", finale: "brand"});
  // Фрагмент истории звучит поверх последних сцен, а не целой сцены.
  return {...score, duck: [createAd.voice / createAd.fps, score.seconds]};
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
  const root = resolve(dirname(scriptPath), "../..");
  const publicDir = join(root, "artifacts/video/public");
  try {
    await prepareVideoAssets(root, publicDir);
  } catch (error) {
    console.error("Не удалось подготовить материалы ролика:", error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
