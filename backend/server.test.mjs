import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp,writeFile,rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStore } from "./store.mjs";
import { createApp } from "./server.mjs";

async function fixture(t,options={}) {
  const directory=await mkdtemp(join(tmpdir(),"story-api-"));
  const store=createStore(":memory:",{maxDaily:1});
  const accountStore=options.accountStore??{attachRequest(){},ownsRequest(){return true;}};
  const auth=options.auth??{api:{getSession:async()=>({user:{id:"test-user",email:"test@example.test",name:"Test"}})}};
  const app=createApp({store,provider:{},origin:"https://otgolosok.test",audioDirectory:directory,workerEnabled:false,auth,accountStore,...options});
  await new Promise(done=>app.server.listen(0,"127.0.0.1",done));
  const base=`http://127.0.0.1:${app.server.address().port}`;
  t.after(async()=>{await app.close();store.close();await rm(directory,{recursive:true,force:true});});
  const post=(path,value,origin="https://otgolosok.test")=>fetch(base+path,{method:"POST",headers:{Origin:origin,"Content-Type":"application/json"},body:JSON.stringify(path==="/api/story-jobs"?{...value,idempotencyKey:crypto.randomUUID()}:value)});
  return {base,post,directory,store};
}

test("validates origins and address shape before allocating a job",async(t)=>{
  const f=await fixture(t);
  assert.equal((await f.post("/api/story-jobs",{address:"Улица 16"},"https://other.test")).status,403);
  assert.equal((await f.post("/api/story-jobs",{address:"Улица 16",lat:55.1})).status,400);
  assert.equal((await f.post("/api/story-jobs",{address:""})).status,400);
});

test("duplicate POST reuses an ID and GET exposes no internal research or credentials",async(t)=>{
  const f=await fixture(t);
  const first=await (await f.post("/api/story-jobs",{address:"Кожевническая улица, 16"})).json();
  const second=await (await f.post("/api/story-jobs",{address:"Кожевническая улица, 16"})).json();
  assert.equal(first.id,second.id);
  const record=f.store.get(first.id);f.store.update(record.id,{stage:"ready",data:{sources:[{text:"internal"}],usage:[{tokens:100}]}},record.revision);
  const response=await fetch(`${f.base}/api/story-jobs/${first.id}`);const publicValue=await response.json();
  assert.equal(publicValue.data,undefined);assert.equal(publicValue.sources,undefined);assert.equal(response.headers.get("cache-control"),"no-store");
  assert.equal((await f.post("/api/story-jobs",{address:"Кожевническая улица, 18"})).status,429);
});

test("serves complete and partial audio and rejects traversal or invalid range",async(t)=>{
  const f=await fixture(t);const name="a".repeat(64)+".mp3";
  await writeFile(join(f.directory,name),"0123456789");
  const response=await fetch(`${f.base}/api/story-audio/${name}`,{headers:{Range:"bytes=2-5"}});
  assert.equal(response.status,206);assert.equal(await response.text(),"2345");assert.equal(response.headers.get("content-range"),"bytes 2-5/10");
  assert.equal((await fetch(`${f.base}/api/story-audio/${name}`,{headers:{Range:"bytes=10-"}})).status,416);
  assert.equal((await fetch(`${f.base}/api/story-audio/%2e%2e/server.mjs`)).status,404);
});

test("external worker API authenticates, leases and accepts an idempotent upload",async(t)=>{
  const artifact={url:`/api/story-audio/${"b".repeat(64)}.mp3`,sha256:"b".repeat(64),bytes:100,durationSec:60,model:"external",voice:"external",provider:"external",synthetic:true};
  const f=await fixture(t,{workerToken:"worker-secret",audioIngest:async req=>{
    const chunks=[];for await(const chunk of req)chunks.push(chunk);
    return {uploadSha256:"a".repeat(64),artifact};
  }});
  const story={title:"Дом",address:"Москва, дом 1",wordCount:104,paragraphs:[
    {text:("Первый абзац рассказа об истории московского дома и людях. ").repeat(7),factIds:["f1","f2","f3"]},
    {text:("Второй абзац описывает архитектурные детали и судьбу места. ").repeat(7),factIds:["f4","f5"]}],verification:"editorial",sources:[],facts:[]};
  const source=f.store.createOrGet({key:"external-source",address:story.address});
  const ready=f.store.update(source.id,{stage:"failed",data:{story}},source.revision);
  f.store.enqueueExternalAudio({sourceJobId:ready.id,sourceRevision:ready.revision,story,profileId:"silero-ru-v1"});
  assert.equal((await fetch(f.base+"/api/worker/v1/claim",{method:"POST"})).status,401);
  const headers={Authorization:"Bearer worker-secret","X-Worker-Id":"gpu-1","Content-Type":"application/json"};
  const claim=await (await fetch(f.base+"/api/worker/v1/claim",{method:"POST",headers,body:JSON.stringify({requestId:"request-0001",profileIds:["silero-ru-v1"]})})).json();
  const lease={...headers,"X-Lease-Token":claim.job.leaseToken,"X-Lease-Generation":String(claim.job.leaseGeneration),"X-Upload-Id":"upload-0001","X-Content-SHA256":"a".repeat(64),"Content-Type":"audio/wav"};
  const uploaded=await fetch(`${f.base}/api/worker/v1/jobs/${claim.job.id}/result`,{method:"PUT",headers:lease,body:"wave"});
  assert.equal(uploaded.status,200);assert.equal((await uploaded.json()).job.state,"succeeded");
  assert.deepEqual(f.store.get(ready.id).data.audio,artifact);
  const repeated=await fetch(`${f.base}/api/worker/v1/jobs/${claim.job.id}/result`,{method:"PUT",headers:lease,body:"wave"});
  assert.equal(repeated.status,200);
});

