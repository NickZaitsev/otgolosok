import { failure } from "./domain.mjs";
import { boundedBody } from "./provider.mjs";

// SpeechKit v3 accepts up to 5,000 characters with automatic utterance splitting.
function splitText(script) {
  const chunks = [];
  let rest = script.trim();
  while (rest.length > 5000) {
    let end = rest.lastIndexOf("\n", 5000);
    if (end < 1) end = rest.lastIndexOf(" ", 5000);
    if (end < 1) throw failure("TTS_FAILED");
    chunks.push(rest.slice(0, end));
    rest = rest.slice(end).trimStart();
  }
  if (rest) chunks.push(rest);
  if (!chunks.length) throw failure("TTS_FAILED");
  return chunks;
}

function unpackAudio(bytes) {
  try {
    const chunks = [];
    for (const line of bytes.toString("utf8").split(/\r?\n/).filter(line => line.trim())) {
      const frame = JSON.parse(line);
      if (frame.error) throw new Error();
      const data = frame.result?.audioChunk?.data;
      if (typeof data !== "string" || !data.length || data.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) throw new Error();
      chunks.push(Buffer.from(data, "base64"));
    }
    if (!chunks.length) throw new Error();
    return Buffer.concat(chunks);
  } catch { throw failure("TTS_FAILED"); }
}

export function createYandexTts({ apiKey, voice = "marina", fetchImpl = fetch }) {
  if (typeof apiKey !== "string" || !apiKey.trim() || !/^[a-z][a-z0-9_-]{0,63}$/.test(voice)) throw failure("PROVIDER_CONFIG");
  async function speech(script, { signal, voice: selectedVoice = voice } = {}) {
    const deadline = AbortSignal.any([AbortSignal.timeout(150000), ...(signal ? [signal] : [])]);
    const chunks = [];
    let size = 0;
    for (const text of splitText(script)) {
      deadline.throwIfAborted();
      const res = await fetchImpl("https://tts.api.cloud.yandex.net/tts/v3/utteranceSynthesis", {
        method: "POST", redirect: "error", signal: deadline,
        headers: { Authorization: `Api-Key ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ text, hints: [{ voice: selectedVoice }, { speed: 1 }], unsafeMode: true,
          outputAudioSpec: { containerAudio: { containerAudioType: "MP3" } } }),
      });
      if (!res.ok) { await res.body?.cancel(); throw failure("TTS_FAILED"); }
      const audio = unpackAudio(await boundedBody(res, 15000000, deadline));
      size += audio.length;
      if (size > 10000000) throw failure("RESPONSE_TOO_LARGE");
      chunks.push(audio);
    }
    return Buffer.concat(chunks);
  }
  return { speech, ttsProvider: "yandex", ttsModel: "speechkit-v3", voice };
}
