import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "./server.mjs";
import { createStore } from "./store.mjs";
import { sessionCsrfToken } from "./auth.mjs";

const origin="https://account.test",secret="account-api-test-secret",sessionId="session-1";
const authFor=role=>({api:{getSession:async()=>({user:{id:`${role}-1`,email:`${role}@example.test`,name:role,role},session:{id:sessionId,createdAt:new Date()}})}});

async function listen(t,{role="user",accountStore={},sendAccountCode=async()=>{},store=createStore(":memory:",{maxDaily:20,maxActive:20})}={}){
  const directory=await mkdtemp(join(tmpdir(),"otg-account-api-"));
  const app=createApp({store,provider:{},origin,audioDirectory:directory,workerEnabled:false,auth:authFor(role),authSecret:secret,accountStore,sendAccountCode});
  await new Promise(done=>app.server.listen(0,"127.0.0.1",done));
  const base=`http://127.0.0.1:${app.server.address().port}`;
  t.after(async()=>{await app.close();store.close();await rm(directory,{recursive:true,force:true});});
  return {base,store,headers:{Origin:origin,"Content-Type":"application/json","X-CSRF-Token":sessionCsrfToken(secret,sessionId)}};
}

test("ordinary users cannot use editor API while an editor session can",async t=>{
  const user=await listen(t,{role:"user",accountStore:{}});
  assert.equal((await fetch(user.base+"/api/story-admin/jobs")).status,401);
  const editor=await listen(t,{role:"editor",accountStore:{}});
  assert.equal((await fetch(editor.base+"/api/story-admin/jobs")).status,200);
});

test("account deletion requires the separate emailed code and cancels private research",async t=>{
  let delivered=null,deleted=false,revoked=null;
  const accountStore={issueDeleteCode:()=>"654321",verifyDeleteCode:(_userId,code)=>code==="654321",researchJobIds:()=>["research-1"],deleteAccountData:()=>{deleted=true;}};
  const store=createStore(":memory:",{maxDaily:20,maxActive:20});store.revokeWalkResearchAccess=ids=>{revoked=ids;};
  const f=await listen(t,{accountStore,store,sendAccountCode:async value=>{delivered=value;}});
  assert.equal((await fetch(f.base+"/api/me/delete-code",{method:"POST",headers:f.headers,body:"{}"})).status,200);
  assert.deepEqual(delivered,{email:"user@example.test",otp:"654321",purpose:"delete-account"});
  assert.equal((await fetch(f.base+"/api/me",{method:"DELETE",headers:f.headers,body:JSON.stringify({code:"000000"})})).status,403);assert.equal(deleted,false);
  assert.equal((await fetch(f.base+"/api/me",{method:"DELETE",headers:f.headers,body:JSON.stringify({code:"654321"})})).status,200);
  assert.deepEqual(revoked,["research-1"]);assert.equal(deleted,true);
});

test("a valid legacy recovery token claims a research job for the signed-in user",async t=>{
  const store=createStore(":memory:",{maxDaily:20,maxActive:20}),token="11111111-1111-4111-8111-111111111111";
  const job=store.createWalkResearch({start:{address:"Москва, Арбат, 1",location:{lat:55.75,lon:37.61}},mode:"loop",minutes:30,consent:true,recoveryToken:token});
  let owned=false,attached=null;
  const accountStore={ownsRequest:()=>owned,attachRequest:(userId,jobId,operation,key)=>{owned=true;attached={userId,jobId,operation,key};}};
  const f=await listen(t,{accountStore,store});
  const response=await fetch(`${f.base}/api/walk-research-jobs?lat=55.75&lon=37.61&mode=loop&minutes=30&recoveryToken=${token}`);
  assert.equal(response.status,200);assert.equal((await response.json()).id,job.id);
  assert.deepEqual(attached,{userId:"user-1",jobId:job.id,operation:"walk_research",key:token});
});
