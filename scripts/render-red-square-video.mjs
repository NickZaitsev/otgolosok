// Рендер рекламного ролика «Красная площадь и Варварка» без Remotion: страница video/red-square/
// рисует любой кадр функцией seek(t), кадры снимает scripts/lib/frame-render.mjs.
// Данные прогулки — video/red-square/walk.json (обновляются scripts/fetch-red-square-walk.mjs).
//
//   node scripts/render-red-square-video.mjs                    — полный рендер
//   node scripts/render-red-square-video.mjs --preview          — живой просмотр в браузере
//   node scripts/render-red-square-video.mjs --stills 1.5,8,14  — отдельные кадры в PNG
// Озвучка сцены player — video/red-square/voice/ (начитывает scripts/build-red-square-voice.mjs).
import {mkdtemp, readFile, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {redSquareWav} from "./red-square-music.mjs";
import {parseRenderArgs, renderStills, renderVideo, run, serveScene} from "./lib/frame-render.mjs";
import {speechBounds, voiceLevels} from "./lib/voice-audio.mjs";
import {DURATION, FACTS, FPS, FRAME_COUNT, HEIGHT, PLAYER, WIDTH, musicScore, scene, voiceSchedule} from "../video/red-square/timeline.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCENE_DIR = join(root, "video/red-square");
const OUTPUT = join(root, "artifacts/video/otgolosok-red-square.mp4");
const STILLS = join(root, "artifacts/video/red-square-stills");
const VOICE_DIR = join(SCENE_DIR, "voice");
/** Частота дорожки голоса: такая же, как у музыки, чтобы не пересэмплировать дважды. */
const VOICE_RATE = 48000;
/** Сколько сцена player держится после последнего слова. */
const VOICE_TAIL = 0.8;

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
  const [title, ...lines] = PLAYER.narration;
  if (title.text !== walk.stops[PLAYER.stop].label) throw new Error(`Заголовок озвучки не совпадает с остановкой «${walk.stops[PLAYER.stop].label}»`);
  for (const line of lines) {
    if (!text(PLAYER.stop).includes(line.text)) throw new Error(`Фразы «${line.text}» нет в истории «${walk.stops[PLAYER.stop].label}»`);
  }
}

/**
 * Клипы озвучки есть на каждую реплику и начитаны по нынешнему тексту диктора.
 * @param {Record<string, {text: string}>} manifest
 */
export function checkVoice(manifest) {
  for (const {id, speech} of PLAYER.narration) {
    const clip = manifest[id];
    if (!clip) throw new Error(`Нет клипа озвучки «${id}» — запустите pnpm video:voice:red-square`);
    if (clip.text !== speech) throw new Error(`Клип «${id}» начитан по старому тексту — запустите pnpm video:voice:red-square`);
  }
}

/** Запас вокруг найденной речи: мягкая атака и затухание последнего звука тише порога. */
const SPEECH_PAD_IN = 0.05;
const SPEECH_PAD_OUT = 0.15;
/** Короткое затухание на краях обрезки, чтобы не было щелчка. */
const EDGE_FADE = 0.01;

/**
 * Дорожка голоса на весь ролик. Из каждого клипа берётся только речь с запасом по краям:
 * тишина и щелчки в начале и хвосте клипов TTS длиннее паузы между фразами, и при
 * наложении целых клипов тишина следующего затирала конец предыдущей фразы.
 * @param {{at: number, from: number, to: number}[]} schedule секунды от начала сцены player
 * @param {Buffer[]} clips моно s16le, в порядке расписания
 */
