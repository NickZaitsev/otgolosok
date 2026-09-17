import test from "node:test";
import assert from "node:assert/strict";
import { createTtsApiClient } from "./tts-api-client.mjs";

test("TTS API client authenticates and preserves idempotency request body",async()=>{
  const calls=[];const fetchImpl=async(url,options)=>{calls.push({url,options});return new Response(JSON.stringify({id:"remote",status:"queued"}),{status:202,headers:{"Content-Type":"application/json"}});};
  const client=createTtsApiClient({baseUrl:"https://tts.example/",token:"secret",fetchImpl});
  const value={requestId:"stable-request",profileId:"f5-ru-v1",text:"Текст"};
  assert.equal((await client.create(value)).id,"remote");
  assert.equal(calls[0].url,"https://tts.example/v1/jobs");assert.equal(calls[0].options.headers.Authorization,"Bearer secret");
  assert.deepEqual(JSON.parse(calls[0].options.body),value);
});

test("TTS API client marks network failures transient and exposes HTTP status",async()=>{
  const network=createTtsApiClient({baseUrl:"https://tts.example",token:"secret",fetchImpl:async()=>{throw new Error("offline");}});
  await assert.rejects(network.profiles(),error=>error.transient===true);
  const denied=createTtsApiClient({baseUrl:"https://tts.example",token:"secret",fetchImpl:async()=>new Response(JSON.stringify({detail:"denied"}),{status:403,headers:{"Content-Type":"application/json"}})});
  await assert.rejects(denied.profiles(),error=>error.status===403&&error.message==="denied");
});
