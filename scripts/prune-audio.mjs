#!/usr/bin/env node
import { readdir,rm,stat } from "node:fs/promises";
import { resolve,join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const directory=resolve(process.env.DATA_DIR??"backend/data"),audio=join(directory,"audio");
const db=new DatabaseSync(join(directory,"jobs.sqlite"),{readOnly:true});
const referenced=new Set();
for(const row of db.prepare("SELECT record_json FROM jobs").all()){const record=JSON.parse(row.record_json);for(const item of [record.data?.audio,record.data?.revoice?.previousAudio])if(item?.sha256)referenced.add(`${item.sha256}.mp3`);}
if(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='place_texts'").get())for(const row of db.prepare("SELECT audio_json FROM place_texts WHERE audio_json IS NOT NULL").all()){const item=JSON.parse(row.audio_json);if(item.sha256)referenced.add(`${item.sha256}.mp3`);}
if(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='audio_artifacts'").get())for(const row of db.prepare(`SELECT a.sha256 FROM audio_artifacts a JOIN external_audio_jobs j ON j.id=a.job_id WHERE j.state<>'succeeded'`).all())if(row.sha256)referenced.add(`${row.sha256}.mp3`);
db.close();let removed=0;const cutoff=Date.now()-7*86400000;
for(const name of await readdir(audio).catch(()=>[])){if(!/^[a-f0-9]{64}\.mp3$/.test(name)||referenced.has(name))continue;const path=join(audio,name);if((await stat(path)).mtimeMs<cutoff){await rm(path);removed++;}}
console.log(`Referenced ${referenced.size}; removed ${removed} orphaned audio files older than 7 days.`);