export function voiceTrack(schedule, clips, {offset, seconds, sampleRate}) {
  const total = Math.round(seconds * sampleRate);
  const track = Buffer.alloc(total * 2);
  const fade = Math.max(1, Math.round(EDGE_FADE * sampleRate));
  let busyUntil = 0;
  schedule.forEach(({at, from, to}, index) => {
    const clip = clips[index];
    const clipStart = Math.round((offset + at) * sampleRate);
    const start = Math.max(clipStart, Math.round((offset + from - SPEECH_PAD_IN) * sampleRate));
    const end = Math.min(clipStart + clip.length / 2, Math.round((offset + to + SPEECH_PAD_OUT) * sampleRate));
    if (end > total) throw new RangeError("Клип озвучки выходит за конец ролика");
    if (start < busyUntil) throw new RangeError("Фразы озвучки накладываются друг на друга");
    for (let sample = start; sample < end; sample += 1) {
      const gain = Math.min(1, (sample - start + 1) / fade, (end - sample) / fade);
      track.writeInt16LE(Math.round(clip.readInt16LE((sample - clipStart) * 2) * gain), sample * 2);
    }
    busyUntil = end;
  });
  return track;
}

/** Голос сцены player: расписание клипов, громкость по кадрам и дорожка PCM на весь ролик. */
export async function loadVoice() {
  const manifest = JSON.parse(await readFile(join(VOICE_DIR, "manifest.json"), "utf8"));
  checkVoice(manifest);
  const clips = await Promise.all(PLAYER.narration.map(({id}) => run("ffmpeg", ["-v", "error", "-i", join(VOICE_DIR, `${id}.mp3`), "-ac", "1", "-ar", String(VOICE_RATE), "-f", "s16le", "-"])));
  const schedule = voiceSchedule(PLAYER.narration.map(({id}, index) => {
    const {start, end} = speechBounds(clips[index], VOICE_RATE);
    return {id, lead: start, speech: end - start};
  }));
  const player = scene("player");
  const length = player.end - player.start;
  const last = schedule.at(-1);
  if (last.to + VOICE_TAIL > length) throw new Error(`Озвучка длится до ${last.to.toFixed(2)} с сцены, а сцена — ${length} с: удлините player в timeline.mjs`);
  const track = voiceTrack(schedule, clips, {offset: player.start, seconds: DURATION, sampleRate: VOICE_RATE});
  const levels = voiceLevels(track.subarray(Math.round(player.start * VOICE_RATE) * 2, Math.round(player.end * VOICE_RATE) * 2), VOICE_RATE, {fps: FPS, seconds: length});
  return {schedule, levels, track};
}

async function render(url, voice) {
  const work = await mkdtemp(join(tmpdir(), "otgolosok-red-square-"));
  try {
    const bed = join(work, "bed.wav");
    const speech = join(work, "voice.pcm");
    await writeFile(bed, redSquareWav(musicScore()));
    await writeFile(speech, voice.track);
    await renderVideo({
      url, width: WIDTH, height: HEIGHT, fps: FPS, frameCount: FRAME_COUNT, duration: DURATION, output: OUTPUT,
      audioInputs: ["-i", bed, "-f", "s16le", "-ar", String(VOICE_RATE), "-ac", "1", "-i", speech],
      audioFilter: "[1:a]aresample=48000,volume=0.7[bed];[2:a]pan=stereo|c0=c0|c1=c0[voice];"
        + "[bed][voice]amix=inputs=2:normalize=0:duration=first,alimiter=limit=0.85:level=disabled[audio]",
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
    const voice = await loadVoice();
    const started = await serveScene(SCENE_DIR, new Map([["/voice.json", Buffer.from(JSON.stringify({schedule: voice.schedule, levels: voice.levels}))]]));
    server = started.server;
    if (options.mode === "preview") {
      console.log(`Просмотр: ${started.url}?preview  (с момента: ?preview&t=12). Остановка — Ctrl+C.`);
    } else {
      if (options.mode === "stills") await renderStills({url: started.url, width: WIDTH, height: HEIGHT, duration: DURATION, dir: STILLS, times: options.times});
      else await render(started.url, voice);
      server.close();
    }
  } catch (error) {
    console.error("\nНе удалось отрендерить ролик:", error instanceof Error ? error.message : String(error));
    server?.close();
    process.exitCode = 1;
  }
}
