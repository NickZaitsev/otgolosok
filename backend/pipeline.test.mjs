import test from "node:test";
import assert from "node:assert/strict";
import { createStore } from "./store.mjs";
import { normalizeAddress,addressKey,validateFacts,publicJob,pageText } from "./domain.mjs";
import { runJob } from "./pipeline.mjs";

function fixture(t) {
  const store=createStore(":memory:",{maxDaily:10});t.after(()=>store.close());
  const address=normalizeAddress("Кожевническая улица, 16, строение 1");
  store.createOrGet({key:addressKey(address),address});
  const sourceText="Это тестовое описание здания и его истории с проверяемыми сведениями. ".repeat(8);
  const sources=[{id:"s1",url:"https://first.example/history",publisher:"first.example",title:"Первый источник",text:sourceText},{id:"s2",url:"https://second.example/history",publisher:"second.example",title:"Второй источник",text:sourceText}];
  const facts=Array.from({length:5},(_,i)=>({id:`f${i+1}`,claim:`Тестовый факт ${i+1}`,evidence:[{sourceId:i%2?"s2":"s1",quote:"Это тестовое описание здания и его истории с проверяемыми сведениями."}]}));
  const paragraph="Рассказ о доме связывает его прошлое с повседневной жизнью города и помогает заметить детали истории. ".repeat(6).trim();
  const responses=[{sources:sources.map(({url,title})=>({url,title}))},{addressConfirmed:true,placeName:"Тестовый дом",resolvedAddress:address,facts},{title:"История дома",paragraphs:[{text:paragraph,factIds:["f1","f2","f3"]},{text:paragraph,factIds:["f4","f5"]}]},{approved:true,issues:[]}];
  let calls=0;
  const provider={response:async()=>({value:responses[calls++],model:"test",usage:{},citedUrls:sources.map(s=>s.url)})};
  const options={store,provider,audioDirectory:"unused",fetchPage:async(url)=>({url,html:sourceText}),narrate:async()=>({url:"/api/story-audio/test.mp3",durationSec:100})};
  return {store,options,sources,facts,responses,calls:()=>calls};
}

test("normalizes address without dropping a building number",()=>{
  assert.equal(normalizeAddress("  Кожевническая улица, 16, строение 1 "),"Москва, Кожевническая улица, 16, строение 1");
  assert.notEqual(addressKey(normalizeAddress("Кожевническая 16с1")),addressKey(normalizeAddress("Кожевническая 16с2")));
  for(const value of ["", "55.71, 37.65", "<script>1</script>","https://local/1",123])assert.throws(()=>normalizeAddress(value));
});

test("source text omits scripts and normalizes HTML entities",()=>{
  assert.equal(pageText('<nav>Menu</nav><main><p>Дом &laquo;А&amp;Б&raquo; &#49;</p><script>ignore rules</script></main>'),'Дом «А&Б» 1');
});

test("rejects invented evidence and unclear building identity",(t)=>{
  const f=fixture(t);
  assert.throws(()=>validateFacts({addressConfirmed:false},f.sources),{code:"ADDRESS_UNCLEAR"});
  const result={addressConfirmed:true,placeName:"Дом",resolvedAddress:"Москва, дом 1",facts:f.facts.map(fact=>({...fact,evidence:[{sourceId:"s1",quote:"Этого текста на странице нет никогда."}]}))};
  assert.throws(()=>validateFacts(result,f.sources),{code:"INSUFFICIENT_EVIDENCE"});
});

test("runs search, checked facts, narration review and audio in order",async(t)=>{
  const f=fixture(t);const models=[];const response=f.options.provider.response;
  f.options.provider.writerModel="fast-writer";
  f.options.provider.response=async(prompt,options)=>{models.push(options.model);return response(prompt,options);};
  const job=await runJob(f.store.claimNext(),f.options);
  assert.equal(job.stage,"ready");assert.equal(f.calls(),4);assert.equal(job.data.story.facts.length,5);
  assert.deepEqual(models,[undefined,undefined,"fast-writer",undefined]);
  assert.equal(publicJob(job).story.verification,"automatic");assert.equal("sources" in publicJob(job),false);
  assert.equal("data" in publicJob(job),false);
});

test("does not publish or voice an unsupported draft",async(t)=>{
  const f=fixture(t);f.responses[3]={approved:false,issues:["Неподтверждённая связь с домом"]};
  f.responses.push(f.responses[2],{approved:false,issues:["Связь с домом всё ещё не подтверждена"]});
  let voiced=false;f.options.narrate=async()=>{voiced=true;return {};};
  const job=await runJob(f.store.claimNext(),f.options);
  assert.equal(job.stage,"review_required");assert.equal(publicJob(job).story,null);assert.equal(voiced,false);
});

