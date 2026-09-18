#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { resolve, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createStore } from "../backend/store.mjs";
import { loadLocalTtsConfig } from "../backend/local-tts.mjs";
import { assessPlaceEligibility, CONTENT_PROFILE_VERSION } from "../backend/place-eligibility.mjs";
import { sha256 } from "../backend/domain.mjs";

const args=new Set(process.argv.slice(2)),pilot=args.has("--pilot"),full=args.has("--next"),dryRun=args.has("--dry-run");
if(pilot===full)throw new Error("Usage: node scripts/create-osm-batch.mjs <--pilot|--next> [--limit N] [--text-only] [--start]");
const valueAfter=name=>{const index=process.argv.indexOf(name);return index<0?null:process.argv[index+1];};
const limit=Number(valueAfter("--limit")??(pilot?50:5000));
if(!Number.isSafeInteger(limit)||limit<1||limit>5000)throw new Error("--limit must be an integer from 1 to 5000");
const dataDirectory=resolve(process.env.DATA_DIR??"backend/data"),database=join(dataDirectory,"jobs.sqlite"),profile="story-v1";
const requestedState=args.has("--start")?"running":"paused";
const localTts=loadLocalTtsConfig(process.env);
const inputKey=row=>sha256(JSON.stringify({placeId:row.id,contentHash:row.content_hash,profile,profileVersion:CONTENT_PROFILE_VERSION}));
const db=new DatabaseSync(database,{readOnly:true});
const rows=db.prepare("SELECT id,name,address,lat,lon,tags_json,content_hash FROM places WHERE archived=0 ORDER BY name,id").all();
const queued=new Set(db.prepare("SELECT input_key FROM content_jobs").all().map(row=>row.input_key));db.close();
const assessed=rows.map(row=>{const tags=JSON.parse(row.tags_json),assessment=assessPlaceEligibility({name:row.name,address:row.address,location:{lat:row.lat,lon:row.lon},tags});return{...row,tags,assessment};});
const skipped=assessed.filter(row=>!row.assessment.eligible),available=assessed.filter(row=>row.assessment.eligible&&!queued.has(inputKey(row)));
if(!available.length)throw new Error("All places in this snapshot already have a text job for story-v1");
let selected;
if(full)selected=available.slice(0,limit);
else {
  const buckets=new Map();
  for(const row of available){const tags=row.tags,category=tags.tourism?`tourism:${tags.tourism}`:tags.historic?`historic:${tags.historic}`:tags.leisure?`leisure:${tags.leisure}`:tags.heritage?"heritage":"other";if(!buckets.has(category))buckets.set(category,[]);buckets.get(category).push(row);}
  selected=[];
  const take=predicate=>{if(selected.length>=limit)return;const row=available.find(candidate=>!selected.includes(candidate)&&predicate(candidate,candidate.tags));if(row)selected.push(row);};
  take((row,tags)=>!row.address&&["park","garden"].includes(tags.leisure));
  take((row,tags)=>!row.address&&["memorial","monument"].includes(tags.historic));
  take((_row,tags)=>["park","garden"].includes(tags.leisure));
  take((_row,tags)=>["memorial","monument"].includes(tags.historic));
  for(const list of buckets.values())for(const row of selected){const index=list.indexOf(row);if(index>=0)list.splice(index,1);}
  const lists=[...buckets.values()].sort((a,b)=>a.length-b.length);
  while(selected.length<limit&&lists.some(list=>list.length)){for(const list of lists){if(selected.length>=limit)break;const addressless=list.findIndex(row=>!row.address),index=selected.filter(row=>!row.address).length<Math.ceil(limit/4)&&addressless>=0?addressless:0;if(list.length)selected.push(list.splice(index,1)[0]);}}
}
if(dryRun){console.log(JSON.stringify({selected:selected.map(row=>({id:row.id,name:row.name,signals:row.assessment.signals})),skipped:skipped.map(row=>({id:row.id,name:row.name,reasons:row.assessment.reasons}))},null,2));process.exit(0);}
const store=createStore(database);
try {
  const batch=store.createBatch({requestKey:`${pilot?"pilot":"snapshot"}-${new Date().toISOString()}-${randomUUID()}`,name:`OSM ${pilot?"пилот":"снимок"} · ${new Date().toLocaleString("ru-RU")}`,placeIds:selected.map(row=>row.id),limit:selected.length,textProfile:profile,mode:args.has("--text-only")?"text-only":"text-and-audio",ttsProfile:args.has("--text-only")?null:localTts.defaultProfile});
  const result=requestedState==="paused"?store.setBatchState(batch.id,"paused"):batch;
  console.log(JSON.stringify({...result,addressless:selected.filter(row=>!row.address).length,remaining:available.length-selected.length},null,2));
} finally {store.close();}
