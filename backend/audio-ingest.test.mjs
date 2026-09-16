import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { mkdtemp,readFile,rm,writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ingestAudio } from "./audio-ingest.mjs";

const exec=promisify(execFile);

function request(bytes,type="audio/wav") {const stream=Readable.from([bytes]);stream.headers={"content-type":type,"content-length":String(bytes.length)};return stream;}

test("audio ingestion hashes upload, probes duration and atomically publishes MP3",async t=>{
  const directory=await mkdtemp(join(tmpdir(),"audio-ingest-"));t.after(()=>rm(directory,{recursive:true,force:true}));
  const execImpl=async(command,args)=>{if(command==="ffmpeg"){await writeFile(args.at(-1),Buffer.from("mp3-output"));return{stdout:""};}return{stdout:JSON.stringify({format:{duration:"61.5"}})};};
  const result=await ingestAudio(request(Buffer.from("wav-input")),directory,{execImpl});
  assert.equal(result.artifact.durationSec,61.5);assert.deepEqual(await readFile(join(directory,`${result.artifact.sha256}.mp3`)),Buffer.from("mp3-output"));
  assert.equal((await (await import("node:fs/promises")).readdir(directory)).some(name=>name.startsWith(".upload-")),false);
});

test("audio ingestion rejects size, type, corrupt probe and overlong output",async t=>{
  const directory=await mkdtemp(join(tmpdir(),"audio-ingest-errors-"));t.after(()=>rm(directory,{recursive:true,force:true}));
  await assert.rejects(ingestAudio(request(Buffer.from("x"),"text/plain"),directory),{code:"BAD_AUDIO_TYPE"});
  await assert.rejects(ingestAudio(request(Buffer.alloc(5)),directory,{maximumBytes:4}),{code:"AUDIO_TOO_LARGE"});
  const execImpl=async(command,args)=>{if(command==="ffmpeg"){await writeFile(args.at(-1),"x");return{stdout:""};}return{stdout:JSON.stringify({format:{duration:"601"}})};};
  await assert.rejects(ingestAudio(request(Buffer.from("wav")),directory,{execImpl}),{code:"AUDIO_DURATION"});
});

test("audio ingestion bounds concurrent uploads",async t=>{
  const directory=await mkdtemp(join(tmpdir(),"audio-ingest-busy-"));t.after(()=>rm(directory,{recursive:true,force:true}));let release;
  const waiting=new Promise(resolve=>{release=resolve;});const execImpl=async(command,args)=>{if(command==="ffmpeg"){await waiting;await writeFile(args.at(-1),"x");return{stdout:""};}return{stdout:JSON.stringify({format:{duration:"10"}})};};
  const first=ingestAudio(request(Buffer.from("one")),directory,{execImpl,maximumConcurrent:1});await new Promise(resolve=>setTimeout(resolve,20));
  await assert.rejects(ingestAudio(request(Buffer.from("two")),directory,{execImpl,maximumConcurrent:1}),{code:"UPLOAD_BUSY"});release();await first;
});

test("audio ingestion refuses uploads when the volume has no safe free-space margin",async t=>{
  const directory=await mkdtemp(join(tmpdir(),"audio-ingest-space-"));t.after(()=>rm(directory,{recursive:true,force:true}));
  await assert.rejects(ingestAudio(request(Buffer.from("wav")),directory,{statfsImpl:async()=>({bavail:1,bsize:1})}),{code:"AUDIO_STORAGE_FULL"});
});

test("real FFmpeg converts a valid WAV to a probeable MP3",async t=>{
  try {await exec("ffmpeg",["-version"],{timeout:5000});} catch {t.skip("ffmpeg is not installed");return;}
  const directory=await mkdtemp(join(tmpdir(),"audio-ingest-real-"));t.after(()=>rm(directory,{recursive:true,force:true}));const wav=join(directory,"fixture.wav");
  await exec("ffmpeg",["-v","error","-nostdin","-y","-f","lavfi","-i","sine=frequency=440:duration=1","-ac","1","-ar","24000",wav],{timeout:15000});
  const bytes=await readFile(wav),result=await ingestAudio(request(bytes),directory);assert.ok(result.artifact.bytes>0);assert.ok(result.artifact.durationSec>.9&&result.artifact.durationSec<1.1);
  const probe=await exec("ffprobe",["-v","error","-show_entries","format=format_name","-of","default=nw=1:nk=1",join(directory,`${result.artifact.sha256}.mp3`)],{timeout:5000});assert.match(probe.stdout,/mp3/);
});
