import test from "node:test";
import assert from "node:assert/strict";
import { createYandexTts } from "./yandex-tts.mjs";

const frame = data => JSON.stringify({ result: { audioChunk: { data: Buffer.from(data).toString("base64") } } });

test("Yandex sends Russian text and MP3 options with server-side API-key auth and joins streamed chunks", async () => {
  const script = "История московского дома.\n\nЗдесь жил архитектор.";
  const provider = createYandexTts({ apiKey: "private-key", fetchImpl: async (url, options) => {
    assert.equal(url, "https://tts.api.cloud.yandex.net/tts/v3/utteranceSynthesis");
    assert.equal(options.headers.Authorization, "Api-Key private-key");
    assert.equal(options.headers["x-folder-id"], undefined);
    assert.equal(options.redirect, "error");
    assert.equal(options.method, "POST");
    assert.deepEqual(JSON.parse(options.body), { text: script, hints: [{ voice: "marina" }, { speed: 1 }],
      unsafeMode: true, outputAudioSpec: { containerAudio: { containerAudioType: "MP3" } } });
    // Transport chunks need not align with JSON records.
    const bytes = Buffer.from(frame("first") + "\r\n" + frame("second") + "\n");
    return new Response(new ReadableStream({ start(controller) {
      controller.enqueue(bytes.subarray(0, 23)); controller.enqueue(bytes.subarray(23)); controller.close();
    } }));
  } });
  assert.equal((await provider.speech(script)).toString(), "firstsecond");
  assert.equal(provider.ttsProvider, "yandex");
  assert.equal(provider.ttsModel, "speechkit-v3");
  assert.equal(JSON.stringify(provider).includes("private-key"), false);
});

test("long texts split at whitespace within the 5000-character limit without losing words", async () => {
  const texts = [];
  const script = ("Первый абзац. ".repeat(360) + "\n\n" + "Второй абзац. ".repeat(420)).trim();
  const provider = createYandexTts({ apiKey: "key", voice: "ermil", fetchImpl: async (_url, options) => {
    const body = JSON.parse(options.body);
    texts.push(body.text);
    assert.equal(body.hints[0].voice, "ermil");
    return new Response(frame(String(texts.length)));
  } });
  const audio = await provider.speech(script);
  assert.ok(texts.length > 1);
  assert.ok(texts.every(text => text.length <= 5000 && text.length > 0));
  assert.equal(texts.join(" ").split(/\s+/).join(" "), script.split(/\s+/).join(" "));
  assert.equal(audio.toString(), texts.map((_, i) => i + 1).join(""));
});

test("provider failures, malformed streams and partial audio are rejected without exposing details", async () => {
  for (const response of [
    () => new Response("private provider error", { status: 403 }),
    () => new Response(""),
    () => new Response("not json"),
    () => new Response(JSON.stringify({ result: { audioChunk: { data: "%%%!" } } })),
    () => new Response(JSON.stringify({ result: { audioChunk: { data: "" } } })),
    () => new Response(frame("partial") + "\n" + JSON.stringify({ error: { message: "private provider error" } })),
    () => new Response(frame("partial") + "\n{truncated"),
  ]) {
    const provider = createYandexTts({ apiKey: "key", fetchImpl: async () => response() });
    await assert.rejects(provider.speech("Текст"), error => error.code === "TTS_FAILED" && !error.message.includes("private"));
  }
});

test("Yandex respects response limits and cancellation", async () => {
  let cancelled = false;
  const provider = createYandexTts({ apiKey: "key", fetchImpl: async () => new Response(new ReadableStream({
    cancel() { cancelled = true; },
  }), { headers: { "content-length": "15000001" } }) });
  await assert.rejects(provider.speech("Текст"), { code: "RESPONSE_TOO_LARGE" });
  assert.equal(cancelled, true);
  const aborted = createYandexTts({ apiKey: "key", fetchImpl: async () => { assert.fail("Must not send cancelled request"); } });
  await assert.rejects(aborted.speech("Текст", { signal: AbortSignal.abort() }), { name: "AbortError" });
});

test("invalid config and empty text never issue requests", async () => {
  assert.throws(() => createYandexTts({ apiKey: " " }), { code: "PROVIDER_CONFIG" });
  assert.throws(() => createYandexTts({ apiKey: "key", voice: "bad\nvoice" }), { code: "PROVIDER_CONFIG" });
  const provider = createYandexTts({ apiKey: "key", fetchImpl: async () => { assert.fail("Unexpected request"); } });
  await assert.rejects(provider.speech("  "), { code: "TTS_FAILED" });
});
