import test from "node:test";
import assert from "node:assert/strict";
import { createStore } from "./store.mjs";

const catalog={source:"fixture",sourceSha256:"a".repeat(64),rulesVersion:"v1",coverage:"fixture",places:[
  {placeId:"osm:node:1",osmType:"node",osmId:1,name:"Памятник",location:{lat:55.75,lon:37.61},tags:{historic:"memorial",wikidata:"Q1"}},
  {placeId:"osm:way:2",osmType:"way",osmId:2,name:"Музей",location:{lat:55.76,lon:37.62},tags:{tourism:"museum","addr:street":"Арбат","addr:housenumber":"1"}},
]};

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

test("a complete import archives absent places while partial imports preserve them",t=>{
  const store=createStore(":memory:");t.after(()=>store.close());store.importPlaces(catalog,{complete:true});
  store.importPlaces({...catalog,sourceSha256:"b".repeat(64),places:[catalog.places[0]]});assert.equal(store.listPlaces().places.length,2);
  store.importPlaces({...catalog,sourceSha256:"c".repeat(64),places:[catalog.places[0]]},{complete:true});assert.equal(store.listPlaces().places.length,1);
});
