import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createNarration } from "./audio.mjs";
import { sha256 } from "./domain.mjs";

test("audio cache preserves legacy OpenAI hits and isolates Yandex even with matching model and voice", async t => {
  const directory = await mkdtemp(join(tmpdir(), "otgolosok-audio-cache-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const story = { paragraphs: [{ text: "Один и тот же рассказ." }] };
  const parameters = { script: story.paragraphs[0].text, model: "same-model", voice: "same-voice", version: 1 };
  const bytes = Buffer.from("previously validated audio asset");
  const hash = sha256(bytes);
  const metadata = { sha256: hash, url: `/api/story-audio/${hash}.mp3`, durationSec: 60 };
  await writeFile(join(directory, `${hash}.mp3`), bytes);
  await writeFile(join(directory, `${sha256(JSON.stringify(parameters))}.json`), JSON.stringify(metadata));
  const openai = { ttsModel: parameters.model, voice: parameters.voice,
    speech: async () => assert.fail("Legacy cache should avoid a paid request") };
  assert.deepEqual(await createNarration(story, openai, directory), metadata);
  let calls = 0;
  const yandex = { ...openai, ttsProvider: "yandex", speech: async () => { calls++; throw new Error("Yandex cache miss"); } };
  await assert.rejects(createNarration(story, yandex, directory), /Yandex cache miss/);
  assert.equal(calls, 1);
  const yandexMetadata = { ...metadata, provider: "yandex" };
  await writeFile(join(directory, `${sha256(JSON.stringify({ ...parameters, provider: "yandex" }))}.json`), JSON.stringify(yandexMetadata));
  assert.deepEqual(await createNarration(story, yandex, directory), yandexMetadata);
  assert.equal(calls, 1);
});
