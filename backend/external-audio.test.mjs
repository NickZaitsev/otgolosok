import test from "node:test";
import assert from "node:assert/strict";
import { createStore } from "./store.mjs";

const story={title:"Дом",address:"Москва, дом 1",wordCount:104,paragraphs:[
  {text:("Первый абзац рассказа об истории московского дома и людях, которые были с ним связаны. ").repeat(4).trim(),factIds:["f1","f2","f3"]},
  {text:("Второй абзац продолжает рассказ и описывает архитектурные детали здания и дальнейшую судьбу места. ").repeat(4).trim(),factIds:["f4","f5"]}],verification:"editorial",sources:[],facts:[]};

function fixture(t) {
  let clock=Date.UTC(2026,8,16,12);
  const store=createStore(":memory:",{now:()=>clock,maxActive:20,maxDaily:20,workerLeaseSecret:"test-secret"});
  t.after(()=>store.close());
  const original=store.createOrGet({key:"source",address:"Москва, дом 1"});
  const source=store.update(original.id,{stage:"failed",data:{story}},original.revision);
  const queued=store.enqueueExternalAudio({sourceJobId:source.id,sourceRevision:source.revision,story,profileId:"silero-ru-v1"});
  return {store,source,queued,advance:ms=>clock+=ms};
}

test("external audio claims are exclusive and idempotent",t=>{
  const f=fixture(t);
  const first=f.store.claimExternalAudio({workerId:"gpu-1",requestId:"request-0001",profileIds:["silero-ru-v1"]});
  assert.equal(first.spokenText,story.paragraphs.map(paragraph=>paragraph.text).join("\n\n"));
  assert.deepEqual(f.store.claimExternalAudio({workerId:"gpu-1",requestId:"request-0001",profileIds:["silero-ru-v1"]}),first);
  assert.equal(f.store.claimExternalAudio({workerId:"gpu-2",requestId:"request-0002",profileIds:["silero-ru-v1"]}),null);
  assert.equal(f.store.heartbeatExternalAudio(first.id,{workerId:"gpu-1",generation:first.leaseGeneration,leaseToken:first.leaseToken}).state,"leased");
});

test("expired leases retry and stale workers cannot publish",t=>{
  const f=fixture(t);
  const stale=f.store.claimExternalAudio({workerId:"gpu-1",requestId:"request-0001",profileIds:["silero-ru-v1"],leaseMs:1000});
  f.advance(1001);
  const current=f.store.claimExternalAudio({workerId:"gpu-2",requestId:"request-0002",profileIds:["silero-ru-v1"]});
  assert.equal(current.leaseGeneration,2);
  assert.throws(()=>f.store.acceptExternalAudio(stale.id,{workerId:"gpu-1",generation:stale.leaseGeneration,leaseToken:stale.leaseToken,uploadId:"upload-stale",uploadSha256:"a".repeat(64),artifact:{url:"x"}}),{code:"LEASE_LOST"});
});

test("accepted uploads publish once and duplicate receipts are safe",t=>{
  const f=fixture(t),claim=f.store.claimExternalAudio({workerId:"gpu",requestId:"request-0001",profileIds:["silero-ru-v1"]});
  const artifact={url:`/api/story-audio/${"b".repeat(64)}.mp3`,sha256:"b".repeat(64),bytes:100,durationSec:60,model:"silero",voice:"xenia",provider:"external",synthetic:true};
  const input={workerId:"gpu",generation:claim.leaseGeneration,leaseToken:claim.leaseToken,uploadId:"upload-0001",uploadSha256:"a".repeat(64),artifact};
  const accepted=f.store.acceptExternalAudio(claim.id,input);
  assert.equal(accepted.state,"succeeded");
  assert.deepEqual(f.store.acceptExternalAudio(claim.id,input),accepted);
  assert.deepEqual(f.store.get(f.source.id).data.audio,artifact);
  assert.throws(()=>f.store.acceptExternalAudio(claim.id,{...input,uploadSha256:"c".repeat(64)}),{code:"CONFLICT"});
});

test("worker failures retry without changing the source text",t=>{
  const f=fixture(t),claim=f.store.claimExternalAudio({workerId:"gpu",requestId:"request-0001",profileIds:["silero-ru-v1"]});
  const failed=f.store.failExternalAudio(claim.id,{workerId:"gpu",generation:claim.leaseGeneration,leaseToken:claim.leaseToken,failureId:"failure-0001",code:"SYNTHESIS_FAILED",message:"model error"});
  assert.equal(failed.state,"retry_wait");
  assert.equal(f.store.get(f.source.id).data.story.title,"Дом");
  assert.deepEqual(f.store.failExternalAudio(claim.id,{workerId:"gpu",generation:claim.leaseGeneration,leaseToken:claim.leaseToken,failureId:"failure-0001",code:"SYNTHESIS_FAILED"}),failed);
});
