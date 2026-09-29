#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createStore } from "./store.mjs";
import { fetchOpenDataset, matchOpenData, OPEN_DATA_DATASETS } from "./open-data.mjs";

// Lives in backend/ so the generator image ships it (docker exec … node import-open-data.mjs --apply …).
// Two steps so the data.mos.ru key never reaches production:
//   --fetch <datasetId> --out <file>   downloads a dataset where DATA_MOS_API_KEY is set (a workstation);
//   --apply <file> [--dry-run]         matches the snapshot to the catalog in DATA_DIR/jobs.sqlite and stores matches.
const argv=process.argv.slice(2),has=flag=>argv.includes(flag),valueAfter=flag=>{const index=argv.indexOf(flag);return index>=0?argv[index+1]:undefined;};
const usage="Usage: node backend/import-open-data.mjs --fetch <2801|60869|530> --out <file> | --apply <file> [--dry-run]";
const fetchId=valueAfter("--fetch"),applyFile=valueAfter("--apply");
if(Boolean(fetchId)===Boolean(applyFile))throw new Error(usage);

if(fetchId){
  const datasetId=Number(fetchId),out=valueAfter("--out");
  if(!OPEN_DATA_DATASETS[datasetId]||!out)throw new Error(usage);
  const snapshot=await fetchOpenDataset(datasetId,{apiKey:process.env.DATA_MOS_API_KEY});
  writeFileSync(resolve(out),JSON.stringify({...snapshot,fetchedAt:new Date().toISOString()}));
  const located=snapshot.records.filter(record=>record.location).length;
  console.log(JSON.stringify({datasetId,datasetVersion:snapshot.datasetVersion,itemsCount:snapshot.itemsCount,records:snapshot.records.length,located,out:resolve(out)},null,2));
} else {
  const snapshot=JSON.parse(readFileSync(resolve(applyFile),"utf8")),dryRun=has("--dry-run");
  if(!OPEN_DATA_DATASETS[snapshot?.datasetId]||!Array.isArray(snapshot.records)||typeof snapshot.datasetVersion!=="string")throw new Error(`${applyFile} is not a snapshot from --fetch`);
  const database=join(resolve(process.env.DATA_DIR??"backend/data"),"jobs.sqlite");
  const db=new DatabaseSync(database,{readOnly:true});
  let places,tiers;
  try {
    places=db.prepare("SELECT id,name,lat,lon,tags_json FROM places WHERE archived=0").all()
      .map(row=>({id:String(row.id),name:String(row.name),location:{lat:Number(row.lat),lon:Number(row.lon)},tags:JSON.parse(String(row.tags_json))}));
    tiers=new Map(db.prepare("SELECT place_id,tier FROM place_identity_candidates").all().map(row=>[String(row.place_id),String(row.tier)]));
  } finally {db.close();}
  const result=matchOpenData(snapshot.records,places);
  const byTier={};for(const item of result.matches){const tier=tiers.get(item.placeId)??"not_triaged";byTier[tier]=(byTier[tier]??0)+1;}
  const summary={datasetId:snapshot.datasetId,datasetVersion:snapshot.datasetVersion,records:snapshot.records.length,places:places.length,
    matched:result.matches.length,unmatched:result.unmatched,ambiguousRecords:result.ambiguousRecords,ambiguousPlaces:result.ambiguousPlaces.length,byTier};
  if(dryRun)console.log(JSON.stringify(summary,null,2));
  else {
    // One short transaction: the generator workers share this SQLite file.
    const store=createStore(database);
    try {console.log(JSON.stringify({...summary,...store.replaceOpenDataMatches(result.matches,{datasetId:snapshot.datasetId,datasetVersion:snapshot.datasetVersion})},null,2));}
    finally {store.close();}
  }
}
