import test from "node:test";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { cellOf, openParkingIndex } from "./parking-places.mjs";
import { etagOf } from "./map-cells.mjs";
import { parkingIndexFixture, parkingMeta, parkingPlace } from "./test-fixtures/parking-index.mjs";

test("parking index exposes immutable cells, lookup, nearby query and status",async t=>{
  const unknown={...parkingPlace,id:"osm:way:3",name:null,location:{lat:55.751,lon:37.621},entrance:{lat:55.7511,lon:37.6211},access:"unknown",fee:null,openingHours:null};
  const far={...parkingPlace,id:"osm:way:4",location:{lat:55.8,lon:37.7},entrance:{lat:55.8001,lon:37.7001}};
  const path=await parkingIndexFixture(t,[far,unknown,parkingPlace]),index=openParkingIndex(path);t.after(()=>index.close());
  const manifest=JSON.parse(index.manifest());
  assert.deepEqual({...manifest,cells:undefined},{version:1,cellSize:0.05,sourceEditedAt:parkingMeta.source_edited_at,attribution:parkingMeta.attribution,cells:undefined});
  assert.deepEqual(index.status(),{count:3,sourceEditedAt:parkingMeta.source_edited_at,attribution:parkingMeta.attribution});
  const key=cellOf(parkingPlace.location.lat,parkingPlace.location.lon),body=index.cell(key.lat,key.lon),cell=JSON.parse(body);
  assert.equal(manifest.cells.find(item=>item.lat===key.lat&&item.lon===key.lon).etag,etagOf(body));
  assert.deepEqual(cell.places.map(place=>place.id),["osm:way:2","osm:way:3"]);
  assert.equal(cell.places[1].name,"Парковка");assert.equal(cell.places[0].fee,true);
  assert.equal(index.byId("osm:way:2").id,"osm:way:2");assert.equal(index.byId("osm:way:999"),null);
  assert.deepEqual(index.nearby({lat:55.75,lon:37.62,radius:1000}).map(place=>place.id),["osm:way:2","osm:way:3"]);
  assert.deepEqual(index.nearby({lat:55.75,lon:37.62,radius:1000,publicOnly:true}).map(place=>place.id),["osm:way:2"]);
  assert.ok(Object.isFrozen(index.byId("osm:way:2")));assert.ok(Object.isFrozen(index.byId("osm:way:2").location));
  assert.throws(()=>{index.byId("osm:way:2").name="Другая";},TypeError);
  assert.deepEqual(JSON.parse(index.cell(-1,-1)),{lat:-1,lon:-1,places:[]});
});

test("parking index validates public queries",async t=>{
  const index=openParkingIndex(await parkingIndexFixture(t));t.after(()=>index.close());
  for(const query of [{lat:91,lon:0,radius:1},{lat:0,lon:181,radius:1},{lat:0,lon:0,radius:0},{lat:0,lon:0,radius:25001},{lat:0,lon:0,radius:1,limit:501},{lat:0,lon:0,radius:1,publicOnly:"yes"}])
    assert.throws(()=>index.nearby(/** @type {any} */ (query)),{code:"BAD_REQUEST"});
  for(const id of [null,"way:1","osm:way:0","osm:way:01","osm:way:<1>"])assert.throws(()=>index.byId(id),{code:"BAD_REQUEST"});
  for(const [lat,lon] of [[-0,0],[0,-0],[1800,0],[0,3600]])assert.throws(()=>index.cell(lat,lon),{code:"BAD_REQUEST"});
});

test("parking index is a cached snapshot and close is idempotent",async t=>{
  const path=await parkingIndexFixture(t),index=openParkingIndex(path);t.after(()=>index.close());
  const before=index.byId(parkingPlace.id);
  const db=new DatabaseSync(path);try{db.prepare("UPDATE places SET name=? WHERE id=?").run("Новое имя",parkingPlace.id);}finally{db.close();}
  assert.equal(index.byId(parkingPlace.id),before);assert.equal(index.byId(parkingPlace.id).name,parkingPlace.name);index.close();index.close();
  const reopened=openParkingIndex(path);t.after(()=>reopened.close());assert.equal(reopened.byId(parkingPlace.id).name,"Новое имя");
});

test("missing parking index is disabled; corrupt index and schema fail",async t=>{
  const valid=await parkingIndexFixture(t);
  assert.equal(openParkingIndex(`${valid}.missing`),null);
  /** @type {Array<[string,(path:string)=>Promise<unknown>]>} */
  const cases=[["bytes",path=>writeFile(path,"not sqlite")],["schema",path=>writeFile(path,"SQLite format 3\0")],["metadata",async path=>{const db=new DatabaseSync(path);try{db.prepare("DELETE FROM meta WHERE key='attribution'").run();}finally{db.close();}}]];
  for(const [name,prepare] of cases){
    const path=await parkingIndexFixture(t);await prepare(path);
    assert.throws(()=>openParkingIndex(path),{code:"PARKING_INDEX_INVALID"},name);
  }
});

test("invalid parking rows fail the whole snapshot",async t=>{
  for(const [column,value] of [["id","bad"],["access","private"],["fee","sometimes"],["lat",91],["entrance_lat",55.9]]){
    const path=await parkingIndexFixture(t),db=new DatabaseSync(path);
    try{db.prepare(`UPDATE places SET ${column}=?`).run(value);}finally{db.close();}
    assert.throws(()=>openParkingIndex(path),{code:"PARKING_INDEX_INVALID"});
  }
});
