import { createServer as httpServer } from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { resolve, join, extname, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { createStore } from "./store.mjs";
import { createProvider } from "./provider.mjs";
import { createYandexTts } from "./yandex-tts.mjs";
import { ttsVoiceOptions } from "./tts-voices.mjs";
import { normalizeAddress, addressKey, publicJob, failure } from "./domain.mjs";
import { safeError, startWorker } from "./pipeline.mjs";
import { createPlaceResolver } from "./places.mjs";
import { createWalkPlanner } from "./walks.mjs";
import { adminAuth, adminDetail, adminSummary } from "./admin.mjs";
import { validateWalkResearch, publicWalkResearch } from "./walk-research.mjs";

const UUID = "[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}";
function json(res,status,value) {
  res.writeHead(status,{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store","X-Content-Type-Options":"nosniff"});
  res.end(JSON.stringify(value));
}
async function body(req,maxBytes=2048) {
  if (req.headers["content-type"]?.split(";")[0] !== "application/json") throw failure("BAD_REQUEST");
  const chunks=[];let size=0;
  for await (const chunk of req) {size+=chunk.length;if(size>maxBytes)throw failure("BAD_REQUEST");chunks.push(chunk);}
  try {const value=JSON.parse(Buffer.concat(chunks).toString());if (!value||Array.isArray(value)||typeof value!=="object")throw new Error();return value;}
  catch {throw failure("BAD_REQUEST");}
}

export async function sendFile(req,res,path,type,immutable=false) {
  let info;
  try {info=await stat(path);} catch {json(res,404,{error:{message:"Файл не найден."}});return;}
  if (!info.isFile()) {json(res,404,{error:{message:"Файл не найден."}});return;}
  const headers={"Content-Type":type,"Accept-Ranges":"bytes","X-Content-Type-Options":"nosniff","Cache-Control":immutable?"public, max-age=31536000, immutable":"no-cache"};
  let start=0,end=info.size-1,status=200;
  if (req.headers.range) {
    const match=/^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
    if (!match||(!match[1]&&!match[2])) {res.writeHead(416,{"Content-Range":`bytes */${info.size}`});res.end();return;}
    start=match[1]?Number(match[1]):Math.max(0,info.size-Number(match[2]));
    end=match[1]&&match[2]?Math.min(Number(match[2]),info.size-1):info.size-1;
    if (!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>end||start>=info.size) {res.writeHead(416,{"Content-Range":`bytes */${info.size}`});res.end();return;}
    headers["Content-Range"]=`bytes ${start}-${end}/${info.size}`;status=206;
  }
  headers["Content-Length"]=Math.max(0,end-start+1);
  res.writeHead(status,headers);
  if(req.method==="HEAD"||!info.size){res.end();return;}
  const stream=createReadStream(path,{start,end});
  res.once("close",()=>stream.destroy());stream.once("error",()=>res.destroy());stream.pipe(res);
}

export function createApp({store,provider,yandexTts=null,origin,audioDirectory,staticDirectory,workerEnabled=true,resolvePlace=createPlaceResolver(),planWalk=createWalkPlanner(),discoverResearch,planResearchWalk,adminToken=process.env.ADMIN_TOKEN}) {
  const speechProviders={openai:provider,yandex:yandexTts};
  const ttsProviders=[{id:"openai",label:"OpenAI",available:Boolean(provider),...ttsVoiceOptions("openai",provider?.voice)},
    {id:"yandex",label:"Яндекс SpeechKit",available:Boolean(yandexTts),...ttsVoiceOptions("yandex",yandexTts?.voice)}];
  const worker=(provider||yandexTts)&&workerEnabled?startWorker({store,provider,speechProviders,audioDirectory,discoverResearch,planResearchWalk}):null;
  const authorizeAdmin=adminAuth(adminToken);
  const server=httpServer(async(req,res)=>{
    try {
      const url=new URL(req.url,"http://localhost");
      const researchMatch=new RegExp(`^/api/walk-research-jobs(?:/(${UUID})(/retry)?)?$`).exec(url.pathname);
      if(researchMatch) {
        let job;
        if(req.method==="GET"&&!researchMatch[2]) {
          if(researchMatch[1]) {
            if(url.search)throw failure("BAD_REQUEST");
            job=store.get(researchMatch[1]);
            if(job?.kind!=="walk_research")job=null;
          } else {
            const entries=[...url.searchParams];
            if(entries.length!==5||new Set(entries.map(([k])=>k)).size!==5||entries.some(([k,v])=>!["lat","lon","mode","minutes","recoveryToken"].includes(k)||!v.trim()))throw failure("BAD_REQUEST");
            const q=Object.fromEntries(entries);
            if(!/^(30|60|90)$/.test(q.minutes)||![q.lat,q.lon].every(v=>/^-?\d+(?:\.\d+)?$/.test(v)))throw failure("BAD_REQUEST");
            const request=validateWalkResearch({start:{location:{lat:Number(q.lat),lon:Number(q.lon)}},mode:q.mode,minutes:Number(q.minutes)},true);
            job=store.lookupWalkResearch(request,q.recoveryToken);
          }
        } else if(req.method==="POST"&&(!researchMatch[1]||researchMatch[2])) {
          if(!origin||req.headers.origin!==origin||![undefined,"same-origin","none"].includes(req.headers["sec-fetch-site"])) {json(res,403,{error:{code:"FORBIDDEN",message:"Same-origin request required."}});return;}
          if(url.search)throw failure("BAD_REQUEST");
          const input=await body(req);
          if(researchMatch[2]) {
            if(Object.keys(input).length!==1||!Number.isSafeInteger(input.revision)||input.revision<0)throw failure("BAD_REQUEST");
            if(!provider){json(res,503,{error:{code:"PROVIDER_UNAVAILABLE",message:"Story provider unavailable."}});return;}
            job=store.retryWalkResearch(researchMatch[1],input.revision);
          } else {
            try {job=store.createWalkResearch(input,{allowCreate:Boolean(provider)});}
            catch(error) {
              if(error.code!=="PROVIDER_UNAVAILABLE")throw error;
              json(res,503,{error:{code:"PROVIDER_UNAVAILABLE",message:"Story provider unavailable."}});return;
            }
          }
        } else {json(res,405,{error:{code:"METHOD_NOT_ALLOWED",message:"Method not allowed."}});return;}
        json(res,job?200:404,job?publicWalkResearch(job):{error:{code:"NOT_FOUND",message:"Walk research job not found."}});
        if(req.method==="POST")worker?.wake();
        return;
      }
      if(url.pathname==="/api/story-admin"||url.pathname.startsWith("/api/story-admin/")) {
        const status=authorizeAdmin(req.headers.authorization);
        if(status!==200) {
          if(status===429)res.setHeader("Retry-After","60");
          if(status===401)res.setHeader("WWW-Authenticate","Bearer");
          json(res,status,{error:{code:status===429?"ADMIN_THROTTLED":"UNAUTHORIZED",message:"Admin authentication required."}});return;
        }
        if(req.method==="GET"&&url.pathname==="/api/story-admin/walks") {
          if(url.search)throw failure("BAD_REQUEST");
          json(res,200,store.listWalksAdmin());return;
        }
        const walkMatch=/^\/api\/story-admin\/walks\/([a-z0-9][a-z0-9-]{0,127})(?:\/chapters\/([a-z0-9][a-z0-9-]{0,127})\/(edit|revoice))?$/.exec(url.pathname);
        if(walkMatch&&((req.method==="GET"&&!walkMatch[2])||(req.method==="POST"&&walkMatch[2]))) {
          if(url.search)throw failure("BAD_REQUEST");
          let walk=store.getWalkAdmin(walkMatch[1]);
          if(req.method==="POST") {
            if(!origin||req.headers.origin!==origin||![undefined,"same-origin","none"].includes(req.headers["sec-fetch-site"])) {
              json(res,403,{error:{code:"FORBIDDEN",message:"Same-origin request required."}});return;
            }
            const input=await body(req,walkMatch[3]==="edit"?65536:2048);
            if(!Number.isSafeInteger(input.revision)||input.revision<0||Object.keys(input).some(key=>!["revision",...(walkMatch[3]==="edit"?["draft"]:["ttsProvider","ttsVoice"])].includes(key)))throw failure("BAD_REQUEST");
            if(!walk||!walk.chapters.some(chapter=>chapter.id===walkMatch[2])) {
              json(res,404,{error:{code:"NOT_FOUND",message:"Walk chapter not found."}});return;
            }
            if(walkMatch[3]==="edit") store.saveWalkChapterAdmin(walkMatch[1],walkMatch[2],input.revision,input.draft);
            else {
              const selected=input.ttsProvider===undefined?"openai":input.ttsProvider;
              const options=ttsProviders.find(option=>option.id===selected);
              if(!options)throw failure("BAD_REQUEST");
              const voice=input.ttsVoice===undefined?options.defaultVoice:input.ttsVoice;
              if(!options.voices.some(option=>option.id===voice))throw failure("BAD_REQUEST");
              if(!speechProviders[selected]) {
                json(res,503,{error:{code:"TTS_UNAVAILABLE",message:"Selected speech provider unavailable."}});return;
              }
              store.revoiceWalkChapterAdmin(walkMatch[1],walkMatch[2],input.revision,selected,voice);
            }
            walk=store.getWalkAdmin(walkMatch[1]);
          }
          json(res,walk?200:404,walk?{walk:{...walk,ttsProviders}}:{error:{code:"NOT_FOUND",message:"Walk not found."}});
          if(req.method==="POST"&&walkMatch[3]==="revoice")worker?.wake();
          return;
        }
        if(req.method==="GET"&&url.pathname==="/api/story-admin/jobs") {
          const entries=[...url.searchParams];
          if(entries.some(([key,value])=>!["limit","offset","q","stage","relevance"].includes(key)||(["limit","offset"].includes(key)&&!/^\d+$/.test(value)))||new Set(entries.map(([key])=>key)).size!==entries.length)throw failure("BAD_REQUEST");
          const result=store.listAdmin({limit:Number(url.searchParams.get("limit")??50),offset:Number(url.searchParams.get("offset")??0),q:url.searchParams.get("q")??"",stage:url.searchParams.get("stage")??"",relevance:url.searchParams.get("relevance")??"active"});
          json(res,200,{jobs:result.jobs.map(job=>adminSummary(job,safeError)),hasMore:result.hasMore});return;
        }
        const match=new RegExp(`^/api/story-admin/jobs/(${UUID})(?:/(edit|approve|relevance|revoice|retry))?$`).exec(url.pathname);
        if(match&&((req.method==="GET"&&!match[2])||(req.method==="POST"&&match[2]))) {
          let job;
          if(req.method==="GET") {job=store.get(match[1]);if(job&&(job.kind??"address")!=="address")job=null;}
          else {
            if(!origin||req.headers.origin!==origin||![undefined,"same-origin","none"].includes(req.headers["sec-fetch-site"])) {
              json(res,403,{error:{code:"FORBIDDEN",message:"Same-origin request required."}});return;
            }
            const input=await body(req,match[2]==="edit"?32768:2048);
            if(!Number.isSafeInteger(input.revision)||input.revision<0||Object.keys(input).some(key=>!["revision",...(match[2]==="edit"?["draft"]:match[2]==="relevance"?["irrelevant"]:["ttsProvider","ttsVoice"])].includes(key)))throw failure("BAD_REQUEST");
            if(match[2]==="relevance") {
              job=store.setRelevanceAdmin(match[1],input.revision,input.irrelevant);
            } else if(match[2]==="edit") {
              const draft=input.draft;
              if(!draft||typeof draft!=="object"||Array.isArray(draft)||Object.keys(draft).some(key=>!["title","paragraphs"].includes(key))||!Array.isArray(draft.paragraphs)||draft.paragraphs.some(p=>!p||typeof p!=="object"||Array.isArray(p)||Object.keys(p).some(key=>!["text","factIds"].includes(key))))throw failure("BAD_REQUEST");
              job=store.editAdmin(match[1],input.revision,draft);
            } else {
              const selected=input.ttsProvider===undefined?"openai":input.ttsProvider;
              if(!["openai","yandex"].includes(selected))throw failure("BAD_REQUEST");
              const options=ttsProviders.find(option=>option.id===selected);
              const voice=input.ttsVoice===undefined?options.defaultVoice:input.ttsVoice;
              if(!options.voices.some(option=>option.id===voice))throw failure("BAD_REQUEST");
              if(match[2]==="retry"&&!provider&&!store.get(match[1])?.data.story){json(res,503,{error:{code:"PROVIDER_UNAVAILABLE",message:"Story provider unavailable."}});return;}
              if(!speechProviders[selected]){json(res,503,{error:{code:"TTS_UNAVAILABLE",message:"Selected speech provider unavailable."}});return;}
              job=match[2]==="revoice"?store.revoiceAdmin(match[1],input.revision,selected,voice):match[2]==="retry"?store.retryAdmin(match[1],input.revision,selected,voice):store.approveAdmin(match[1],input.revision,selected,voice);
            }
          }
          json(res,job?200:404,job?{job:adminDetail(job,Boolean(provider||yandexTts),safeError,ttsProviders)}:{error:{code:"NOT_FOUND",message:"Job not found."}});
          if(req.method==="POST"&&["approve","revoice","retry"].includes(match[2]))worker?.wake();
          return;
        }
        json(res,404,{error:{code:"NOT_FOUND",message:"Admin endpoint not found."}});return;
      }
      if(req.method==="GET"&&url.pathname==="/api/story-service") {json(res,200,{enabled:Boolean(provider),version:1});return;}
      const publishedWalk=/^\/api\/story-walks\/([a-z0-9][a-z0-9-]{0,127})$/.exec(url.pathname);
      if(req.method==="GET"&&publishedWalk) {
        const route=store.getPublishedWalk(publishedWalk[1]);
        json(res,route?200:404,route??{error:{code:"NOT_FOUND",message:"Walk not found."}});return;
      }
      if(req.method==="GET"&&url.pathname==="/api/story-place") {
        try {
          const entries=[...url.searchParams.entries()];
          if(new Set(entries.map(([key])=>key)).size!==entries.length)throw Object.assign(new Error(),{code:"PLACE_INVALID"});
          const input=Object.fromEntries(entries.map(([key,value])=>[key,["lat","lon"].includes(key)?(value.trim()?Number(value):NaN):value]));
          json(res,200,await resolvePlace(input));
        }catch(error){
          const messages={PLACE_INVALID:"Выберите дом в Москве или введите адрес.",PLACE_BUSY:"Поиск занят. Повторите через пару секунд.",PLACE_NOT_FOUND:"Не удалось определить дом. Уточните адрес вручную.",PLACE_UNAVAILABLE:"Поиск адреса временно недоступен. Адрес можно ввести вручную."};
          const code=Object.hasOwn(messages,error.code)?error.code:"PLACE_UNAVAILABLE";
          if(code==="PLACE_BUSY")res.setHeader("Retry-After","2");
          json(res,{PLACE_INVALID:400,PLACE_BUSY:429,PLACE_NOT_FOUND:404,PLACE_UNAVAILABLE:503}[code],{error:{code,message:messages[code]}});
        }
        return;
      }
      if(req.method==="POST") {
        if(req.headers.origin!==origin||![undefined,"same-origin","none"].includes(req.headers["sec-fetch-site"])) {json(res,403,{error:{message:"Откройте подготовку истории на сайте."}});return;}
        if(url.pathname==="/api/walk-plan") {
          try {json(res,200,await planWalk(await body(req,8192)));}
          catch(error) {
            const messages={WALK_INVALID:"Проверьте начало, остановки и параметры прогулки.",WALK_BUSY:"Планировщик занят. Повторите через пару секунд.",WALK_NOT_FOUND:"Не удалось построить пешеходную прогулку в выбранное время. Измените точки или длительность.",WALK_STOPS_NOT_FOUND:"Рядом со стартом недостаточно достопримечательностей в каталоге. Добавьте остановки вручную или выберите другое начало прогулки.",WALK_DISCOVERY_UNAVAILABLE:"Не удалось автоматически подобрать остановки. Попробуйте позже или добавьте остановки вручную.",WALK_UNAVAILABLE:"Пешеходный маршрутизатор временно недоступен. Попробуйте позже."};
            const code=error.code==="BAD_REQUEST"?"WALK_INVALID":Object.hasOwn(messages,error.code)?error.code:"WALK_UNAVAILABLE";
            if(code==="WALK_BUSY")res.setHeader("Retry-After","2");
            json(res,{WALK_INVALID:400,WALK_BUSY:429,WALK_NOT_FOUND:404,WALK_STOPS_NOT_FOUND:404,WALK_DISCOVERY_UNAVAILABLE:503,WALK_UNAVAILABLE:503}[code],{error:{code,message:messages[code]}});
          }
          return;
        }
        if(!provider) {json(res,503,{error:{message:"Подготовка историй пока недоступна."}});return;}
        const input=await body(req);
        if(url.pathname==="/api/story-jobs") {
          if(Object.keys(input).some((key)=>key!=="address"))throw failure("BAD_REQUEST");
          const address=normalizeAddress(input.address);
          const job=store.createOrGet({key:addressKey(address),address});
          json(res,200,publicJob(job));worker?.wake();return;
        }
        const retry=new RegExp(`^/api/story-jobs/(${UUID})/retry$`).exec(url.pathname);
        if(retry) {
          if(!Number.isInteger(input.revision)||Object.keys(input).some((key)=>key!=="revision"))throw failure("BAD_REQUEST");
          const job=store.retry(retry[1],input.revision);
          if(!job){json(res,404,{error:{message:"Задание не найдено."}});return;}
          json(res,200,publicJob(job));worker?.wake();return;
        }
      }
      const match=new RegExp(`^/api/story-jobs/(${UUID})$`).exec(url.pathname);
      if(req.method==="GET"&&match) {
        const storedJob=store.get(match[1]);
        const job=storedJob&&(storedJob.kind??"address")!=="address"?null:storedJob;
        json(res,job?200:404,job?publicJob(job):{error:{message:"Задание не найдено."}});return;
      }
      const audio=/^\/api\/story-audio\/([a-f0-9]{64}\.mp3)$/.exec(url.pathname);
      if(["GET","HEAD"].includes(req.method)&&audio) {await sendFile(req,res,join(audioDirectory,audio[1]),"audio/mpeg",true);return;}
      // Local production preview only; deployed frontend remains in Nginx.
      if(staticDirectory&&["GET","HEAD"].includes(req.method)&&!url.pathname.startsWith("/api/")) {
        const root=resolve(staticDirectory);const relative=decodeURIComponent(url.pathname).replace(/^\/+/,"")||"index.html";
        let file=resolve(root,relative);
        if(!file.startsWith(root+sep)){json(res,404,{});return;}
        if(!extname(file)) file+=".html";
        const types={".html":"text/html; charset=utf-8",".js":"application/javascript",".css":"text/css",".json":"application/json",".txt":"text/plain",".svg":"image/svg+xml",".woff2":"font/woff2",".ico":"image/x-icon",".mp3":"audio/mpeg",".webmanifest":"application/manifest+json"};
        await sendFile(req,res,file,types[extname(file)]??"application/octet-stream");return;
      }
      json(res,404,{error:{message:"Страница не найдена."}});
    } catch(error) {
      if(res.headersSent||res.destroyed)return;
      const status=["QUEUE_FULL","DAILY_LIMIT"].includes(error.code)?429:["CONFLICT","RETRY_LIMIT"].includes(error.code)?409:["INVALID_ADDRESS","BAD_REQUEST","INVALID_DRAFT"].includes(error.code)?400:500;
      json(res,status,{error:["BAD_REQUEST","INVALID_DRAFT"].includes(error.code)?{code:error.code,message:"Invalid request or draft."}:safeError(error)});
    }
  });
  server.requestTimeout=15000;server.headersTimeout=10000;server.keepAliveTimeout=5000;
  return {server,close:async()=>{await worker?.stop();await new Promise((done)=>server.close(done));server.closeAllConnections();}};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  const directory=resolve(process.env.DATA_DIR??"backend/data");
  const store=createStore(join(directory,"jobs.sqlite"),{maxDaily:Number(process.env.MAX_DAILY_JOBS??6),maxActive:2});
  store.recoverInterrupted();
  const provider=process.env.OPENAI_API_KEY&&process.env.OPENAI_BASE_URL?createProvider({apiKey:process.env.OPENAI_API_KEY,baseUrl:process.env.OPENAI_BASE_URL,model:process.env.STORY_MODEL,writerModel:process.env.WRITER_MODEL}):null;
  const yandexTts=process.env.YANDEX_TTS_API_KEY?createYandexTts({apiKey:process.env.YANDEX_TTS_API_KEY,voice:process.env.YANDEX_TTS_VOICE||"marina"}):null;
  const port=Number(process.env.PORT??4175);
  const app=createApp({store,provider,yandexTts,origin:process.env.APP_ORIGIN??`http://127.0.0.1:${port}`,audioDirectory:join(directory,"audio"),staticDirectory:process.env.STATIC_DIR});
  app.server.listen(port,process.env.HOST??"127.0.0.1",()=>console.log(`Story service listening on ${port}; provider ${provider?"configured":"unavailable"}`));
  let stopping=false;
  for(const signal of ["SIGINT","SIGTERM"])process.on(signal,async()=>{if(stopping)return;stopping=true;await app.close();store.close();});
}
