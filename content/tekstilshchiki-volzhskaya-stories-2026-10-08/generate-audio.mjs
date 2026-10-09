// Запуск: node --env-file=.env content/tekstilshchiki-volzhskaya-stories-2026-10-08/generate-audio.mjs
// Готовые MP3 хранятся в игнорируемой папке backend/data, квитанция — рядом с рассказами.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fetch } from "undici";
import { createNarration } from "../../backend/audio.mjs";
import { createElevenLabsTts, elevenLabsApiKeys, listElevenLabsVoices } from "../../backend/elevenlabs-tts.mjs";
import { normalizeForSpeech } from "../../backend/text-normalizer.mjs";

const here = import.meta.dirname;
const data = JSON.parse(await readFile(join(here, "stories.json"), "utf8"));
assert.equal(data.stops.length, 12);
const voiceId = "9ivxhQ6xIsHd6R3Xc635";
const keys = elevenLabsApiKeys(process.env);
const copyIds = ["JVYtLnrrrMG4dcGbtdAw", "8Hp7MfQf2HGTKtrxXvVj"];
assert.ok(keys.length >= 3, "Не настроены резервные аккаунты ElevenLabs");
for (const [index, key] of keys.entries()) {
  const expectedId = index === 0 ? voiceId : copyIds[index - 1];
  const voices = await listElevenLabsVoices({ apiKey: key.apiKey, fetchImpl: fetch });
  assert.ok(voices.some(item => item.id === expectedId && item.label.includes("Отголосок2")), `Голос Отголосок2 не подтверждён для аккаунта ${index + 1}`);
  if (index > 0) key.voice = expectedId;
}
// Основной аккаунт исчерпал лимит; используем подтверждённые копии голоса.
const usableKeys = keys.slice(1, 3);
let actualVoiceIds = [];
const trackedFetch = (url, options) => {
  if (options?.method === "POST" && String(url).includes("/text-to-speech/"))
    actualVoiceIds.push(decodeURIComponent(String(url).split("/text-to-speech/")[1].split("?")[0]));
  return fetch(url, options);
};
const tagNarration = Object.assign(async script => `[warmly] ${script}`, { version: "fixed-warmly-v1" });
const speech = createElevenLabsTts({ apiKeys: usableKeys, voice: voiceId, model: "eleven_v4", tagNarration, fetchImpl: trackedFetch });
const audioDir = resolve("backend/data/tekstilshchiki-volzhskaya-2026-10-08/audio");
await mkdir(audioDir, { recursive: true });
const receiptPath = join(here, "audio-verification.json");
let previousItems = [];
try { previousItems = JSON.parse(await readFile(receiptPath, "utf8")).items ?? []; }
catch (error) { if (error.code !== "ENOENT") throw error; }
const items = [];
for (const stop of data.stops) {
  const script = stop.paragraphs.map(p => p.text).join("\n\n");
  const spoken = await normalizeForSpeech(script);
  actualVoiceIds = [];
  const audio = await createNarration(stop, speech, audioDir, undefined, { minDurationSec: 30, maxDurationSec: 300 });
  assert.equal(audio.provider, "elevenlabs");
  assert.equal(audio.model, "eleven_v4");
  assert.equal(audio.voice, voiceId);
  const previous = previousItems.find(item => item.order === stop.order && item.placeId === stop.placeId
    && item.sha256 === audio.sha256 && item.sourceTextSha256 === createHash("sha256").update(script).digest("hex"));
  const actualVoiceId = actualVoiceIds.at(-1) ?? previous?.actualVoiceId ?? null;
  assert.ok(actualVoiceId && copyIds.includes(actualVoiceId), "Не установлено происхождение новой записи");
  const bytes = await readFile(join(audioDir, `${audio.sha256}.mp3`));
  assert.equal(createHash("sha256").update(bytes).digest("hex"), audio.sha256);
  assert.equal(bytes.length, audio.bytes);
  items.push({ order: stop.order, placeId: stop.placeId, title: stop.title,
    sourceTextSha256: createHash("sha256").update(script).digest("hex"),
    spokenTextSha256: createHash("sha256").update(spoken).digest("hex"), actualVoiceId, ...audio });
  const snapshot = [...items, ...previousItems.filter(previous => !items.some(item => item.order === previous.order))]
    .sort((a, b) => a.order - b.order);
  const currentItems = snapshot.filter(item => {
    const source = data.stops.find(stop => stop.order === item.order);
    return source && item.sourceTextSha256 === createHash("sha256")
      .update(source.paragraphs.map(p => p.text).join("\n\n")).digest("hex");
  });
  const receipt = { checkedAt: new Date().toISOString(), complete: currentItems.length === data.stops.length,
    audioDirectory: "backend/data/tekstilshchiki-volzhskaya-2026-10-08/audio",
    totalDurationSec: currentItems.reduce((sum, item) => sum + item.durationSec, 0), items: snapshot };
  const temporary = `${receiptPath}.tmp`;
  await writeFile(temporary, JSON.stringify(receipt, null, 2) + "\n");
  await rename(temporary, receiptPath);
  console.log(`${stop.order}/12 ${stop.title}: ${audio.durationSec.toFixed(2)} с`);
}
