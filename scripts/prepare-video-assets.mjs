import {copyFile, mkdir, stat} from "node:fs/promises";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";

export const videoAssets = [
  ["public/data/maps/paveletskaya.svg", "data/maps/paveletskaya.svg"],
  ["public/audio/walk/kozhevniki-d2ccb2df8e45.mp3", "audio/walk/kozhevniki-d2ccb2df8e45.mp3"],
  ["video/assets/video/moscow-evening.webp", "video/moscow-evening.webp"],
  ["video/assets/video/brick-facade.webp", "video/brick-facade.webp"],
  ["video/assets/video/ad-bed.wav", "video/ad-bed.wav"],
  ...["catalog", "route", "listen", "read-button", "text", "settings-button", "settings", "stops-button", "stops", "next"].map(name => [`video/assets/guide/${name}.png`, `guide/${name}.png`]),
];

export async function prepareVideoAssets(root, publicDir) {
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
