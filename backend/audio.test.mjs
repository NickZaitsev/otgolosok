import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createNarration } from "./audio.mjs";
import { sha256 } from "./domain.mjs";

const identityNormalizer = Object.assign(async text => text, { version: "test" });

test("audio cache isolates TTS providers even with matching model and voice", async t => {
  const directory = await mkdtemp(join(tmpdir(), "otgolosok-audio-cache-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const story = { paragraphs: [{ text: "Один и тот же рассказ." }] };
  const parameters = { script: story.paragraphs[0].text, model: "same-model", voice: "same-voice", version: 2, normalizer: "test" };
  const bytes = Buffer.from("previously validated audio asset");
  const hash = sha256(bytes);
  const metadata = { sha256: hash, url: `/api/story-audio/${hash}.mp3`, durationSec: 60 };
  await writeFile(join(directory, `${hash}.mp3`), bytes);
  await writeFile(join(directory, `${sha256(JSON.stringify(parameters))}.json`), JSON.stringify(metadata));
  const openai = { ttsModel: parameters.model, voice: parameters.voice,
    speech: async () => assert.fail("Legacy cache should avoid a paid request") };
  assert.deepEqual(await createNarration(story, openai, directory, undefined, { normalize: identityNormalizer }), metadata);
  let calls = 0;
  const yandex = { ...openai, ttsProvider: "yandex", speech: async () => { calls++; throw new Error("Yandex cache miss"); } };
  await assert.rejects(createNarration(story, yandex, directory, undefined, { normalize: identityNormalizer }), /Yandex cache miss/);
  assert.equal(calls, 1);
  const yandexMetadata = { ...metadata, provider: "yandex" };
  await writeFile(join(directory, `${sha256(JSON.stringify({ ...parameters, provider: "yandex" }))}.json`), JSON.stringify(yandexMetadata));
  assert.deepEqual(await createNarration(story, yandex, directory, undefined, { normalize: identityNormalizer }), yandexMetadata);
  assert.equal(calls, 1);
});

test("narration passes the selected voice to synthesis and never reuses another voice's cache", async t => {
  const directory = await mkdtemp(join(tmpdir(), "otgolosok-voice-cache-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const story = { paragraphs: [{ text: "Рассказ для выбранного голоса." }] };
  const bytes = Buffer.from("validated marina audio");
  const hash = sha256(bytes);
  const key = sha256(JSON.stringify({ script: story.paragraphs[0].text, model: "speechkit-v3", voice: "marina", version: 2, normalizer: "test", provider: "yandex" }));
  const metadata = { sha256: hash, voice: "marina" };
  await writeFile(join(directory, `${hash}.mp3`), bytes);
  await writeFile(join(directory, `${key}.json`), JSON.stringify(metadata));
  let calls = 0;
  const provider = { ttsProvider: "yandex", ttsModel: "speechkit-v3", voice: "kirill", speech: async (script, { voice, signal }) => {
    calls++;
    assert.equal(script, story.paragraphs[0].text);
    assert.equal(voice, "kirill");
    assert.ok(signal instanceof AbortSignal);
    throw new Error("Selected voice reached synthesis");
  } };
  await assert.rejects(createNarration(story, provider, directory, new AbortController().signal, { normalize: identityNormalizer }), /Selected voice reached synthesis/);
  assert.equal(calls, 1);
  assert.deepEqual(await createNarration(story, { ...provider, voice: "marina" }, directory, undefined, { normalize: identityNormalizer }), metadata);
  assert.equal(calls, 1);
});

test("walk chapters accept shorter recordings without relaxing address narration limits", async t => {
  const directory = await mkdtemp(join(tmpdir(), "otgolosok-walk-audio-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const story = { paragraphs: [{ text: "Короткая глава прогулки." }] };
  const bytes = Buffer.from("validated short chapter audio");
  const hash = sha256(bytes);
  const metadata = { sha256: hash, durationSec: 30, url: `/api/story-audio/${hash}.mp3` };
  const provider = { voice: "marin", ttsModel: "test", speech: async () => { throw new Error("Outside address duration limits"); } };
  const key = sha256(JSON.stringify({ script: story.paragraphs[0].text, model: provider.ttsModel, voice: provider.voice, version: 2, normalizer: "test" }));
  await writeFile(join(directory, `${hash}.mp3`), bytes);
  await writeFile(join(directory, `${key}.json`), JSON.stringify(metadata));
  assert.deepEqual(await createNarration(story, provider, directory, undefined, { minDurationSec: 10, maxDurationSec: 300, normalize: identityNormalizer }), metadata);
  await assert.rejects(createNarration(story, provider, directory, undefined, { normalize: identityNormalizer }), /Outside address duration limits/);
  await assert.rejects(createNarration(story, provider, directory, undefined, { minDurationSec: 300, maxDurationSec: 10, normalize: identityNormalizer }), { code: "AUDIO_DURATION" });
});

test("narration sends ru-normalizr output to the speech provider", async t => {
  const directory = await mkdtemp(join(tmpdir(), "otgolosok-normalized-audio-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const story = { paragraphs: [{ text: "Глава IV начинается в 10:07." }] };
  const normalize = Object.assign(async (text, { signal }) => {
    assert.equal(text, story.paragraphs[0].text);
    assert.ok(signal instanceof AbortSignal);
    return "Глава четвёртая начинается в десять, ноль семь.";
  }, { version: "ru-normalizr-test" });
  const provider = { voice: "marin", ttsModel: "test", speech: async (script) => {
    assert.equal(script, "Глава четвёртая начинается в десять, ноль семь.");
    throw new Error("Normalized text reached synthesis");
  } };
  await assert.rejects(createNarration(story, provider, directory, new AbortController().signal, { normalize }), /Normalized text reached synthesis/);
});
