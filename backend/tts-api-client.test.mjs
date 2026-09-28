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
  let networkCalls=0;
  const network=createTtsApiClient({baseUrl:"https://tts.example",token:"secret",retry:{attempts:2,baseMs:0},fetchImpl:async()=>{networkCalls++;throw new Error("offline");}});
  await assert.rejects(network.profiles(),error=>error.transient===true);
  assert.equal(networkCalls,2);
  const denied=createTtsApiClient({baseUrl:"https://tts.example",token:"secret",fetchImpl:async()=>new Response(JSON.stringify({detail:"denied"}),{status:403,headers:{"Content-Type":"application/json"}})});
  await assert.rejects(denied.profiles(),error=>error.status===403&&error.message==="denied");
});

test("TTS API client retries a busy service with the same idempotent request",async()=>{
  const bodies=[];const statuses=[503,429,202];
  const fetchImpl=async(url,options)=>{bodies.push(options.body);const status=statuses.shift();return new Response(JSON.stringify(status===202?{id:"remote"}:{detail:"busy"}),{status,headers:{"Content-Type":"application/json","Retry-After":"0"}});};
  const client=createTtsApiClient({baseUrl:"https://tts.example",token:"secret",fetchImpl,retry:{attempts:3,baseMs:0}});
  assert.equal((await client.create({requestId:"stable-request",profileId:"f5-ru-v1",text:"Текст"})).id,"remote");
  assert.equal(bodies.length,3);assert.equal(new Set(bodies).size,1);
});
