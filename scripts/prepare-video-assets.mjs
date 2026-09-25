import {copyFile, mkdir, stat, writeFile} from "node:fs/promises";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import narration from "../src/video/guide-narration.json" with {type: "json"};
import {clickWav, guideBedWav} from "./build-guide-audio.mjs";

/** Фон видеоинструкции с запасом; тест проверяет, что ролик короче. */
export const GUIDE_BED_SECONDS = 180;

const guideScreens = ["home", "history", "catalog", "route", "listen", "read-button", "text", "settings-button", "settings", "stops-button", "stops", "next"];
const fonts = [
  ...["400", "600", "700"].flatMap(weight => ["cyrillic", "latin"].map(subset => `manrope/files/manrope-${subset}-${weight}-normal.woff2`)),
  ...["500", "600"].flatMap(weight => ["cyrillic", "latin"].map(subset => `cormorant-garamond/files/cormorant-garamond-${subset}-${weight}-normal.woff2`)),
];

export const videoAssets = [
  ["public/data/maps/paveletskaya.svg", "data/maps/paveletskaya.svg"],
  ["public/audio/walk/kozhevniki-d2ccb2df8e45.mp3", "audio/walk/kozhevniki-d2ccb2df8e45.mp3"],
  ["video/assets/video/moscow-evening.webp", "video/moscow-evening.webp"],
  ["video/assets/video/brick-facade.webp", "video/brick-facade.webp"],
  ["video/assets/video/ad-bed.wav", "video/ad-bed.wav"],
  ...guideScreens.map(name => [`video/assets/guide/${name}.png`, `guide/${name}.png`]),
  ...Object.keys(narration).map(id => [`video/assets/guide/voice/${id}.mp3`, `guide/voice/${id}.mp3`]),
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