test("place lookup has no generation side effect and reports bounded errors",async(t)=>{
  const inputs=[];
  const f=await fixture(t,{resolvePlace:async input=>{inputs.push(input);if(input.q==='busy')throw Object.assign(new Error('private'),{code:'PLACE_BUSY'});return {address:'Москва, Арбат, 10',location:{lat:55.75,lon:37.6}};}});
  const response=await fetch(f.base+'/api/story-place?lat=55.75&lon=37.6');
  assert.equal(response.status,200);assert.deepEqual(inputs[0],{lat:55.75,lon:37.6});
  const busy=await fetch(f.base+'/api/story-place?q=busy');assert.equal(busy.status,429);assert.equal(busy.headers.get('retry-after'),'2');assert.equal((await busy.text()).includes('private'),false);
  assert.equal((await fetch(f.base+'/api/story-place?q=one&q=two')).status,400);
  // The one-job daily allowance is untouched by address lookup.
  assert.equal((await f.post('/api/story-jobs',{address:'Москва, Арбат, 10'})).status,200);
});

test('walk planning is independent of story provider and protected by origin',async(t)=>{
  const inputs=[];const result={stops:[],geometry:[],distanceM:100,walkingMinutes:2,attribution:'test'};
  const f=await fixture(t,{provider:null,planWalk:async input=>{inputs.push(input);return result;}});
  const input={start:{address:'Москва, Арбат, 1',location:{lat:55.75,lon:37.6}},mode:'loop',minutes:30};
  assert.equal((await f.post('/api/walk-plan',input,'https://evil.test')).status,403);
  assert.equal((await fetch(f.base+'/api/walk-plan',{method:'POST',headers:{Origin:'https://otgolosok.test','Sec-Fetch-Site':'cross-site','Content-Type':'application/json'},body:JSON.stringify(input)})).status,403);
  assert.equal(inputs.length,0);
  const response=await f.post('/api/walk-plan',input);
  assert.equal(response.status,200);assert.deepEqual(await response.json(),result);assert.deepEqual(inputs,[input]);
  assert.equal((await f.post('/api/story-jobs',{address:'Москва, Арбат, 1'})).status,503);
});

test('walk errors are sanitized and walk-only body allowance is bounded',async(t)=>{
  let calls=0;
  const f=await fixture(t,{planWalk:async input=>{calls++;if(input.code)throw Object.assign(new Error('secret'),{code:input.code});return {};}});
  for(const [code,status] of [['WALK_INVALID',400],['WALK_BUSY',429],['WALK_NOT_FOUND',404],['WALK_STOPS_NOT_FOUND',404],['WALK_DISCOVERY_UNAVAILABLE',503],['WALK_UNAVAILABLE',503],['PRIVATE_ERROR',503]]) {
    const res=await f.post('/api/walk-plan',{code});assert.equal(res.status,status);assert.equal((await res.text()).includes('secret'),false);
    if(status===429)assert.equal(res.headers.get('retry-after'),'2');
  }
  assert.equal((await f.post('/api/walk-plan',{text:'я'.repeat(2000)})).status,200);
  const before=calls;
  assert.equal((await f.post('/api/walk-plan',{text:'x'.repeat(8200)})).status,400);assert.equal(calls,before);
  assert.equal((await f.post('/api/story-jobs',{address:'x'.repeat(2100)})).status,400);
  const malformed=await fetch(f.base+'/api/walk-plan',{method:'POST',headers:{Origin:'https://otgolosok.test','Content-Type':'application/json'},body:'{'});
  assert.equal(malformed.status,400);assert.equal((await malformed.json()).error.code,'WALK_INVALID');
});
