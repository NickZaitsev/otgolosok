import type { GenerationJob } from "./types";

export const STORY_CACHE = "story-packs-v1";
export const jobUrl = (id: string) => `/api/story-jobs/${id}`;

export async function isStorySaved(job: GenerationJob) {
  if (!job.audio || !("caches" in window)) return false;
  const cache = await caches.open(STORY_CACHE);
  return Boolean(await cache.match(jobUrl(job.id))) && Boolean(await cache.match(job.audio.url));
}

export async function saveStoryOffline(job: GenerationJob) {
  if (job.stage !== "ready" || !job.story || !job.audio) throw new Error("Дождитесь готовности озвучки.");
  if (!navigator.serviceWorker?.controller) throw new Error("Обновите страницу и попробуйте сохранить ещё раз.");
  const cache = await caches.open(STORY_CACHE);
  const keys = await cache.keys();
  const saved = keys.filter((key) => new URL(key.url).pathname.startsWith("/api/story-jobs/"));
  if (saved.length >= 3 && !await cache.match(jobUrl(job.id))) throw new Error("Можно сохранить три истории. Удалите одну из сохранённых.");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(),45000);
  try {
    const response = await fetch(job.audio.url,{signal:controller.signal,cache:"reload"});
    if (!response.ok || response.status !== 200 || !response.headers.get("content-type")?.startsWith("audio/")) throw new Error("Не удалось скачать запись.");
    const bytes = await response.arrayBuffer();
    const digest = await crypto.subtle.digest("SHA-256",bytes);
    const hash = Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,"0")).join("");
    if (bytes.byteLength !== job.audio.bytes || hash !== job.audio.sha256) throw new Error("Запись загрузилась не полностью. Попробуйте ещё раз.");
    const hadAudio = Boolean(await cache.match(job.audio.url));
    await cache.put(job.audio.url,new Response(bytes,{headers:{"Content-Type":"audio/mpeg","Content-Length":String(bytes.byteLength)}}));
    try {await cache.put(jobUrl(job.id),new Response(JSON.stringify(job),{headers:{"Content-Type":"application/json"}}));}
    catch (error) {if (!hadAudio) await cache.delete(job.audio.url);throw error;}
  } finally {clearTimeout(timer);}
}

export async function removeSavedStory(job: GenerationJob) {
  const cache = await caches.open(STORY_CACHE);
  await cache.delete(jobUrl(job.id));
  if (job.audio && !(await savedStories()).some((other)=>other.audio?.url===job.audio?.url)) await cache.delete(job.audio.url);
}

export async function savedStories(): Promise<GenerationJob[]> {
  if (!("caches" in window)) return [];
  const cache = await caches.open(STORY_CACHE);
  const keys = (await cache.keys()).filter((key)=>new URL(key.url).pathname.startsWith("/api/story-jobs/"));
  const results = await Promise.allSettled(keys.map(async(key)=>(await cache.match(key))?.json()));
  return results.flatMap((result)=>result.status==="fulfilled"&&result.value?.stage==="ready"?[result.value]:[]);
}
