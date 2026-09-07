import { failure, parseModelJson } from "./domain.mjs";

export async function boundedBody(response, maximum, signal) {
  if (Number(response.headers.get("content-length")) > maximum) {
    await response.body?.cancel();
    throw failure("RESPONSE_TOO_LARGE");
  }
  if (!response.body) throw failure("EMPTY_RESPONSE");
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      signal?.throwIfAborted();
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximum) throw failure("RESPONSE_TOO_LARGE");
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  return Buffer.concat(chunks);
}

export function unpackResponse(bytes, contentType) {
  const text = bytes.toString("utf8");
  if (!contentType.includes("text/event-stream")) return JSON.parse(text);
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith("data:") || line.slice(5).trim() === "[DONE]") continue;
    const event = JSON.parse(line.slice(5));
    if (event.type === "response.completed") return event.response;
    if (["error", "response.failed", "response.incomplete"].includes(event.type)) throw failure("PROVIDER_FAILED");
  }
  throw failure("PROVIDER_INCOMPLETE");
}

export function createProvider({ baseUrl, apiKey, model = "codex/gpt-5.6-sol-medium", writerModel = "codex/gpt-5.6-sol-low", ttsModel = "gpt-4o-mini-tts", voice = "marin", fetchImpl = fetch }) {
  const base = new URL(baseUrl);
  if (base.protocol !== "https:" || !apiKey || base.username || base.password) throw failure("PROVIDER_CONFIG");
  const endpoint = base.href.replace(/\/$/, "");
  const headers = { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };
  async function response(prompt, { search = false, signal, timeoutMs = 90000, maxTokens = 4500, model: selectedModel = model } = {}) {
    const deadline = AbortSignal.any([AbortSignal.timeout(timeoutMs), ...(signal ? [signal] : [])]);
    const res = await fetchImpl(`${endpoint}/responses`, { method: "POST", headers, signal: deadline,
      body: JSON.stringify({ model: selectedModel, store: false, stream: false, input: prompt, max_output_tokens: maxTokens,
        ...(search ? { tools: [{type:"web_search"}], include:["web_search_call.action.sources"] } : {}) }) });
    if (!res.ok) { await res.body?.cancel(); throw failure(res.status === 429 ? "PROVIDER_BUSY" : "PROVIDER_FAILED"); }
    const payload = unpackResponse(await boundedBody(res, 2000000, deadline), res.headers.get("content-type") ?? "");
    if (payload.status !== "completed") throw failure("PROVIDER_INCOMPLETE");
    const parts = (payload.output ?? []).filter((item) => item.type === "message").flatMap((item) => item.content ?? []);
    const output = parts.filter((part) => part.type === "output_text").map((part) => part.text).join("\n");
    const citedUrls = new Set(parts.flatMap((part) => part.annotations ?? []).map((item) => item.url).filter(Boolean));
    for (const item of payload.output ?? []) {
      if (item.type !== "web_search_call") continue;
      if (item.action?.url) citedUrls.add(item.action.url);
      for (const source of item.action?.sources ?? []) if (source.url) citedUrls.add(source.url);
    }
    if (search && !(payload.output ?? []).some((item) => item.type === "web_search_call")) throw failure("NO_SEARCH_EVIDENCE");
    return { value: parseModelJson(output), citedUrls: [...citedUrls], usage: payload.usage ?? null, model: selectedModel };
  }
  async function speech(script, { signal } = {}) {
    const deadline = AbortSignal.any([AbortSignal.timeout(150000), ...(signal ? [signal] : [])]);
    const res = await fetchImpl(`${endpoint}/audio/speech`, { method: "POST", headers, signal: deadline,
      body: JSON.stringify({model: ttsModel, voice, input: script, response_format:"mp3", speed:1,
        instructions:"Read the supplied Russian text exactly, with no additions. Warm clear conversational Russian walking-tour narration, about 140 words per minute, brief pauses between paragraphs. No music or sound effects. Read dates and addresses naturally."}) });
    if (!res.ok || !res.headers.get("content-type")?.startsWith("audio/")) { await res.body?.cancel(); throw failure("TTS_FAILED"); }
    return boundedBody(res, 10000000, deadline);
  }
  return { response, speech, model, writerModel, ttsModel, voice };
}
