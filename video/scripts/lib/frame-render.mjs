// Покадровый рендер HTML-сцены без Remotion: локальный HTTP-сервер раздаёт
// страницу, шрифты @fontsource и подготовленные материалы, Playwright Chromium
// снимает PNG каждого кадра, FFmpeg собирает их со звуком в MP4.
//
// Страница обязана выставить `window.motionScene = {ready: Promise, seek(t)}`;
// всё движение — чистая функция времени, иначе кадры не будут воспроизводимы.
import {spawn} from "node:child_process";
import {createServer} from "node:http";
import {mkdir, readFile, writeFile} from "node:fs/promises";
import {dirname, extname, isAbsolute, join, relative, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {chromium} from "@playwright/test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

const TYPES = {".html": "text/html; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp", ".woff2": "font/woff2", ".woff": "font/woff"};

/**
 * Запускает процесс и собирает stdout; ошибка содержит хвост stderr.
 * @returns {Promise<Buffer>}
 */
export function run(command, args, {input} = {}) {
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
 * Путь запроса → файл: `/fonts/` из @fontsource, `/shared/` из video/shared,
 * остальное из папки сцены. Выход за пределы папки запрещён.
 * @returns {string | null}
 */
export function resolveScenePath(sceneDir, path) {
  const bases = [["/fonts/", join(root, "video/node_modules/@fontsource")], ["/shared/", join(root, "video/shared")]];
  const [prefix, base] = bases.find(([start]) => path.startsWith(start)) ?? ["/", sceneDir];
  const rest = path === "/" ? "index.html" : path.slice(prefix.length);
  const file = resolve(base, rest);
  const inside = relative(base, file);
  return inside && !inside.startsWith("..") && !isAbsolute(inside) ? file : null;
}

/**
 * Раздаёт сцену на свободном порту 127.0.0.1.
 * @param {string} sceneDir
 * @param {Map<string, Buffer>} assets — подготовленные в памяти файлы по путям запроса
 */
export async function serveScene(sceneDir, assets) {
  const server = createServer(async (request, response) => {
    const path = decodeURIComponent(new URL(request.url ?? "/", "http://local").pathname);
    try {
      let body = assets.get(path);
      if (!body) {
        const file = resolveScenePath(sceneDir, path);
        if (!file) throw Object.assign(new Error("forbidden"), {code: "ENOENT"});
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

/** Открывает сцену; любая ошибка страницы или 4xx/5xx ресурса останавливает рендер. */
async function openScene(url, {width, height}) {
  const browser = await chromium.launch();
  const page = await browser.newPage({viewport: {width, height}, deviceScaleFactor: 1});
  const problems = [];
  page.on("pageerror", (error) => problems.push(error.message));
  page.on("requestfailed", (request) => problems.push(`${request.url()}: ${request.failure()?.errorText}`));
  page.on("response", (response) => { if (response.status() >= 400) problems.push(`${response.url()}: ${response.status()}`); });
  await page.goto(url);
  try {
    await page.waitForFunction(() => window.motionScene, null, {timeout: 15000});
    await page.evaluate(() => window.motionScene.ready);
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
  await page.evaluate((t) => window.motionScene.seek(t), time);
  return page.screenshot({type: "png", animations: "disabled", caret: "hide"});
}

/**
 * Отдельные кадры в PNG.
 * @param {{url: string, width: number, height: number, duration: number, dir: string, times: number[]}} options
 */
export async function renderStills({url, width, height, duration, dir, times}) {
  const {browser, page} = await openScene(url, {width, height});
  try {
    await mkdir(dir, {recursive: true});
    for (const time of times) {
      if (!(time >= 0 && time < duration)) throw new RangeError(`Время кадра вне ролика: ${time}`);
      const file = join(dir, `t${time.toFixed(2)}.png`);
      await writeFile(file, await shoot(page, time));
      console.log(file);
    }
  } finally {
    await browser.close();
  }
}

/**
 * Полный рендер в MP4 (h264 + AAC).
 * @param {{url: string, width: number, height: number, fps: number, frameCount: number, duration: number, output: string,
 *   audioInputs: string[], audioFilter: string}} options
 *   audioInputs — аргументы ffmpeg для звуковых входов (нумерация с 1), audioFilter —
 *   filter_complex, который выдаёт метку [audio].
 */
export async function renderVideo({url, width, height, fps, frameCount, duration, output, audioInputs, audioFilter}) {
  const {browser, page} = await openScene(url, {width, height});
  let ffmpeg;
  try {
    await mkdir(dirname(output), {recursive: true});
    ffmpeg = spawn("ffmpeg", [
      "-v", "error", "-y",
      "-f", "image2pipe", "-framerate", String(fps), "-c:v", "png", "-i", "-",
      ...audioInputs,
      "-filter_complex", audioFilter,
      "-map", "0:v", "-map", "[audio]",
      "-c:v", "libx264", "-preset", "slow", "-crf", "16", "-pix_fmt", "yuv420p", "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709",
      "-c:a", "aac", "-b:a", "192k", "-t", String(duration), "-movflags", "+faststart",
      output,
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
    for (let frame = 0; frame < frameCount; frame += 1) {
      if (failure) throw failure;
      const image = await shoot(page, frame / fps);
      if (!ffmpeg.stdin.write(image)) await new Promise((done) => ffmpeg.stdin.once("drain", done));
      if (frame % fps === 0 || frame === frameCount - 1) {
        process.stdout.write(`\rКадр ${frame + 1}/${frameCount} · ${((Date.now() - began) / 1000).toFixed(0)} с`);
      }
    }
    ffmpeg.stdin.end();
    await finished;
    process.stdout.write(`\nГотово: ${output}\n`);
  } catch (error) {
    ffmpeg?.kill();
    throw error;
  } finally {
    await browser.close();
  }
}

/**
 * Разбор общих аргументов командной строки: --preview или --stills 1.5,8.
 * @returns {{mode: "preview"} | {mode: "stills", times: number[]} | {mode: "video"}}
 */
export function parseRenderArgs(args) {
  if (args.includes("--preview")) return {mode: "preview"};
  if (args.includes("--stills")) {
    const list = args[args.indexOf("--stills") + 1] ?? "";
    const times = list.split(",").filter(Boolean).map(Number);
    if (times.length === 0 || times.some((time) => !Number.isFinite(time))) throw new RangeError("После --stills нужен список секунд через запятую");
    return {mode: "stills", times};
  }
  return {mode: "video"};
}
