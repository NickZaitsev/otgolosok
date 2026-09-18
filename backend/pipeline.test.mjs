import test from "node:test";
import assert from "node:assert/strict";
import { createStore } from "./store.mjs";
import { addressKey, normalizeAddress, publicJob, validateFacts } from "./domain.mjs";
import { runJob } from "./pipeline.mjs";

const paragraph=("Этот московский дом связан с историей города. Архивный источник подтверждает его назначение и важную роль в жизни улицы. ".repeat(3)+"Дом стал заметной частью городской среды, а его история отражает перемены района. Эти сведения позволяют рассказать о месте точно и без вымышленных деталей.").trim();
function fixture(t,{factCount=3}={}){
  const store=createStore(":memory:",{maxDaily:10});t.after(()=>store.close());const address=normalizeAddress("Кожевническая улица, 16");store.createOrGet({key:addressKey(address),address});
  const page="Тестовый дом построен в Москве и связан с городской историей. ".repeat(12),urls=["https://one.example/page"];
  const facts=Array.from({length:factCount},(_,index)=>({claim:`Подтверждённый факт ${index+1}`,topic:"place_history",scope:"building",location:address,distanceMeters:null,evidence:[{sourceId:"s1",quote:"Тестовый дом построен в Москве и связан с городской историей."}]}));
  const queue=[{text:"Источник найден",sources:urls.map(url=>({url,title:"Источник"}))},{value:{addressConfirmed:true,placeName:"Тестовый дом",resolvedAddress:address,facts}}, {text:paragraph},{value:{approved:true,issues:[],paragraphFacts:[{paragraph:1,factIds:["f1","f2","f3"]}]}}];
  const provider={writerModel:"writer",response:async()=>({model:"test",usage:{total_tokens:1},...queue.shift()})};
  const options={store,provider,fetchPage:async url=>({url,contentType:"text/html",html:page}),narrate:async()=>({url:"audio",durationSec:90}),audioDirectory:"unused"};return{store,address,queue,provider,options,page,urls};
}

test("one substantive publisher and three facts can produce a checked story",async t=>{const f=fixture(t);const job=await runJob(f.store.claimNext(),f.options);assert.equal(job.stage,"ready");assert.equal(job.data.story.facts.length,3);assert.equal(job.data.story.paragraphs[0].factIds.length,3);});

test("review rejection gets one rewrite and then stops",async t=>{const f=fixture(t);f.queue[3]={value:{approved:false,issues:["Неподтверждённая дата"],paragraphFacts:[]}};f.queue.push({text:paragraph},{value:{approved:false,issues:["Дата осталась"],paragraphFacts:[]}});let voiced=false;f.options.narrate=async()=>{voiced=true;};const job=await runJob(f.store.claimNext(),f.options);assert.equal(job.stage,"review_required");assert.equal(publicJob(job).story,null);assert.equal(voiced,false);});

test("short supported response becomes description without TTS",async t=>{const f=fixture(t,{factCount:1});const short="Памятник создан в Москве и посвящён важному событию городской истории. Архивный источник подтверждает автора, время создания и первоначальное место установки этой небольшой мемориальной композиции для жителей города и посетителей.";f.queue[2]={text:short};f.queue[3]={value:{approved:true,issues:[],paragraphFacts:[{paragraph:1,factIds:["f1"]}]}};let voiced=false;f.options.narrate=async()=>{voiced=true;};const job=await runJob(f.store.claimNext(),f.options);assert.equal(job.stage,"ready");assert.equal(job.data.story.effectiveProfile,"description-v1");assert.equal(voiced,false);});

test("exact quotes and address identity still fail closed",t=>{const f=fixture(t);assert.throws(()=>validateFacts({addressConfirmed:false},[{id:"s1",publisher:"one",text:f.page}]),{code:"ADDRESS_UNCLEAR"});assert.throws(()=>validateFacts({addressConfirmed:true,placeName:"Дом",resolvedAddress:f.address,facts:[{claim:"Нет",topic:"place_history",scope:"building",location:f.address,evidence:[{sourceId:"s1",quote:"Этой цитаты нет в источнике никогда"}]}]},[{id:"s1",publisher:"one",text:f.page}],{requireEditorialScope:true}),{code:"INSUFFICIENT_EVIDENCE"});});
