// Озвучка истории Собора Василия Блаженного для ролика «Красная площадь и Варварка»
// через HTTP API just-tts. Готовые MP3 и manifest.json версионируются в video/red-square/voice/,
// поэтому рендер не зависит от TTS-сервера. Нужны TTS_API_URL и TTS_API_TOKEN в .env.
import {dirname, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {createTtsApiClient} from "../backend/tts-api-client.mjs";
import {DEFAULT_PROFILE, buildGuideVoice} from "./build-guide-voice.mjs";
import {PLAYER} from "../video/red-square/timeline.mjs";

export const RED_SQUARE_VOICE = Object.freeze({
  name: "red-square",
  narration: Object.fromEntries(PLAYER.narration.map(({id, speech}) => [id, speech])),
  voiceDir: "video/red-square/voice",
});

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  try {
    const client = createTtsApiClient({baseUrl: process.env.TTS_API_URL, token: process.env.TTS_API_TOKEN});
    const manifest = await buildGuideVoice({
      root: resolve(dirname(scriptPath), ".."), client, profileId: process.env.GUIDE_TTS_PROFILE || DEFAULT_PROFILE, guide: RED_SQUARE_VOICE,
    });
    for (const [id, clip] of Object.entries(manifest)) console.log(`${id}: ${clip.durationSeconds} с`);
  } catch (error) {
    console.error("Не удалось озвучить ролик:", error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
