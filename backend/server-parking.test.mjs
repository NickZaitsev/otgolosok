import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "./server.mjs";
import { createStore } from "./store.mjs";
import { openParkingIndex } from "./parking-places.mjs";
import { parkingIndexFixture, parkingMeta, parkingPlace } from "./test-fixtures/parking-index.mjs";

async function fixture(t,options={}) {
  const store=createStore(":memory:");
  const app=createApp({store,origin:"https://otgolosok.test",workerEnabled:false,...options});
  await /** @type {Promise<void>} */ (new Promise(done=>app.server.listen(0,"127.0.0.1",done)));
  const base=`http://127.0.0.1:${/** @type {import("node:net").AddressInfo} */ (app.server.address()).port}`;
  t.after(async()=>{await app.close();store.close();});
  return {app,get:(path,init)=>fetch(base+path,init),post:input=>fetch(base+"/api/walk-plan",{method:"POST",headers:{Origin:"https://otgolosok.test","Content-Type":"application/json"},body:JSON.stringify(input)})};
}

test("parking snapshot API exposes metadata, canonical cells, cache validators and HEAD",async t=>{
  const index=openParkingIndex(await parkingIndexFixture(t));
  const f=await fixture(t,{parkingIndex:index});
  const response=await f.get("/api/parking/cells");assert.equal(response.status,200);
  const manifest=/** @type {any} */ (await response.json());assert.equal(manifest.sourceEditedAt,parkingMeta.source_edited_at);assert.equal(manifest.attribution,parkingMeta.attribution);
  const cell=manifest.cells[0],path=`/api/parking/cells/${cell.lat}/${cell.lon}`;
  const received=await f.get(path);assert.deepEqual((/** @type {any} */ (await received.json())).places,[parkingPlace]);
  assert.equal((await f.get(path,{headers:{"If-None-Match":received.headers.get("etag")}})).status,304);
  const head=await f.get(path,{method:"HEAD"});assert.equal(head.status,200);assert.equal(await head.text(),"");
  const empty=await f.get("/api/parking/cells/-1800/-3600");assert.deepEqual(await empty.json(),{lat:-1800,lon:-3600,places:[]});
});

test("parking nearby returns bounded results with source attribution",async t=>{
  const index=openParkingIndex(await parkingIndexFixture(t));const f=await fixture(t,{parkingIndex:index});
  const response=await f.get("/api/parking/near?lat=55.75&lon=37.62&radius=1000");assert.equal(response.status,200);
  assert.deepEqual(await response.json(),{places:[parkingPlace],sourceEditedAt:parkingMeta.source_edited_at,attribution:parkingMeta.attribution});
  assert.deepEqual((/** @type {any} */ (await (await f.get("/api/parking/near?lat=0&lon=0&radius=25000")).json())).places,[]);
});

test("parking API rejects malformed, duplicate, unknown and oversized parameters before availability",async t=>{
  const f=await fixture(t);
  for(const suffix of ["?x=1","/01/2","/-0/2","/1800/0","/0/3600","/1/2/3"])assert.equal((await f.get("/api/parking/cells"+suffix)).status,400,suffix);
  for(const query of ["lat=91&lon=0&radius=100","lat=0&lon=-181&radius=100","lat=0&lon=0&radius=25001","lat=0&lon=0&radius=0","lat=0&lon=0&radius=1e3","lat=0&lon=0&radius=100&lat=1","lat=0&lon=0&radius=100&limit=1","lat=0&lon=0","lat=NaN&lon=0&radius=100"])assert.equal((await f.get("/api/parking/near?"+query)).status,400,query);
  for(const path of ["/api/parking/cells","/api/parking/cells/0/0","/api/parking/near?lat=0&lon=0&radius=100"]) {
    const response=await f.get(path);assert.equal(response.status,503);assert.deepEqual(await response.json(),{error:"PARKING_INDEX_UNAVAILABLE"});
    assert.equal((await f.get(path,{method:"POST"})).status,405);
  }
});

test("parking read failures return a safe error and close participates in shutdown",async t=>{
  let closed=false;
  const index={manifest(){throw new Error("secret path");},close(){closed=true;}};
  const f=await fixture(t,{parkingIndex:index});
  const response=await f.get("/api/parking/cells");assert.equal(response.status,500);assert.doesNotMatch(await response.text(),/secret path/);
  await f.app.close();assert.equal(closed,true);
});

test("walk-plan dispatch keeps legacy walking input and selects car mode explicitly",async t=>{
  const f=await fixture(t,{planWalk:async input=>({planner:"walking",input}),planCarWalk:async input=>({planner:"driving",input})});
  assert.deepEqual(await (await f.post({minutes:60})).json(),{planner:"walking",input:{minutes:60}});
  assert.deepEqual(await (await f.post({travelMode:"walking",minutes:60})).json(),{planner:"walking",input:{minutes:60}});
  assert.deepEqual(await (await f.post({travelMode:"driving",minutes:120})).json(),{planner:"driving",input:{travelMode:"driving",minutes:120}});
  for(const travelMode of ["cycling",null,1]) {
    const response=await f.post({travelMode});assert.equal(response.status,400);assert.equal((/** @type {any} */ (await response.json())).error.code,"WALK_INVALID");
  }
});

test("car planner errors use the public walk-plan failure boundary",async t=>{
  const f=await fixture(t,{planCarWalk:async()=>{throw Object.assign(new Error("secret router"),{code:"WALK_NOT_FOUND"});}});
  const response=await f.post({travelMode:"driving"});assert.equal(response.status,404);
  const value=/** @type {any} */ (await response.json());assert.equal(value.error.code,"WALK_NOT_FOUND");assert.doesNotMatch(JSON.stringify(value),/secret router/);
});
