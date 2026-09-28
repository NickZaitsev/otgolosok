// Рендер рекламного ролика «Красная площадь и Варварка» без Remotion: страница video/red-square/
// рисует любой кадр функцией seek(t), кадры снимает scripts/lib/frame-render.mjs.
// Данные прогулки — video/red-square/walk.json (обновляются scripts/fetch-red-square-walk.mjs).
//
//   node scripts/render-red-square-video.mjs                    — полный рендер
//   node scripts/render-red-square-video.mjs --preview          — живой просмотр в браузере
//   node scripts/render-red-square-video.mjs --stills 1.5,8,14  — отдельные кадры в PNG
import {mkdtemp, readFile, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {redSquareWav} from "./red-square-music.mjs";
import {parseRenderArgs, renderStills, renderVideo, serveScene} from "./lib/frame-render.mjs";
import {DURATION, FACTS, FPS, FRAME_COUNT, HEIGHT, PLAYER, WIDTH, musicScore} from "../video/red-square/timeline.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCENE_DIR = join(root, "video/red-square");
const OUTPUT = join(root, "artifacts/video/otgolosok-red-square.mp4");
const STILLS = join(root, "artifacts/video/red-square-stills");

/**
 * Сверка сценария с данными: подписи фактов и фраза на экране взяты из опубликованных
 * историй. Если история на сайте изменится, рендер упадёт, а не покажет выдумку.
 * @param {{stops: {label: string, paragraphs: string[]}[], route: unknown[]}} walk
 */
export function checkScript(walk) {
  if (!Array.isArray(walk.stops) || walk.stops.length < 2) throw new Error("В прогулке меньше двух остановок");
  if (!Array.isArray(walk.route) || walk.route.length < 2) throw new Error("У прогулки нет геометрии маршрута");
  const text = (index) => {
    const stop = walk.stops[index];
    if (!stop) throw new Error(`В прогулке нет остановки №${index + 1}`);
    return stop.paragraphs.join(" ");
  };
  for (const fact of FACTS) {
    const story = text(fact.stop);
    const missing = fact.evidence.filter((piece) => !story.includes(piece));
    if (missing.length) throw new Error(`Факт «${fact.value}» не подтверждён историей «${walk.stops[fact.stop].label}»: ${missing.join("; ")}`);
  }
  if (!text(PLAYER.stop).includes(PLAYER.sentence)) throw new Error(`Фразы экрана нет в истории «${walk.stops[PLAYER.stop].label}»`);
}

async function render(url) {
  const work = await mkdtemp(join(tmpdir(), "otgolosok-red-square-"));
  try {
    const bed = join(work, "bed.wav");
    await writeFile(bed, redSquareWav(musicScore()));
    await renderVideo({
      url, width: WIDTH, height: HEIGHT, fps: FPS, frameCount: FRAME_COUNT, duration: DURATION, output: OUTPUT,
      audioInputs: ["-i", bed],
      audioFilter: "[1:a]aresample=48000,volume=0.7,alimiter=limit=0.85:level=disabled[audio]",
    });
  } finally {
    await rm(work, {recursive: true, force: true});
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let server;
  try {
    const options = parseRenderArgs(process.argv.slice(2));
    checkScript(JSON.parse(await readFile(join(SCENE_DIR, "walk.json"), "utf8")));
    const started = await serveScene(SCENE_DIR, new Map());
    server = started.server;
    if (options.mode === "preview") {
      console.log(`Просмотр: ${started.url}?preview  (с момента: ?preview&t=12). Остановка — Ctrl+C.`);
    } else {
      if (options.mode === "stills") await renderStills({url: started.url, width: WIDTH, height: HEIGHT, duration: DURATION, dir: STILLS, times: options.times});
      else await render(started.url);
      server.close();
    }
  } catch (error) {
    console.error("\nНе удалось отрендерить ролик:", error instanceof Error ? error.message : String(error));
    server?.close();
    process.exitCode = 1;
  }
}
