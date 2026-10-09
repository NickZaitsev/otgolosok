// Независимая проверка готовых локальных MP3 после синтеза.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { normalizeForSpeech } from "../../backend/text-normalizer.mjs";

const exec = promisify(execFile);
const here = import.meta.dirname;
const stories = JSON.parse(await readFile(join(here, "stories.json"), "utf8"));
const receiptPath = join(here, "audio-verification.json");
const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
const audioDir = resolve(receipt.audioDirectory);
assert.equal(receipt.complete, true);
assert.equal(receipt.items.length, stories.stops.length);
assert.equal(stories.stops.length, 12);
let total = 0;
for (const stop of stories.stops) {
  const item = receipt.items.find(candidate => candidate.order === stop.order && candidate.placeId === stop.placeId);
  assert.ok(item, `Нет записи остановки ${stop.order}`);
  const script = stop.paragraphs.map(p => p.text).join("\n\n");
  const sha = text => createHash("sha256").update(text).digest("hex");
  assert.equal(item.sourceTextSha256, sha(script), `Изменён рассказ ${stop.order}`);
  assert.equal(item.spokenTextSha256, sha(await normalizeForSpeech(script)), `Изменён текст синтеза ${stop.order}`);
  assert.deepEqual([item.provider, item.model, item.voice],
    ["elevenlabs", "eleven_v4", "9ivxhQ6xIsHd6R3Xc635"]);
  assert.ok(["JVYtLnrrrMG4dcGbtdAw", "8Hp7MfQf2HGTKtrxXvVj"].includes(item.actualVoiceId));
  const path = join(audioDir, `${item.sha256}.mp3`);
  const bytes = await readFile(path);
  assert.equal(bytes.length, item.bytes);
  assert.equal(sha(bytes), item.sha256);
  const { stdout } = await exec("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=codec_name",
    "-of", "json", path], { timeout: 10000 });
  const probe = JSON.parse(stdout);
  assert.ok(probe.streams.some(stream => stream.codec_name === "mp3"));
  const measured = Number(probe.format.duration);
  assert.ok(Math.abs(measured - item.durationSec) < 0.1, `Длительность ${stop.order}`);
  await exec("ffmpeg", ["-v", "error", "-i", path, "-f", "null", "-"], { timeout: 30000, maxBuffer: 10000 });
  item.measuredDurationSec = measured;
  total += measured;
}
assert.ok(total >= 900, `Аудио короче 15 минут: ${total.toFixed(2)} с`);
receipt.verifiedAt = new Date().toISOString();
receipt.measuredTotalDurationSec = total;
await writeFile(receiptPath, JSON.stringify(receipt, null, 2) + "\n");
console.log(`Проверены 12 MP3, ${total.toFixed(2)} с`);
