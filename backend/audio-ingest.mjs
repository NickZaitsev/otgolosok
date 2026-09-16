import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { failure, sha256 } from "./domain.mjs";

const exec=promisify(execFile);

export async function ingestAudio(req,directory,{maximumBytes=64*1024*1024,timeoutMs=300000,signal}={}) {
  const type=req.headers["content-type"]?.split(";")[0];
  if(!["audio/wav","audio/x-wav","audio/mpeg","application/octet-stream"].includes(type))throw failure("BAD_AUDIO_TYPE");
  const announced=Number(req.headers["content-length"]??0);
  if(announced&&(!Number.isSafeInteger(announced)||announced<1||announced>maximumBytes))throw failure("AUDIO_TOO_LARGE");
  await mkdir(directory,{recursive:true});
  const nonce=`${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const source=join(directory,`.upload-${nonce}`),output=join(directory,`.encoded-${nonce}.mp3`);
  const deadline=AbortSignal.any([AbortSignal.timeout(timeoutMs),...(signal?[signal]:[])]);
  let size=0;
  const hash=createHash("sha256");
  req.on("data",chunk=>{size+=chunk.length;if(size>maximumBytes)req.destroy(failure("AUDIO_TOO_LARGE"));else hash.update(chunk);});
  try {
    await pipeline(req,createWriteStream(source,{mode:0o600}),{signal:deadline});
    if(!size)throw failure("BAD_AUDIO");
    const uploadSha256=hash.digest("hex");
    await exec("ffmpeg",["-v","error","-nostdin","-y","-protocol_whitelist","file,pipe","-i",source,
      "-af","loudnorm=I=-16:TP=-1.5:LRA=11","-ac","1","-ar","24000","-b:a","64k","-map_metadata","-1",output],
      {timeout:120000,signal:deadline,maxBuffer:16000});
    const measured=await exec("ffprobe",["-v","error","-show_entries","format=duration","-of","json",output],{timeout:15000,signal:deadline,maxBuffer:16000});
    const durationSec=Number(JSON.parse(measured.stdout).format?.duration);
    if(!Number.isFinite(durationSec)||durationSec<=0||durationSec>600)throw failure("AUDIO_DURATION");
    const bytes=await readFile(output),audioSha256=sha256(bytes),finalPath=join(directory,`${audioSha256}.mp3`);
    try {await rename(output,finalPath);} catch(error) {if(!["EEXIST","EPERM"].includes(error.code)||(await stat(finalPath).catch(()=>null))===null)throw error;await rm(output,{force:true});}
    return {uploadSha256,artifact:{url:`/api/story-audio/${audioSha256}.mp3`,sha256:audioSha256,bytes:(await stat(finalPath)).size,
      durationSec,model:"external",voice:"external",provider:"external",synthetic:true}};
  } catch(error) {
    if(["TimeoutError","AbortError"].includes(error?.name))throw failure("TIMEOUT");
    if(error?.code&&String(error.code).startsWith("AUDIO_"))throw error;
    throw failure("BAD_AUDIO");
  } finally {await Promise.all([source,output].map(path=>rm(path,{force:true})));}
}