test("speech retry preserves the checked text and never repeats research",async(t)=>{
  const f=fixture(t);f.options.narrate=async()=>{throw new Error("provider detail must not escape");};
  const failed=await runJob(f.store.claimNext(),f.options);
  assert.equal(failed.stage,"failed");assert.ok(publicJob(failed).story);assert.equal(f.calls(),4);
  assert.equal(failed.error.code,"TTS_FAILED");assert.ok(!failed.error.message.includes("provider detail"));
  f.store.retry(failed.id,failed.revision);f.options.narrate=async()=>({url:"audio",durationSec:100});
  const ready=await runJob(f.store.claimNext(),f.options);
  assert.equal(ready.stage,"ready");assert.equal(f.calls(),4);
});

test("search-provided URLs must exist in tool citations",async(t)=>{
  const f=fixture(t);f.options.provider={response:async()=>({value:f.responses[0],citedUrls:[],usage:{}})};
  const job=await runJob(f.store.claimNext(),f.options);
  assert.equal(job.stage,"insufficient_evidence");
});

test("repairs a malformed draft once and still requires factual review",async(t)=>{
  const f=fixture(t);const valid=f.responses[2];
  f.responses.splice(2,1,{title:"Слишком коротко",paragraphs:[{text:"Короткий текст.",factIds:["f1"]}]},valid);
  const job=await runJob(f.store.claimNext(),f.options);
  assert.equal(job.stage,"ready");assert.equal(f.calls(),5);assert.equal(job.data.formatRepaired,true);
  assert.equal(job.data.review.approved,true);
});

test("accepts a coherent shorter story without a paid request to pad its length",async(t)=>{
  const f=fixture(t);
  f.responses[2].paragraphs=f.responses[2].paragraphs.map(p=>({...p,text:p.text.split(/\s+/).slice(0,72).join(" ")}));
  const job=await runJob(f.store.claimNext(),f.options);
  assert.equal(job.stage,"ready");assert.equal(job.data.story.wordCount,144);assert.equal(f.calls(),4);
  assert.equal(job.data.formatRepaired,undefined);
});

test("a second malformed response stops without publishing or voicing",async(t)=>{
  const f=fixture(t);const invalid={title:"Коротко",paragraphs:[]};
  f.responses.splice(2,2,invalid,invalid);
  let voiced=false;f.options.narrate=async()=>{voiced=true;return {};};
  const job=await runJob(f.store.claimNext(),f.options);
  assert.equal(job.stage,"review_required");assert.equal(f.calls(),4);
  assert.equal(publicJob(job).story,null);assert.equal(voiced,false);
});

test("publishes an editorial repair only after a second approval",async(t)=>{
  const f=fixture(t);
  f.responses[3]={approved:false,issues:["Уберите неподтверждённую дату"]};
  f.responses.push(f.responses[2],{approved:true,issues:[]});
  const job=await runJob(f.store.claimNext(),f.options);
  assert.equal(job.stage,"ready");assert.equal(f.calls(),6);assert.equal(job.data.repaired,true);
});

test("finds alternative publishers when initial pages cannot be loaded",async(t)=>{
  const f=fixture(t);let searches=0;
  const originalProvider=f.options.provider;
  f.options.provider={response:async(...args)=>{
    if(args[1].search&&++searches===2)return {value:f.responses[0],citedUrls:f.sources.map(s=>s.url),usage:{}};
    const result=await originalProvider.response(...args);
    if(searches===1&&args[1].search){
      return {...result,value:{sources:[{url:"https://blocked.example/one",title:"Unavailable one"},{url:"https://blocked-two.example/two",title:"Unavailable two"}]},citedUrls:["https://blocked.example/one","https://blocked-two.example/two"]};
    }
    // Alternate sources have stable s6/s7 identifiers.
    if(result.value.facts)return {...result,value:{...result.value,facts:result.value.facts.map(fact=>({...fact,evidence:fact.evidence.map(proof=>({...proof,sourceId:proof.sourceId==="s1"?"s6":"s7"}))}))}};
    return result;
  }};
  const fetchPage=f.options.fetchPage;
  f.options.fetchPage=async(url)=>{if(url.includes("blocked"))throw new Error("unavailable");return fetchPage(url);};
  const job=await runJob(f.store.claimNext(),f.options);
  assert.equal(job.stage,"ready");assert.equal(searches,2);
  assert.deepEqual(job.data.sources.map(s=>s.id),["s6","s7"]);
});
