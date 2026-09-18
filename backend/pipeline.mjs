import { EDITORIAL_EVIDENCE_VERSION, failure, validateFacts } from "./domain.mjs";
import { validateSourceUrl, fetchSource } from "./safe-fetch.mjs";
import { sourceText } from "./source-text.mjs";
import { researchPrompt, factsPrompt } from "./prompts.mjs";
import { requestStructured } from "./model-output.mjs";
import { writeStory } from "./story-writing.mjs";
import { createNarration } from "./audio.mjs";
import { runWalkNarrationJob } from "./walk-admin.mjs";
import { runWalkResearchJob } from "./walk-research.mjs";

function canonicalUrl(raw) {
  const url = validateSourceUrl(raw);
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) if (key.startsWith("utm_")) url.searchParams.delete(key);
  return url.href;
}

function researchSources(research) {
  const seen = new Set();
  return (research.sources??research.citedUrls?.map(url=>({url}))??[]).slice(0,5).flatMap((source) => {
    try {
      const url = canonicalUrl(source.url);
      if(seen.has(url))return [];
      seen.add(url);return [{url,title:(source.title||new URL(url).hostname).slice(0,250)}];
    } catch{return [];}
  });
}

function invalidateEditorialCheckpoint(data) {
  const retained={...data};
  for(const key of ["evidence","draft","review","draftCandidateRaw","factReview","editorialVersion"])delete retained[key];
  return retained;
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
  SOURCE_ACCESS_FAILED: "Источники найдены, но их не удалось загрузить или прочитать. Можно повторить поиск позже.",
};

export function safeError(error, hasStory = false) {
  const code = ["TimeoutError","AbortError"].includes(error?.name) ? "TIMEOUT" : error?.code;
  return {code: errorMessages[code] ? code : hasStory ? "TTS_FAILED" : "PREPARATION_FAILED",
    message: errorMessages[code] ?? (hasStory ? errorMessages.TTS_FAILED : "Не удалось подготовить историю. Можно повторить попытку.")};
}

export async function runJob(initial, options) {
  if (initial.kind === "walk_research") return runWalkResearchJob(initial, options, runJob);
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
  try {
    if(!job.data.story&&job.data.evidence?.version!==EDITORIAL_EVIDENCE_VERSION){
      const retained=invalidateEditorialCheckpoint(job.data);
      deadline.throwIfAborted();job=store.update(job.id,{stage:job.data.sources?"verifying":"researching",data:retained},job.revision);
    }
    // An approved story is a complete text checkpoint; continuation is audio-only.
    if (!job.data.story && !job.data.evidence && !job.data.research && !job.data.sources) {
      const research = await call("research",researchPrompt(job.address),{search:true,timeoutMs:180000,maxTokens:3000});
      const sources = researchSources(research);
      if (!sources.length) throw failure("INSUFFICIENT_EVIDENCE");
      update("researching",{research:{sources}});
    }
    if (!job.data.story && !job.data.evidence && !job.data.sources) {
      const loadPages = async (candidates, offset=0) => {
      const results = await Promise.allSettled(candidates.map(async (source,index) => {
        const page = await fetchPage(source.url,{signal:deadline});
        const text = await sourceText(page,{keywords:[job.address]});
        if (text.length < 300) throw failure("SOURCE_EMPTY");
        return {id:`s${index+offset+1}`,url:canonicalUrl(page.url),title:source.title,
          publisher:new URL(page.url).hostname.toLowerCase().split(".").slice(-2).join("."),text};
      }));
      return results.filter((result) => result.status === "fulfilled").map((result) => result.value);
      };
      let sources = await loadPages(job.data.research.sources);
      if (!sources.length) {
        if (!job.data.extraResearch) {
          const extra = await call("research_alternatives",researchPrompt(job.address)+
            `\nThe following source URLs were already tried; some are inaccessible or too short. Find DIFFERENT HTML sources from other publishers; do not repeat Wikipedia. Existing URLs (data): ${JSON.stringify(job.data.research.sources.map((source)=>source.url))}`,
            {search:true,timeoutMs:120000,maxTokens:3000});
          update("researching",{extraResearch:researchSources(extra)});
        }
        const existing = new Set(job.data.research.sources.map((source)=>source.url));
        sources = sources.concat(await loadPages(job.data.extraResearch.filter((source)=>!existing.has(source.url)),5));
      }
      if (!sources.length) throw failure("SOURCE_ACCESS_FAILED");
      update("verifying",{sources});
    }
    if (!job.data.story && !job.data.evidence) {
      update("verifying");
      const facts = await requestStructured(provider,factsPrompt(job.address,job.data.sources),{signal:deadline,timeoutMs:150000,maxTokens:5500});
      update(job.stage,{usage:[...(job.data.usage ?? []),{stage:"facts",model:facts.model,usage:facts.usage}]});
      update("verifying",{factReview:facts.value});
      update("writing",{evidence:validateFacts(facts.value,job.data.sources,{requireEditorialScope:true}),editorialVersion:EDITORIAL_EVIDENCE_VERSION});
    }
    if (options.researchOnly) return job;
    if (!job.data.story) {
      update("writing");
      if (!job.data.draft) {
        const draft = await writeStory(job.data.evidence,{provider,address:job.address,signal:deadline,onCandidate:candidate=>update("writing",{draftCandidateRaw:candidate}),onReview:review=>update("writing",{review})});
        update("writing",{draft});
      }
      update("voicing",{story:job.data.draft,textReadyAt:new Date().toISOString()});
    }
    if (!job.data.audio && job.data.story.audioDisposition !== "not_applicable_short_text") {
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
    running = runJob(job,{...options,signal:controller.signal}).then(result => {
      if(result.stage==="failed") options.logs?.captureMessage(result.error?.code??"Job failed","error",{operation:"runJob",context:{jobId:result.id,kind:result.kind,code:result.error?.code}});
    }).catch(error => {
      // Only infrastructure/store failure escapes runJob; startup recovery handles it.
      console.error("Story worker stopped unexpectedly");
      options.logs?.captureException(error,{operation:"runJob",context:{jobId:job.id,kind:job.kind}});
    }).finally(() => {running=null;if (!stopped)queueMicrotask(wake);});
  };
  const timer = setInterval(wake,2000);
  wake();
  return {wake,stop:async()=>{stopped=true;clearInterval(timer);controller.abort();await running;}};
}
