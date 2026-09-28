// Рендер кинетического ролика без Remotion: страница video/kinetic/ рисует любой
// кадр функцией seek(t), Playwright снимает кадры, ffmpeg собирает MP4 с музыкой.
//
//   node scripts/render-kinetic-video.mjs              — полный рендер
//   node scripts/render-kinetic-video.mjs --preview    — живой просмотр в браузере
//   node scripts/render-kinetic-video.mjs --stills 1.5,8,14  — отдельные кадры в PNG
import {mkdtemp, readFile, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {motionBedWav} from "./build-motion-audio.mjs";
import {parseRenderArgs, renderStills, renderVideo, run, serveScene} from "./lib/frame-render.mjs";
import {stripRouteLayer} from "./prepare-video-assets.mjs";
import {voiceLevels} from "./lib/voice-audio.mjs";
import {DURATION, FPS, FRAME_COUNT, HEIGHT, VOICE, WIDTH, musicScore} from "../kinetic/timeline.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const OUTPUT = join(root, "artifacts/video/otgolosok-kinetic.mp4");
const STILLS = join(root, "artifacts/video/kinetic-stills");
const VOICE_FILE = join(root, "public/audio/walk/kozhevniki-d2ccb2df8e45.mp3");

/** Данные маршрута для сцены: путь и метки из карты, подписи и цифры из маршрута. */
export function sceneData(route, mapSvg) {
  const path = mapSvg.match(/<path id="walking-path" d="([^"]+)"/)?.[1];
  if (!path) throw new Error("В карте нет #walking-path");
  const marks = Array.from(mapSvg.matchAll(/<g data-step="[^"]*"[^>]*transform="translate\(([\d.]+) ([\d.]+)\)"/g), ([, x, y]) => ({x: Number(x), y: Number(y)}));
  const labels = [...route.notes, ...route.pois].map(({story}) => story.opening);
  if (marks.length !== labels.length) {
    throw new Error(`Меток на карте ${marks.length}, историй в маршруте ${labels.length}`);
  }
  return {
    title: route.title,
    distanceM: Math.round(route.distance_km * 1000),
    durationMin: route.duration_min,
    stops: marks.map((mark, index) => ({...mark, label: labels[index]})),
    path,
  };
}

async function buildAssets() {
  const [routeText, mapSvg, facade, listen, pcm] = await Promise.all([
    readFile(join(root, "public/data/routes/paveletskaya.json"), "utf8"),
    readFile(join(root, "public/data/maps/paveletskaya.svg"), "utf8"),
    readFile(join(root, "video/assets/video/brick-facade.webp")),
    readFile(join(root, "video/assets/guide/listen.png")),
    run("ffmpeg", ["-v", "error", "-ss", String(VOICE.from), "-t", String(VOICE.length), "-i", VOICE_FILE, "-ac", "1", "-ar", "16000", "-f", "s16le", "-"]),
  ]);
  const data = {...sceneData(JSON.parse(routeText), mapSvg), levels: voiceLevels(pcm, 16000, {seconds: VOICE.length})};
  return new Map([
    ["/data.json", Buffer.from(JSON.stringify(data))],
    ["/assets/map.svg", Buffer.from(stripRouteLayer(mapSvg))],
    ["/assets/facade.webp", facade],
    ["/assets/listen.png", listen],
  ]);
}

async function render(url) {
  const work = await mkdtemp(join(tmpdir(), "otgolosok-kinetic-"));
  try {
    const bed = join(work, "bed.wav");
    await writeFile(bed, motionBedWav(musicScore()));
    const fadeOut = (VOICE.length - 0.3).toFixed(2);
    const delay = Math.round(VOICE.at * 1000);
    await renderVideo({
      url, width: WIDTH, height: HEIGHT, fps: FPS, frameCount: FRAME_COUNT, duration: DURATION, output: OUTPUT,
      audioInputs: ["-i", bed, "-ss", String(VOICE.from), "-t", String(VOICE.length), "-i", VOICE_FILE],
      audioFilter:
        `[2:a]aresample=48000,afade=t=in:d=0.08,afade=t=out:st=${fadeOut}:d=0.3,adelay=${delay}:all=1,volume=0.75[voice];` +
        `[1:a]aresample=48000,volume=0.6[bed];[bed][voice]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.7:level=disabled[audio]`,
    });
  } finally {
    await rm(work, {recursive: true, force: true});
  }
}

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  let server;
  try {
    const options = parseRenderArgs(process.argv.slice(2));
    const started = await serveScene(join(root, "video/kinetic"), await buildAssets());
    server = started.server;
    if (options.mode === "preview") {
      console.log(`Просмотр: ${started.url}?preview  (с момента: ?preview&t=7). Остановка — Ctrl+C.`);
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
