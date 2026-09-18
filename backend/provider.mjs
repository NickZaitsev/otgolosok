import { failure } from "./domain.mjs";

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

const transient = status => status === 429 || status >= 500;
async function fetchWithRetry(fetchImpl,url,options,signal) {
  let response;
  for(let attempt=0;attempt<3;attempt++){
    try{response=await fetchImpl(url,options);}catch(error){if(attempt===2||signal?.aborted)throw error;response=null;}
    if(response&&!transient(response.status))return response;
    if(response&&attempt===2)return response;
    if(response?.body)await response.body.cancel().catch(()=>{});
    const delay=Math.min(10000,1000*(2**attempt));
    await new Promise((resolve,reject)=>{const timer=setTimeout(resolve,delay);const abort=()=>{clearTimeout(timer);reject(signal.reason);};if(signal?.aborted)return abort();signal?.addEventListener('abort',abort,{once:true});});
  }
  return response;
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
    const res = await fetchWithRetry(fetchImpl,`${endpoint}/responses`, { method: "POST", headers, signal: deadline,
      body: JSON.stringify({ model: selectedModel, store: false, stream: false, input: prompt, max_output_tokens: maxTokens,
        ...(search ? { tools: [{type:"web_search"}], include:["web_search_call.action.sources"] } : {}) }) },deadline);
    if (!res.ok) { await res.body?.cancel(); throw failure(res.status === 429 ? "PROVIDER_BUSY" : "PROVIDER_FAILED"); }
    const payload = unpackResponse(await boundedBody(res, 2000000, deadline), res.headers.get("content-type") ?? "");
    if (payload.status !== "completed") throw failure("PROVIDER_INCOMPLETE");
    const parts = (payload.output ?? []).filter((item) => item.type === "message").flatMap((item) => item.content ?? []);
    const output = parts.filter((part) => part.type === "output_text").map((part) => part.text).join("\n");
    if (!output.trim()) throw failure("EMPTY_RESPONSE");
    const sources = new Map();
    const addSource = (url, title = "") => { if (typeof url === "string" && !sources.has(url)) sources.set(url,{url,title:typeof title === "string" ? title.slice(0,250) : ""}); };
    for (const item of parts.flatMap((part) => part.annotations ?? [])) addSource(item.url,item.title);
    for (const item of payload.output ?? []) {
      if (item.type !== "web_search_call") continue;
      addSource(item.action?.url,item.action?.title);
      for (const source of item.action?.sources ?? []) addSource(source.url,source.title);
    }
    if (search && !(payload.output ?? []).some((item) => item.type === "web_search_call")) throw failure("NO_SEARCH_EVIDENCE");
    return { text: output, sources: [...sources.values()], citedUrls: [...sources.keys()], usage: payload.usage ?? null, model: selectedModel };
  }
  async function speech(script, { signal, voice: selectedVoice = voice } = {}) {
    const deadline = AbortSignal.any([AbortSignal.timeout(150000), ...(signal ? [signal] : [])]);
    const res = await fetchImpl(`${endpoint}/audio/speech`, { method: "POST", headers, signal: deadline,
      body: JSON.stringify({model: ttsModel, voice:selectedVoice, input: script, response_format:"mp3", speed:1,
        instructions:"Read the supplied Russian text exactly, with no additions. Warm clear conversational Russian walking-tour narration, about 140 words per minute, brief pauses between paragraphs. No music or sound effects. Read dates and addresses naturally."}) });
    if (!res.ok || !res.headers.get("content-type")?.startsWith("audio/")) { await res.body?.cancel(); throw failure("TTS_FAILED"); }
    return boundedBody(res, 10000000, deadline);
  }
  return { response, speech, model, writerModel, ttsModel, voice };
}
