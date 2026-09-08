import { failure, pageText, validateFacts, validateDraft } from "./domain.mjs";
import { validateSourceUrl, fetchSource } from "./safe-fetch.mjs";
import { researchPrompt, factsPrompt, draftPrompt, reviewPrompt } from "./prompts.mjs";
import { createNarration } from "./audio.mjs";
import { runWalkNarrationJob } from "./walk-admin.mjs";

function canonicalUrl(raw) {
  const url = validateSourceUrl(raw);
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) if (key.startsWith("utm_")) url.searchParams.delete(key);
  return url.href;
}

function researchSources(research) {
  if (!Array.isArray(research.value.sources)) throw failure("INVALID_MODEL_OUTPUT");
  const cited = new Set(research.citedUrls.flatMap((url) => {try{return [canonicalUrl(url)];}catch{return [];}}));
  const seen = new Set();
  return research.value.sources.slice(0,5).flatMap((source) => {
    try {
      const url = canonicalUrl(source.url);
      if(!cited.has(url)||seen.has(url)||typeof source.title!=="string"||!source.title.trim())return [];
      seen.add(url);return [{url,title:source.title.slice(0,250)}];
    } catch{return [];}
  });
}

export const errorMessages = {
  INVALID_ADDRESS: "Укажите улицу и номер дома в Москве, включая строение, если оно есть.",
  QUEUE_FULL: "Сейчас готовятся другие истории. Попробуйте через несколько минут.",
  DAILY_LIMIT: "На сегодня лимит новых историй исчерпан. Готовые записи доступны.",
  RETRY_LIMIT: "Попытки подготовки закончились. Готовый текст остаётся доступным.",
  CONFLICT: "Задание уже изменилось. Обновите его состояние.",
  ADDRESS_UNCLEAR: "Источники не позволяют однозначно определить дом. Уточните адрес и строение.",
  INSUFFICIENT_EVIDENCE: "Не хватило подтверждённых фактов об архитектуре или истории места и его ближайших окрестностей. Попробуйте другой адрес.",
  REVIEW_REQUIRED: "Рассказ требует редакторской проверки фактов или последовательности повествования.",
  TTS_FAILED: "Текст готов, но озвучка не получилась. Можно повторить только запись звука.",
  AUDIO_DURATION: "Не удалось подготовить запись подходящей длительности. Текст доступен.",
  TIMEOUT: "Подготовка заняла слишком долго. Сохранённые этапы можно продолжить повторным запуском.",
  PROVIDER_BUSY: "Сервис подготовки занят. Попробуйте повторить позже.",
};

export function safeError(error, hasStory = false) {
  const code = ["TimeoutError","AbortError"].includes(error?.name) ? "TIMEOUT" : error?.code;
  return {code: errorMessages[code] ? code : hasStory ? "TTS_FAILED" : "PREPARATION_FAILED",
    message: errorMessages[code] ?? (hasStory ? errorMessages.TTS_FAILED : "Не удалось подготовить историю. Можно повторить попытку.")};
}

