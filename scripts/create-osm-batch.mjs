#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto";
import { resolve, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createStore } from "../backend/store.mjs";

const args=new Set(process.argv.slice(2)),pilot=args.has("--pilot"),full=args.has("--next");
if(pilot===full)throw new Error("Usage: node scripts/create-osm-batch.mjs <--pilot|--next> [--limit N] [--text-only] [--start]");
const valueAfter=name=>{const index=process.argv.indexOf(name);return index<0?null:process.argv[index+1];};
const limit=Number(valueAfter("--limit")??(pilot?50:5000));
if(!Number.isSafeInteger(limit)||limit<1||limit>5000)throw new Error("--limit must be an integer from 1 to 5000");
const dataDirectory=resolve(process.env.DATA_DIR??"backend/data"),database=join(dataDirectory,"jobs.sqlite"),profile="story-v1";
const requestedState=args.has("--start")?"running":"paused";
const sha256=value=>createHash("sha256").update(value).digest("hex");
const inputKey=row=>sha256(JSON.stringify({placeId:row.id,contentHash:row.content_hash,profile}));
const db=new DatabaseSync(database,{readOnly:true});
const rows=db.prepare("SELECT id,address,tags_json,content_hash FROM places WHERE archived=0 ORDER BY name,id").all();
const queued=new Set(db.prepare("SELECT input_key FROM content_jobs").all().map(row=>row.input_key));db.close();
const available=rows.filter(row=>!queued.has(inputKey(row)));
if(!available.length)throw new Error("All places in this snapshot already have a text job for story-v1");
let selected;
if(full)selected=available.slice(0,limit);
else {
  const buckets=new Map();
  for(const row of available){const tags=JSON.parse(row.tags_json),category=tags.tourism?`tourism:${tags.tourism}`:tags.historic?`historic:${tags.historic}`:tags.leisure?`leisure:${tags.leisure}`:tags.heritage?"heritage":"other";if(!buckets.has(category))buckets.set(category,[]);buckets.get(category).push(row);}
  selected=[];
  const take=predicate=>{const row=available.find(candidate=>!selected.includes(candidate)&&predicate(candidate,JSON.parse(candidate.tags_json)));if(row)selected.push(row);};
  take((row,tags)=>!row.address&&["park","garden"].includes(tags.leisure));
  take((row,tags)=>!row.address&&["memorial","monument"].includes(tags.historic));
  take((_row,tags)=>["park","garden"].includes(tags.leisure));
  take((_row,tags)=>["memorial","monument"].includes(tags.historic));
  for(const list of buckets.values())for(const row of selected){const index=list.indexOf(row);if(index>=0)list.splice(index,1);}
  const lists=[...buckets.values()].sort((a,b)=>a.length-b.length);
  while(selected.length<limit&&lists.some(list=>list.length)){for(const list of lists){if(selected.length>=limit)break;const addressless=list.findIndex(row=>!row.address),index=selected.filter(row=>!row.address).length<Math.ceil(limit/4)&&addressless>=0?addressless:0;if(list.length)selected.push(list.splice(index,1)[0]);}}
}
const store=createStore(database);
try {
  const batch=store.createBatch({requestKey:`${pilot?"pilot":"snapshot"}-${new Date().toISOString()}-${randomUUID()}`,name:`OSM ${pilot?"пилот":"снимок"} · ${new Date().toLocaleString("ru-RU")}`,placeIds:selected.map(row=>row.id),limit:selected.length,textProfile:profile,mode:args.has("--text-only")?"text-only":"text-and-audio",ttsProfile:args.has("--text-only")?null:"silero-ru-v1"});
  const result=requestedState==="paused"?store.setBatchState(batch.id,"paused"):batch;
  console.log(JSON.stringify({...result,addressless:selected.filter(row=>!row.address).length,remaining:available.length-selected.length},null,2));
} finally {store.close();}
