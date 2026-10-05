import test from "node:test";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { cellOf, openFoodIndex } from "./food-places.mjs";
import { etagOf } from "./map-cells.mjs";
import { foodIndexFixture, foodMeta, foodPlace } from "./test-fixtures/food-index.mjs";

const boundaries=[
  [55.75,37.6,1115,752], [0.35,0.35,7,7], [0.34999,0.35001,6,7],
  [-0.35,-0.35,-7,-7], [-0.35001,-0.34999,-8,-7], [-0.00001,0,-1,0],
  [0,0,0,0], [-90,-180,-1800,-3600], [90,180,1799,3599],
];
for(const [lat,lon,latKey,lonKey] of boundaries)test(`food cell boundary ${lat}:${lon}`,()=>{
  assert.deepEqual(cellOf(lat,lon),{lat:latKey,lon:lonKey});
});

test("food coordinate negative zero is canonicalized and 0.15 stays on its exact boundary",()=>{
  assert.deepEqual(cellOf(-0,-0),{lat:0,lon:0});assert.deepEqual(cellOf(0.15,-0.15),{lat:3,lon:-3});
});

for(const [lat,lon] of [[91,0],[-91,0],[0,181],[0,-181],[Infinity,0]])test(`invalid index coordinates ${lat}:${lon} fail startup`,async t=>{
  const path=await foodIndexFixture(t,[{...foodPlace,lat,lon}]);assert.throws(()=>openFoodIndex(path),{code:"FOOD_INDEX_INVALID"});
});

test("food index partitions exact boundaries, keeps all camelCase fields and sorts ids",async t=>{
  const places=boundaries.map(([lat,lon],index)=>({...foodPlace,id:`osm:node:${index}`,lat,lon}));
  places.push({...foodPlace,id:"osm:node:99",lat:0.35,lon:0.35,address:null,openingHours:null,cuisine:null,website:null,phone:null});
  const index=openFoodIndex(await foodIndexFixture(t,[...places].reverse()));t.after(()=>index.close());
  const manifest=JSON.parse(index.manifest());
  assert.deepEqual({...manifest,cells:undefined},{version:1,cellSize:0.05,sourceEditedAt:foodMeta.source_edited_at,attribution:foodMeta.attribution,cells:undefined});
  assert.deepEqual(manifest.cells.map(({lat,lon})=>[lat,lon]),[[-1800,-3600],[-8,-7],[-7,-7],[-1,0],[0,0],[6,7],[7,7],[1115,752],[1799,3599]]);
  const received=[];
  for(const cell of manifest.cells) {
    const body=index.cell(cell.lat,cell.lon),value=JSON.parse(body);
    const expected=places.filter(row=>{const key=cellOf(row.lat,row.lon);return key.lat===cell.lat&&key.lon===cell.lon;}).sort((a,b)=>a.id<b.id?-1:1);
    assert.deepEqual(value,{lat:cell.lat,lon:cell.lon,places:expected});assert.equal(cell.count,expected.length);assert.equal(cell.etag,etagOf(body));
    received.push(...value.places);
  }
  assert.equal(received.length,places.length);assert.equal(new Set(received.map(row=>row.id)).size,places.length);
  assert.deepEqual(JSON.parse(index.cell(-1,-1)),{lat:-1,lon:-1,places:[]});
});

test("food index is a cached immutable snapshot until reopened; close is idempotent",async t=>{
  const path=await foodIndexFixture(t),index=openFoodIndex(path);t.after(()=>index.close());
  const manifest=index.manifest(),cell=index.cell(1115,752);
  const writer=new DatabaseSync(path);
  try { writer.prepare("UPDATE places SET name=?").run("Новое название"); } finally { writer.close(); }
  assert.equal(index.manifest(),manifest);assert.equal(index.cell(1115,752),cell);
  index.close();index.close();
  const reopened=openFoodIndex(path);t.after(()=>reopened.close());
  assert.equal(JSON.parse(reopened.cell(1115,752)).places[0].name,"Новое название");assert.notEqual(reopened.manifest(),manifest);
});

test("empty food index has an empty manifest",async t=>{
  const index=openFoodIndex(await foodIndexFixture(t,[]));t.after(()=>index.close());
  assert.deepEqual(JSON.parse(index.manifest()).cells,[]);assert.deepEqual(JSON.parse(index.cell(0,0)),{lat:0,lon:0,places:[]});
});

for(const [lat,lon] of [[-1801,0],[1800,0],[0,-3601],[0,3600],[0.5,0],[0,Infinity],[-0,0],[0,-0],[NaN,0]])test(`invalid food cell ${lat}:${lon}`,async t=>{
  const index=openFoodIndex(await foodIndexFixture(t));t.after(()=>index.close());
  assert.throws(()=>index.cell(lat,lon),{code:"BAD_REQUEST"});
});

for(const meta of [{format_version:"2"},{format_version:"01"},{source_edited_at:"invalid"},{attribution:""}])test(`invalid food metadata ${JSON.stringify(meta)}`,async t=>{
  const path=await foodIndexFixture(t,[],meta);assert.throws(()=>openFoodIndex(path),{code:"FOOD_INDEX_INVALID"});
});

test("missing food index is disabled; corrupt file and missing schema fail startup",async t=>{
  const path=await foodIndexFixture(t);assert.equal(openFoodIndex(path+".missing"),null);
  const db=new DatabaseSync(path);try { db.exec("DROP TABLE places"); } finally { db.close(); }
  assert.throws(()=>openFoodIndex(path),{code:"FOOD_INDEX_INVALID"});
  await writeFile(path,"not sqlite");assert.throws(()=>openFoodIndex(path),{code:"FOOD_INDEX_INVALID"});
});