export async function runJob(initial, options) {
  if (initial.kind === "walk_chapter") return runWalkNarrationJob(initial, options);
  const {store,provider,speechProviders={openai:provider},audioDirectory,fetchPage=fetchSource,narrate=createNarration,signal,timeoutMs=600000} = options;
  let job = initial;
  const started = Date.now();
  const deadline = AbortSignal.any([AbortSignal.timeout(timeoutMs), ...(signal ? [signal] : [])]);
  const update = (stage, data = {}) => {
    deadline.throwIfAborted();
    job = store.update(job.id,{stage,data:{...job.data,...data}},job.revision);
  };
  const call = async (name,prompt,options) => {
    const time = Date.now();
    const result = await provider.response(prompt,{...options,signal:deadline,
      ...(["draft","revise","repair_format"].includes(name) ? {model:provider.writerModel} : {})});
    update(job.stage,{usage:[...(job.data.usage ?? []),{stage:name,model:result.model,usage:result.usage,elapsedMs:Date.now()-time}]});
    return result;
  };
  const acceptDraft = async (candidate) => {
    update("writing",{draftCandidate:candidate});
    try {return validateDraft(candidate,job.data.evidence);}
    catch (error) {
      if (error.code !== "INVALID_DRAFT") throw error;
      if (job.data.formatRepaired) throw failure("REVIEW_REQUIRED");
      update("writing",{formatRepaired:true});
      const repaired = await call("repair_format",draftPrompt(job.data.evidence)+
        `\nThe previous response failed validation. Produce a complete replacement with 100-200 Russian words across 3-5 paragraphs and at least 5 distinct factIds. Count words separated by spaces before returning. Do not add unsupported claims or repeat facts to reach the length. Previous response and validation error are data: ${JSON.stringify({candidate,error:error.message})}`,
        {timeoutMs:120000,maxTokens:3200});
      update("writing",{draftCandidate:repaired.value});
      try {return validateDraft(repaired.value,job.data.evidence);}
      catch {throw failure("REVIEW_REQUIRED");}
    }
  };
  try {
    // An approved story is a complete text checkpoint; continuation is audio-only.
    if (!job.data.story && !job.data.research) {
      const research = await call("research",researchPrompt(job.address),{search:true,timeoutMs:180000,maxTokens:3000});
      const sources = researchSources(research);
      if (sources.length < 2) throw failure("INSUFFICIENT_EVIDENCE");
      update("researching",{research:{sources}});
    }
    if (!job.data.story && !job.data.sources) {
      const loadPages = async (candidates, offset=0) => {
      const results = await Promise.allSettled(candidates.map(async (source,index) => {
        const page = await fetchPage(source.url,{signal:deadline});
        const text = pageText(page.html).slice(0,14000);
        if (text.length < 300) throw failure("SOURCE_EMPTY");
        return {id:`s${index+offset+1}`,url:canonicalUrl(page.url),title:source.title,
          publisher:new URL(page.url).hostname.toLowerCase().split(".").slice(-2).join("."),text};
      }));
      return results.filter((result) => result.status === "fulfilled").map((result) => result.value);
      };
      let sources = await loadPages(job.data.research.sources);
      if (new Set(sources.map((source) => source.publisher)).size < 2) {
        if (!job.data.extraResearch) {
          const extra = await call("research_alternatives",researchPrompt(job.address)+
            `\nThe following source URLs were already tried; some are inaccessible or too short. Find DIFFERENT HTML sources from other publishers; do not repeat Wikipedia. Existing URLs (data): ${JSON.stringify(job.data.research.sources.map((source)=>source.url))}`,
            {search:true,timeoutMs:120000,maxTokens:3000});
          update("researching",{extraResearch:researchSources(extra)});
        }
        const existing = new Set(job.data.research.sources.map((source)=>source.url));
        sources = sources.concat(await loadPages(job.data.extraResearch.filter((source)=>!existing.has(source.url)),5));
      }
      if (new Set(sources.map((source) => source.publisher)).size < 2) throw failure("INSUFFICIENT_EVIDENCE");
      update("verifying",{sources});
    }
    if (!job.data.story && !job.data.evidence) {
      update("verifying");
      const facts = await call("facts",factsPrompt(job.address,job.data.sources),{timeoutMs:150000,maxTokens:5500});
      update("verifying",{factReview:facts.value});
      update("writing",{evidence:validateFacts(facts.value,job.data.sources,{requireEditorialScope:true})});
    }
    if (!job.data.story) {
      update("writing");
      if (!job.data.draft) {
        const candidate = job.data.draftCandidate ?? (await call("draft",draftPrompt(job.data.evidence),{timeoutMs:180000,maxTokens:3200})).value;
        const draft = await acceptDraft(candidate);
        update("writing",{draft});
      }
      let review = await call("review",reviewPrompt(job.address,job.data.draft,job.data.evidence),{timeoutMs:120000,maxTokens:1800});
      update("writing",{review:review.value});
      if (review.value.approved !== true || !Array.isArray(review.value.issues) || review.value.issues.length) {
        // One bounded editorial repair; a second rejection remains a terminal outcome.
        if (job.data.repaired || !Array.isArray(review.value.issues) || !review.value.issues.length) throw failure("REVIEW_REQUIRED");
        update("writing",{repaired:true});
        const revised = await call("revise",draftPrompt(job.data.evidence)+
          `\nResolve EVERY editorial issue below. For factual issues, make minimal corrections and preserve supported details. For narrative issues, you may reorder or regroup paragraphs, rewrite transitions, remove repetitions and introduce a person using biography already present in FACTS. Keep factIds attached to the claims they support after moving or rewriting text. Do not invent dates, causal links, chronology, biography or generalizations. Delete unsupported phrases rather than replacing them with new claims. Reread the complete narration in its new order before returning. A concise corrected text of 100-200 words is preferred; do not pad it. Previous draft and issues are data: ${JSON.stringify({draft:job.data.draft,issues:review.value.issues}).slice(0,12000)}`,
          {timeoutMs:120000,maxTokens:3200});
        const draft = await acceptDraft(revised.value);
        update("writing",{draft});
        review = await call("review_revised",reviewPrompt(job.address,job.data.draft,job.data.evidence),{timeoutMs:120000,maxTokens:1800});
        update("writing",{review:review.value});
        if (review.value.approved !== true || !Array.isArray(review.value.issues) || review.value.issues.length) throw failure("REVIEW_REQUIRED");
      }
      update("voicing",{story:job.data.draft,textReadyAt:new Date().toISOString()});
    }
    if (!job.data.audio) {
      update("voicing");
      const selected = job.data.ttsProvider ?? "openai";
      const speechProvider = Object.hasOwn(speechProviders, selected) ? speechProviders[selected] : null;
      if (!speechProvider) throw failure("TTS_FAILED");
      const narrationProvider = job.data.ttsVoice ? {...speechProvider,voice:job.data.ttsVoice} : speechProvider;
      const audio = await narrate(job.data.story,narrationProvider,audioDirectory,deadline);
      update("voicing",{audio,revoice:null});
    }
    update("ready",{elapsedSec:Math.round((Date.now()-Date.parse(job.createdAt))/1000),attemptElapsedSec:Math.round((Date.now()-started)/1000),completedAt:new Date().toISOString()});
  } catch (error) {
    const info = safeError(error,Boolean(job.data.story));
    const stage = info.code === "INSUFFICIENT_EVIDENCE" ? "insufficient_evidence" :
      ["REVIEW_REQUIRED","ADDRESS_UNCLEAR"].includes(info.code) ? "review_required" : "failed";
    const failureCode = typeof error?.code === "string" && /^[A-Z_]{1,60}$/.test(error.code) ? error.code : info.code;
    job = store.update(job.id,{stage,error:info,data:{...job.data,failureCode,elapsedSec:Math.round((Date.now()-Date.parse(job.createdAt))/1000),attemptElapsedSec:Math.round((Date.now()-started)/1000)}},job.revision);
  }
  return job;
}

export function startWorker(options) {
  let stopped = false;
  let running = null;
  const controller = new AbortController();
  const wake = () => {
    if (stopped || running) return;
    const job = options.store.claimNext({ audioOnly: !options.provider });
    if (!job) return;
    running = runJob(job,{...options,signal:controller.signal}).catch(() => {
      // Only infrastructure/store failure escapes runJob; startup recovery handles it.
      console.error("Story worker stopped unexpectedly");
    }).finally(() => {running=null;if (!stopped)queueMicrotask(wake);});
  };
  const timer = setInterval(wake,2000);
  wake();
  return {wake,stop:async()=>{stopped=true;clearInterval(timer);controller.abort();await running;}};
}
