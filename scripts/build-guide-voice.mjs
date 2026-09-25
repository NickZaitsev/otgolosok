// Озвучка видеоинструкции через HTTP API just-tts (F5-TTS).
// Готовые MP3 и manifest.json версионируются: рендер не зависит от TTS-сервера.
import {createHash} from "node:crypto";
import {execFile} from "node:child_process";
import {mkdir, readFile, rename, rm, writeFile} from "node:fs/promises";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {promisify} from "node:util";
import {createTtsApiClient} from "../backend/tts-api-client.mjs";

const run = promisify(execFile);
const wait = milliseconds => new Promise(done => setTimeout(done, milliseconds));

export const DEFAULT_PROFILE = "f5-ru-v1";

/** Ключ клипа меняется при смене текста или любой части голосового профиля. */
export function clipKey(text, profile) {
  const identity = [profile.id, profile.modelSha256, profile.configSha256, profile.referenceSha256, profile.preparationVersion, text];
  return createHash("sha256").update(JSON.stringify(identity)).digest("hex");
}

/** Повторяем только сетевые сбои, таймауты, 429 и 5xx. */
export function isTransient(error) {
  if (error?.transient) return true;
  const status = Number(error?.status);
  return status === 429 || status >= 500;
}

export async function withRetry(operation, {attempts = 5, baseDelayMs = 1000, sleep = wait} = {}) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (attempt >= attempts || !isTransient(error)) throw error;
      const retryAfter = Number(error?.retryAfter);
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : baseDelayMs * 2 ** (attempt - 1));
    }
  }
}

async function synthesize(client, profile, id, text, key, {pollMs = 2000, timeoutMs = 15 * 60_000} = {}) {
  const expected = {modelSha256: profile.modelSha256, configSha256: profile.configSha256, referenceSha256: profile.referenceSha256, preparationVersion: profile.preparationVersion};
  // Одинаковый requestId и тело возвращают то же задание — перезапуск скрипта безопасен.
  const created = await withRetry(() => client.create({requestId: `otgolosok-guide-${id}-${key.slice(0, 16)}`, profileId: profile.id, text, expected}));
  const deadline = Date.now() + timeoutMs;
  let job = await withRetry(() => client.get(created.id));
  while (!["succeeded", "failed", "expired"].includes(job.state)) {
    if (Date.now() > deadline) throw new Error(`Синтез «${id}» не завершился за ${timeoutMs / 60_000} мин`);
    await wait(pollMs);
    job = await withRetry(() => client.get(created.id));
  }
  if (job.state !== "succeeded") throw new Error(`Синтез «${id}» завершился состоянием ${job.state}${job.error?.code ? ` (${job.error.code})` : ""}`);
  const download = await withRetry(() => client.audio(created.id));
  const actual = createHash("sha256").update(download.bytes).digest("hex");
  if (actual !== download.sha256 || actual !== job.result?.sha256) throw new Error(`Контрольная сумма аудио «${id}» не совпала`);
  return {jobId: created.id, bytes: download.bytes, sha256: actual};
}

async function mediaDuration(root, path) {
  // ffprobe из поставки Remotion: отдельный FFmpeg в системе не нужен.
  const cli = join(root, "node_modules/@remotion/cli/remotion-cli.js");
  const {stdout} = await run(process.execPath, [cli, "ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", path]);
  const seconds = Number.parseFloat(stdout.trim());
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error(`Не удалось определить длительность ${path}`);
  return Math.round(seconds * 1000) / 1000;
}

/**
 * @typedef {{key: string, text: string, sha256: string, durationSeconds: number, profile: string, voice: string}} VoiceClip
 * @returns {Promise<Record<string, VoiceClip>>}
 */
export async function buildGuideVoice({root, client, profileId = DEFAULT_PROFILE, log = console.log}) {
  const narration = JSON.parse(await readFile(join(root, "src/video/guide-narration.json"), "utf8"));
  const voiceDir = join(root, "video/assets/guide/voice");
  const manifestPath = join(voiceDir, "manifest.json");
  let manifest = {};
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const profile = (await withRetry(() => client.profiles())).find(item => item.id === profileId);
  if (!profile) throw new Error(`Профиль ${profileId} недоступен на TTS-сервере`);
  await mkdir(voiceDir, {recursive: true});
  /** @type {Record<string, VoiceClip>} */
  const next = {};
  for (const [id, text] of Object.entries(narration)) {
    const key = clipKey(text, profile);
    const path = join(voiceDir, `${id}.mp3`);
    if (manifest[id]?.key === key) {
      try {
        const bytes = await readFile(path);
        if (createHash("sha256").update(bytes).digest("hex") === manifest[id].sha256) {
          next[id] = manifest[id];
          continue;
        }
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
    }
    log(`Озвучиваю «${id}»…`);
    const result = await synthesize(client, profile, id, text, key);
    await writeFile(`${path}.part`, result.bytes);
    await rename(`${path}.part`, path);
    next[id] = {key, text, sha256: result.sha256, durationSeconds: await mediaDuration(root, path), profile: profile.id, voice: profile.voice};
    // Подтверждаем приём только после надёжной записи файла.
    await withRetry(() => client.ack(result.jobId, result.sha256));
    await writeFile(manifestPath, JSON.stringify({...manifest, ...next}, null, 2) + "\n");
  }
  for (const id of Object.keys(manifest)) {
    if (!(id in next)) await rm(join(voiceDir, `${id}.mp3`), {force: true});
  }
  await writeFile(manifestPath, JSON.stringify(next, null, 2) + "\n");
  return next;
}

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  try {
    const client = createTtsApiClient({baseUrl: process.env.TTS_API_URL, token: process.env.TTS_API_TOKEN});
    await buildGuideVoice({root: resolve(dirname(scriptPath), ".."), client, profileId: process.env.GUIDE_TTS_PROFILE || DEFAULT_PROFILE});
  } catch (error) {
    console.error("Не удалось озвучить видеоинструкцию:", error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
