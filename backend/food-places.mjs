import { DatabaseSync } from "node:sqlite";
import { statSync } from "node:fs";
import { cellKey, etagOf } from "./map-cells.mjs";
import { failure } from "./domain.mjs";

export const CELL_SIZE=0.05;
const clamp=(value,min,max)=>Math.min(max,Math.max(min,value))||0;
// Multiplication keeps exact grid boundaries out of floating-point division errors.
export const cellOf=(lat,lon)=>({lat:clamp(Math.floor(lat*20),-1800,1799),lon:clamp(Math.floor(lon*20),-3600,3599)});
export const isCellLat=value=>Number.isSafeInteger(value)&&!Object.is(value,-0)&&value>=-1800&&value<=1799;
export const isCellLon=value=>Number.isSafeInteger(value)&&!Object.is(value,-0)&&value>=-3600&&value<=3599;
const fail=()=>Object.assign(new Error("Не удалось прочитать локальный индекс заведений OSM."),{code:"FOOD_INDEX_INVALID"});
const serialize=(lat,lon,places)=>JSON.stringify({lat,lon,places});

/** Read-only snapshot: occupied cells are serialized once at startup, then SQLite is released. */
export function openFoodIndex(path) {
  try { statSync(path); }
  catch(error) { if(error.code==="ENOENT")return null;throw fail(); }
  let db;
  try {
    db=new DatabaseSync(path,{readOnly:true,timeout:5000});
    const meta=Object.fromEntries(db.prepare("SELECT key,value FROM meta").all().map(row=>[row.key,row.value]));
    if(meta.format_version!=="1"||typeof meta.source_edited_at!=="string"||!Number.isFinite(Date.parse(meta.source_edited_at))||typeof meta.attribution!=="string"||!meta.attribution.trim())throw fail();
    const groups=new Map();
    for(const row of db.prepare("SELECT id,kind,name,lat,lon,address,opening_hours AS openingHours,cuisine,website,phone FROM places ORDER BY id").all()) {
      if(typeof row.lat!=="number"||typeof row.lon!=="number"||!Number.isFinite(row.lat)||!Number.isFinite(row.lon)||Math.abs(row.lat)>90||Math.abs(row.lon)>180)throw fail();
      const cell=cellOf(row.lat,row.lon),key=cellKey(cell);
      if(!groups.has(key))groups.set(key,{...cell,places:[]});
      groups.get(key).places.push(row);
    }
    const bodies=new Map(),cells=[];
    for(const {lat,lon,places} of [...groups.values()].sort((a,b)=>a.lat-b.lat||a.lon-b.lon)) {
      const body=serialize(lat,lon,places);
      bodies.set(cellKey({lat,lon}),body);cells.push({lat,lon,count:places.length,etag:etagOf(body)});
    }
    const manifest=JSON.stringify({version:1,cellSize:CELL_SIZE,sourceEditedAt:meta.source_edited_at,attribution:meta.attribution,cells});
    // Empty cells have client-controlled keys: bound their cache independently of the index.
    const empty=new Map();
    return {
      manifest:()=>manifest,
      cell(lat,lon) {
        if(!isCellLat(lat)||!isCellLon(lon))throw failure("BAD_REQUEST");
        const key=cellKey({lat,lon});
        if(bodies.has(key))return bodies.get(key);
        if(!empty.has(key)) { empty.set(key,serialize(lat,lon,[]));if(empty.size>128)empty.delete(empty.keys().next().value); }
        return empty.get(key);
      },
      close() {},
    };
  } catch { throw fail(); }
  finally { db?.close(); }
}
