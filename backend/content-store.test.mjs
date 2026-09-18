import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createStore } from "./store.mjs";

const catalog={source:"fixture",sourceSha256:"a".repeat(64),rulesVersion:"v1",coverage:"fixture",places:[
  {placeId:"osm:node:1",osmType:"node",osmId:1,name:"Памятник",location:{lat:55.75,lon:37.61},tags:{historic:"memorial",wikidata:"Q1"}},
  {placeId:"osm:way:2",osmType:"way",osmId:2,name:"Музей",location:{lat:55.76,lon:37.62},tags:{tourism:"museum","addr:street":"Арбат","addr:housenumber":"1"}},
]};

test("import retains full and locality addresses without treating a street alone as postal address", t => {
  const store = createStore(":memory:");
  t.after(() => store.close());
  for (const [tags, expected] of [
    [{ "addr:full": "Москва, Арбат, 1" }, "Москва, Арбат, 1"],
    [{ "addr:place": "территория музея", "addr:housenumber": "2" }, "Москва, территория музея, 2"],
    [{ "addr:street": "Арбат" }, null],
  ]) {
    store.importPlaces({ ...catalog, places: [{ ...catalog.places[0], tags }] });
    assert.equal(store.getPlace("osm:node:1").address, expected);
  }
});

test("catalog imports idempotently and batches deduplicate text jobs",t=>{
  const store=createStore(":memory:",{maxDaily:100,maxActive:100});t.after(()=>store.close());
  assert.equal(store.importPlaces(catalog).count,2);store.importPlaces(catalog);
  assert.equal(store.listPlaces().places.length,2);assert.equal(store.getPlace("osm:node:1").address,null);
  assert.deepEqual(store.getPlace("osm:node:1").geometry,{type:"Point",coordinates:[37.61,55.75]});
  const first=store.createBatch({requestKey:"request-0001",name:"Pilot",limit:2});
  const repeated=store.createBatch({requestKey:"request-0001",name:"Ignored",limit:2});
  assert.equal(repeated.id,first.id);assert.equal(first.counts.total,2);
  const second=store.createBatch({requestKey:"request-0002",name:"Second",limit:2});
  assert.equal(second.counts.total,2);
  const job=store.claimContentJob();assert.ok(["Музей","Памятник"].includes(job.place.name));
  store.completeContentJob(job.id,{story:{title:"Музей",paragraphs:[{text:"Текст",factIds:["f1"]}]},evidence:{facts:[]}});
  assert.equal(store.getPlace(job.place.id).text.draft.title,"Музей");assert.equal(store.getPlace(job.place.id).text.story,null);
  assert.equal(store.approvePlaceText(job.place.id).text.verification,"editorial");
  assert.equal(store.getBatch(first.id).counts.ready,1);assert.equal(store.getBatch(second.id).counts.ready,1);
});

test("paused batches are not claimed and interrupted jobs recover",t=>{
  const store=createStore(":memory:",{maxDaily:100,maxActive:100});t.after(()=>store.close());store.importPlaces(catalog);
  const batch=store.createBatch({requestKey:"request-0003",name:"Paused",placeIds:["osm:node:1"],limit:1});
  store.setBatchState(batch.id,"paused");assert.equal(store.claimContentJob(),null);
  store.setBatchState(batch.id,"running");const job=store.claimContentJob();assert.ok(job);
  assert.equal(store.recoverContentJobs(),1);assert.equal(store.getBatch(batch.id).items[0].state,"retry_wait");
  assert.ok(store.retryBatchItem(batch.id,"osm:node:1"));
});

test("batch priority changes claim order without touching active jobs",t=>{
  const store=createStore(":memory:",{maxDaily:100,maxActive:100});t.after(()=>store.close());store.importPlaces(catalog);
  const low=store.createBatch({requestKey:"priority-low",placeIds:["osm:node:1"],limit:1}),high=store.createBatch({requestKey:"priority-high",placeIds:["osm:way:2"],limit:1});
  assert.ok(store.setBatchPriority(high.id,100));assert.equal(store.claimContentJob().place.id,"osm:way:2");assert.equal(store.setBatchPriority("missing",1),null);assert.throws(()=>store.setBatchPriority(low.id,-1),{code:"BAD_REQUEST"});
});

test("a complete import archives absent places while partial imports preserve them",t=>{
  const store=createStore(":memory:");t.after(()=>store.close());store.importPlaces(catalog,{complete:true});
  store.importPlaces({...catalog,sourceSha256:"b".repeat(64),places:[catalog.places[0]]});assert.equal(store.listPlaces().places.length,2);
  store.importPlaces({...catalog,sourceSha256:"c".repeat(64),places:[catalog.places[0]]},{complete:true});assert.equal(store.listPlaces().places.length,1);
});

test("catalog nearby query returns approved cards ordered by distance",t=>{
  const store=createStore(":memory:",{maxDaily:100,maxActive:100});t.after(()=>store.close());store.importPlaces(catalog);
  const batch=store.createBatch({requestKey:"nearby-query",placeIds:["osm:node:1"],limit:1});const job=store.claimContentJob();const story={title:"Готовая история",paragraphs:[{text:"Проверенный текст",factIds:["f1"]}]};
  store.completeContentJob(job.id,{story,evidence:{}});store.approvePlaceText("osm:node:1");
  const nearby=store.listPlaces({status:"ready",lat:55.7501,lon:37.6101,radius:1000});assert.equal(nearby.places[0].id,"osm:node:1");assert.ok(nearby.places[0].distanceM<20);
  assert.equal(store.listPlaces({status:"ready",lat:55.9,lon:37.9,radius:100}).places.length,0);assert.equal(store.getBatch(batch.id).counts.ready,1);
});

test("job migrations add profile versions and priorities to existing databases",t=>{
  const directory=mkdtempSync(join(tmpdir(),"content-migration-")),file=join(directory,"jobs.sqlite");t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const db=new DatabaseSync(file);db.exec(`CREATE TABLE content_jobs (id TEXT PRIMARY KEY,input_key TEXT NOT NULL UNIQUE,place_id TEXT NOT NULL,state TEXT NOT NULL,
    profile TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,max_attempts INTEGER NOT NULL DEFAULT 3,next_attempt_at TEXT NOT NULL,
    checkpoint_json TEXT,error_json TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL)`);db.close();
  const store=createStore(file);store.close();const migrated=new DatabaseSync(file,{readOnly:true});
  const columns=new Set(migrated.prepare("PRAGMA table_info(content_jobs)").all().map(column=>column.name));migrated.close();
  assert.ok(columns.has("profile_version"));assert.ok(columns.has("priority"));
});
