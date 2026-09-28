// Рендер кинетического ролика без Remotion: страница video/kinetic/ рисует любой
// кадр функцией seek(t), Playwright снимает кадры, ffmpeg собирает MP4 с музыкой.
//
//   node scripts/render-kinetic-video.mjs              — полный рендер
//   node scripts/render-kinetic-video.mjs --preview    — живой просмотр в браузере
//   node scripts/render-kinetic-video.mjs --stills 1.5,8,14  — отдельные кадры в PNG
import {spawn} from "node:child_process";
import {createServer} from "node:http";
import {mkdir, mkdtemp, readFile, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {dirname, extname, join, relative, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {chromium} from "@playwright/test";
import {motionBedWav} from "./build-motion-audio.mjs";
import {stripRouteLayer} from "./prepare-video-assets.mjs";
import {DURATION, FPS, FRAME_COUNT, HEIGHT, VOICE, WIDTH, frameTime, musicScore} from "../video/kinetic/timeline.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT = join(root, "artifacts/video/otgolosok-kinetic.mp4");
const STILLS = join(root, "artifacts/video/kinetic-stills");
const VOICE_FILE = join(root, "public/audio/walk/kozhevniki-d2ccb2df8e45.mp3");

const TYPES = {".html": "text/html; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp", ".woff2": "font/woff2", ".woff": "font/woff"};

/**
 * Запускает процесс и собирает stdout; ошибка содержит хвост stderr.
 * @returns {Promise<Buffer>}
 */
function run(command, args, {input} = {}) {
  return new Promise((done, fail) => {
    const child = spawn(command, args, {stdio: [input ? "pipe" : "ignore", "pipe", "pipe"]});
    const out = [];
    let errors = "";
    child.stdout.on("data", (chunk) => out.push(chunk));
    child.stderr.on("data", (chunk) => { errors = (errors + chunk).slice(-4000); });
    child.on("error", (error) => fail(new Error(`Не удалось запустить ${command}: ${error.message}`)));
    child.on("close", (code) => (code === 0 ? done(Buffer.concat(out)) : fail(new Error(`${command} завершился с кодом ${code}: ${errors.trim()}`))));
    if (input) child.stdin.end(input);
  });
}

/**
 * Громкость фрагмента озвучки по кадрам, 0…1, для эквалайзера в сцене прослушивания.
 * @param {Buffer} pcm моно s16le
 */
export function voiceLevels(pcm, sampleRate, {fps = FPS, seconds}) {
  const perFrame = Math.round(sampleRate / fps);
  const frames = Math.round(seconds * fps);
  const rms = Array.from({length: frames}, (_, frame) => {
    let sum = 0;
    let count = 0;
    for (let index = frame * perFrame; index < (frame + 1) * perFrame && index * 2 + 1 < pcm.length; index += 1) {
      const sample = pcm.readInt16LE(index * 2) / 32768;
      sum += sample * sample;
      count += 1;
    }
    return count ? Math.sqrt(sum / count) : 0;
  });
  const peak = Math.max(...rms);
  if (!(peak > 0)) throw new Error("Фрагмент озвучки беззвучен");
  return rms.map((value) => Number(Math.sqrt(value / peak).toFixed(3)));
}

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

/** Раздаёт страницу сцены, общий таймлайн, шрифты @fontsource и подготовленные материалы. */
async function serve(assets) {
  const sceneDir = join(root, "video/kinetic");
  const fontDir = join(root, "node_modules/@fontsource");
  const server = createServer(async (request, response) => {
    const path = decodeURIComponent(new URL(request.url ?? "/", "http://local").pathname);
    try {
      let body = assets.get(path);
      if (!body) {
        const [base, rest] = path.startsWith("/fonts/") ? [fontDir, path.slice(7)] : [sceneDir, path === "/" ? "index.html" : path.slice(1)];
        const file = resolve(base, rest);
        if (relative(base, file).startsWith("..")) throw Object.assign(new Error("forbidden"), {code: "ENOENT"});
        body = await readFile(file);
      }
      response.writeHead(200, {"content-type": TYPES[extname(path)] ?? (path === "/" ? TYPES[".html"] : "application/octet-stream"), "cache-control": "no-store"});
      response.end(body);
    } catch (error) {
      response.writeHead(error?.code === "ENOENT" ? 404 : 500).end();
    }
  });
  await new Promise((done, fail) => server.once("error", fail).listen(0, "127.0.0.1", done));
  const {port} = /** @type {import("node:net").AddressInfo} */ (server.address());
  return {server, url: `http://127.0.0.1:${port}/`};
}

async function openScene(url) {
  const browser = await chromium.launch();
  const page = await browser.newPage({viewport: {width: WIDTH, height: HEIGHT}, deviceScaleFactor: 1});
  const problems = [];
  page.on("pageerror", (error) => problems.push(error.message));
  page.on("requestfailed", (request) => problems.push(`${request.url()}: ${request.failure()?.errorText}`));
  page.on("response", (response) => { if (response.status() >= 400) problems.push(`${response.url()}: ${response.status()}`); });
  await page.goto(url);
  try {
    await page.waitForFunction(() => window.kinetic, null, {timeout: 15000});
    await page.evaluate(() => window.kinetic.ready);
  } catch (error) {
    await browser.close();
    throw new Error(`Сцена не загрузилась: ${[...problems, error.message].join("; ")}`);
  }
  if (problems.length) {
    await browser.close();
    throw new Error(`Ошибки сцены: ${problems.join("; ")}`);
  }
  return {browser, page};
}

async function shoot(page, time) {
  await page.evaluate((t) => window.kinetic.seek(t), time);
  return page.screenshot({type: "png", animations: "disabled", caret: "hide"});
}

async function renderStills(url, times) {
  const {browser, page} = await openScene(url);
  try {
    await mkdir(STILLS, {recursive: true});
    for (const time of times) {
      if (!(time >= 0 && time < DURATION)) throw new RangeError(`Время кадра вне ролика: ${time}`);
      const file = join(STILLS, `t${time.toFixed(2)}.png`);
      await writeFile(file, await shoot(page, time));
      console.log(file);
    }
  } finally {
    await browser.close();
  }
}

async function renderVideo(url) {
  const work = await mkdtemp(join(tmpdir(), "otgolosok-kinetic-"));
  const {browser, page} = await openScene(url);
  let ffmpeg;
  try {
    const bed = join(work, "bed.wav");
    await writeFile(bed, motionBedWav(musicScore()));
    await mkdir(dirname(OUTPUT), {recursive: true});
    const fadeOut = (VOICE.length - 0.3).toFixed(2);
    const delay = Math.round(VOICE.at * 1000);
    ffmpeg = spawn("ffmpeg", [
      "-v", "error", "-y",
      "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "png", "-i", "-",
      "-i", bed,
      "-ss", String(VOICE.from), "-t", String(VOICE.length), "-i", VOICE_FILE,
      "-filter_complex",
      `[2:a]aresample=48000,afade=t=in:d=0.08,afade=t=out:st=${fadeOut}:d=0.3,adelay=${delay}:all=1,volume=0.75[voice];` +
      `[1:a]aresample=48000,volume=0.6[bed];[bed][voice]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.7:level=disabled[audio]`,
      "-map", "0:v", "-map", "[audio]",
      "-c:v", "libx264", "-preset", "slow", "-crf", "16", "-pix_fmt", "yuv420p", "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709",
      "-c:a", "aac", "-b:a", "192k", "-t", String(DURATION), "-movflags", "+faststart",
      OUTPUT,
    ], {stdio: ["pipe", "ignore", "pipe"]});
    let errors = "";
    ffmpeg.stderr.on("data", (chunk) => { errors = (errors + chunk).slice(-4000); });
    const finished = new Promise((done, fail) => {
      ffmpeg.on("error", (error) => fail(new Error(`Не удалось запустить ffmpeg: ${error.message}`)));
      ffmpeg.on("close", (code) => (code === 0 ? done() : fail(new Error(`ffmpeg завершился с кодом ${code}: ${errors.trim()}`))));
    });
    // Ранний отказ ffmpeg не должен оставить цикл кадров писать в закрытую трубу.
    let failure;
    finished.catch((error) => { failure = error; });

    const began = Date.now();
    for (let frame = 0; frame < FRAME_COUNT; frame += 1) {
      if (failure) throw failure;
      const image = await shoot(page, frameTime(frame));
      if (!ffmpeg.stdin.write(image)) await new Promise((done) => ffmpeg.stdin.once("drain", done));
      if (frame % FPS === 0 || frame === FRAME_COUNT - 1) {
        process.stdout.write(`\rКадр ${frame + 1}/${FRAME_COUNT} · ${((Date.now() - began) / 1000).toFixed(0)} с`);
      }
    }
    ffmpeg.stdin.end();
    await finished;
    process.stdout.write(`\nГотово: ${OUTPUT}\n`);
  } catch (error) {
    ffmpeg?.kill();
    throw error;
  } finally {
    await browser.close();
    await rm(work, {recursive: true, force: true});
  }
}

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  const args = process.argv.slice(2);
  let server;
  try {
    const started = await serve(await buildAssets());
    server = started.server;
    if (args.includes("--preview")) {
      console.log(`Просмотр: ${started.url}?preview  (с момента: ?preview&t=7). Остановка — Ctrl+C.`);
    } else if (args.includes("--stills")) {
      const list = args[args.indexOf("--stills") + 1] ?? "";
      await renderStills(started.url, list.split(",").filter(Boolean).map(Number));
      server.close();
    } else {
      await renderVideo(started.url);
      server.close();
    }
  } catch (error) {
    console.error("\nНе удалось отрендерить ролик:", error instanceof Error ? error.message : String(error));
    server?.close();
    process.exitCode = 1;
  }
}
