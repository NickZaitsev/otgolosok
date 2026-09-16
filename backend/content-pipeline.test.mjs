import test from "node:test";
import assert from "node:assert/strict";
import { createStore } from "./store.mjs";
import { runContentJob } from "./content-pipeline.mjs";

const catalog={source:"fixture",sourceSha256:"a".repeat(64),rulesVersion:"v1",coverage:"fixture",places:[
  {placeId:"osm:node:1",osmType:"node",osmId:1,name:"Памятник без адреса",location:{lat:55.75,lon:37.61},tags:{historic:"memorial",wikidata:"Q1"}},
]};

test("place pipeline researches an addressless OSM place and waits for editorial approval before audio",async t=>{
  const store=createStore(":memory:",{maxDaily:100,maxActive:100});t.after(()=>store.close());store.importPlaces(catalog);
  const batch=store.createBatch({requestKey:"pipeline-0001",name:"Pilot",limit:1,mode:"text-and-audio",ttsProfile:"silero-ru-v1"});
  const sourceText="Памятник установлен в Москве. Архитектор создал композицию. История места подтверждена архивом. ".repeat(8);
  const sources=[{url:"https://one.example/place",title:"One"},{url:"https://two.example/place",title:"Two"}];
  const facts=Array.from({length:5},(_,index)=>({id:`f${index+1}`,claim:`Подтверждённый факт ${index+1}`,topic:index%2?"architecture":"place_history",scope:"building",location:"Памятник без адреса",distanceMeters:null,interesting:index===0,evidence:[{sourceId:index%2?"s2":"s1",quote:"Памятник установлен в Москве."}]}));
  const paragraph=("Памятник связан с городской историей, а его композиция помогает увидеть работу архитектора и развитие этого места. ").repeat(6).trim();
  const responses=[{sources},{addressConfirmed:true,placeName:"Памятник без адреса",resolvedAddress:"Памятник без адреса, Москва",facts},{title:"История памятника",paragraphs:[{text:paragraph,factIds:["f1","f2","f3"]},{text:paragraph,factIds:["f4","f5"]}]},{approved:true,issues:[]}];
  let call=0;const provider={writerModel:"writer",response:async(_prompt,options)=>({value:responses[call++],citedUrls:options.search?sources.map(s=>s.url):[],model:"test",usage:{}})};
  const result=await runContentJob(store.claimContentJob(),{store,provider,fetchPage:async url=>({url,html:sourceText})});
  assert.equal(result.story.title,"История памятника");assert.equal(store.getBatch(batch.id).counts.ready,1);
  assert.equal(store.listPlaces({status:"ready"}).places.length,0);
  assert.equal(store.claimExternalAudio({workerId:"gpu",requestId:"audio-0000",profileIds:["silero-ru-v1"]}),null);
  const approved=store.approvePlaceText("osm:node:1");
  assert.equal(store.listPlaces({status:"ready"}).places.length,1);
  for(const profileId of approved.audioProfiles)store.enqueueExternalAudio({sourceJobId:`place-text:${approved.text.id}`,sourceRevision:0,story:approved.text.story,profileId});
  const audio=store.claimExternalAudio({workerId:"gpu",requestId:"audio-0001",profileIds:["silero-ru-v1"]});
  assert.equal(audio.spokenText,result.story.paragraphs.map(p=>p.text).join("\n\n"));
});
