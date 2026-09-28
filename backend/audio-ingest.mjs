import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readdir, readFile, rename, rm, stat, statfs } from "node:fs/promises";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { failure, sha256 } from "./domain.mjs";

const exec=promisify(execFile);
let activeUploads=0;

// Temporary files of uploads and encodings that a crash or kill left behind.
const TEMPORARY=/^(\.upload-.+|\.encoded-.+\.mp3|.+\.source\.tmp|.+\.encoded\.tmp\.mp3|.+\.json\.tmp)$/;

/** Removes abandoned temporary audio files older than `olderThanMs`; returns how many were removed. */
export async function sweepAudioTemporaries(directory,{olderThanMs=60*60*1000,now=Date.now()}={}) {
  let names;
  try {names=await readdir(directory);} catch(error) {if(error.code==="ENOENT")return 0;throw error;}
  let removed=0;
  for(const name of names.filter(name=>TEMPORARY.test(name))) {
    const path=join(directory,name);
    try {
      if(now-(await stat(path)).mtimeMs<olderThanMs)continue;
      await rm(path,{force:true});removed++;
    } catch(error) {if(error.code!=="ENOENT")throw error;}
  }
  return removed;
}

/** @typedef {(file: string, args: string[], options: import("node:child_process").ExecFileOptionsWithStringEncoding) => Promise<{stdout: string}>} ExecImpl */
/** @typedef {(path: string) => Promise<{bavail: number|bigint, bsize: number|bigint}>} StatfsImpl */

/**
 * @param {import("node:stream").Readable & {headers: import("node:http").IncomingHttpHeaders}} req
 * @param {string} directory
 * @param {{maximumBytes?: number, timeoutMs?: number, signal?: AbortSignal, maximumConcurrent?: number, minimumFreeBytes?: number,
 *   expectedUploadSha256?: string, execImpl?: ExecImpl, statfsImpl?: StatfsImpl}} [options]
 */
export async function ingestAudio(req,directory,{maximumBytes=64*1024*1024,timeoutMs=300000,signal,maximumConcurrent=2,minimumFreeBytes=128*1024*1024,expectedUploadSha256,execImpl=exec,statfsImpl=statfs}={}) {
  if(activeUploads>=maximumConcurrent)throw failure("UPLOAD_BUSY");activeUploads++;
  const nonce=`${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const source=join(directory,`.upload-${nonce}`),output=join(directory,`.encoded-${nonce}.mp3`);
  try {
    const type=req.headers["content-type"]?.split(";")[0];
    if(!["audio/wav","audio/x-wav","audio/mpeg","application/octet-stream"].includes(type))throw failure("BAD_AUDIO_TYPE");
    const announced=Number(req.headers["content-length"]??0);
    if(announced&&(!Number.isSafeInteger(announced)||announced<1||announced>maximumBytes))throw failure("AUDIO_TOO_LARGE");
    await mkdir(directory,{recursive:true});
    const filesystem=await statfsImpl(directory);if(Number(filesystem.bavail)*Number(filesystem.bsize)<minimumFreeBytes+Math.max(announced,maximumBytes))throw failure("AUDIO_STORAGE_FULL");
    const deadline=AbortSignal.any([AbortSignal.timeout(timeoutMs),...(signal?[signal]:[])]);
    let size=0;const hash=createHash("sha256");
    req.on("data",chunk=>{size+=chunk.length;if(size>maximumBytes)req.destroy(failure("AUDIO_TOO_LARGE"));else hash.update(chunk);});
    await pipeline(req,createWriteStream(source,{mode:0o600}),{signal:deadline});
    if(!size)throw failure("BAD_AUDIO");
    const uploadSha256=hash.digest("hex");
    if(expectedUploadSha256!==undefined&&(!/^[a-f0-9]{64}$/.test(expectedUploadSha256)||uploadSha256!==expectedUploadSha256))throw failure("AUDIO_CHECKSUM");
    await execImpl("ffmpeg",["-v","error","-nostdin","-y","-protocol_whitelist","file,pipe","-i",source,
      "-af","loudnorm=I=-16:TP=-1.5:LRA=11","-ac","1","-ar","24000","-b:a","64k","-map_metadata","-1",output],
      {timeout:120000,signal:deadline,maxBuffer:16000});
    const measured=await execImpl("ffprobe",["-v","error","-show_entries","format=duration","-of","json",output],{timeout:15000,signal:deadline,maxBuffer:16000});
    const durationSec=Number(JSON.parse(measured.stdout).format?.duration);
    if(!Number.isFinite(durationSec)||durationSec<=0||durationSec>600)throw failure("AUDIO_DURATION");
    const bytes=await readFile(output),audioSha256=sha256(bytes),finalPath=join(directory,`${audioSha256}.mp3`);
    try {await rename(output,finalPath);} catch(error) {if(!["EEXIST","EPERM"].includes(error.code)||(await stat(finalPath).catch(()=>null))===null)throw error;await rm(output,{force:true});}
    return {uploadSha256,artifact:{url:`/api/story-audio/${audioSha256}.mp3`,sha256:audioSha256,bytes:(await stat(finalPath)).size,
      durationSec,model:"external",voice:"external",provider:"external",synthetic:true}};
  } catch(error) {
    if(["TimeoutError","AbortError"].includes(error?.name))throw failure("TIMEOUT");
    if(error?.code&&(String(error.code).startsWith("AUDIO_")||String(error.code).startsWith("BAD_AUDIO")))throw error;
    throw failure("BAD_AUDIO");
  } finally {activeUploads--;await Promise.all([source,output].map(path=>rm(path,{force:true})));}
}

/**
 * @param {Buffer} bytes
 * @param {string} directory
 * @param {{expectedSha256?: string, maximumBytes?: number, timeoutMs?: number, signal?: AbortSignal, minimumFreeBytes?: number,
 *   execImpl?: ExecImpl, statfsImpl?: StatfsImpl}} [options]
 */
export async function ingestPreparedMp3(bytes,directory,{expectedSha256,maximumBytes=64*1024*1024,timeoutMs=120000,
  signal,minimumFreeBytes=128*1024*1024,execImpl=exec,statfsImpl=statfs}={}) {
  if(!Buffer.isBuffer(bytes)||!bytes.length||bytes.length>maximumBytes)throw failure("AUDIO_TOO_LARGE");
  if(expectedSha256&&sha256(bytes)!==expectedSha256)throw failure("AUDIO_CHECKSUM");
  await mkdir(directory,{recursive:true});
  const filesystem=await statfsImpl(directory);
  if(Number(filesystem.bavail)*Number(filesystem.bsize)<minimumFreeBytes+bytes.length)throw failure("AUDIO_STORAGE_FULL");
  const nonce=`${Date.now()}-${Math.random().toString(16).slice(2)}`,source=join(directory,`.prepared-${nonce}.mp3`);
  const deadline=AbortSignal.any([AbortSignal.timeout(timeoutMs),...(signal?[signal]:[])]);
  try {
    await (await import("node:fs/promises")).writeFile(source,bytes,{mode:0o600,signal:deadline});
    const probe=await execImpl("ffprobe",["-v","error","-show_entries","stream=codec_name,channels,sample_rate:format=duration","-of","json",source],
      {timeout:15000,signal:deadline,maxBuffer:16000});
    const value=JSON.parse(probe.stdout),streams=value.streams??[],durationSec=Number(value.format?.duration);
    if(streams.length!==1||streams[0].codec_name!=="mp3"||Number(streams[0].channels)!==1||Number(streams[0].sample_rate)!==24000)throw failure("BAD_AUDIO");
    if(!Number.isFinite(durationSec)||durationSec<=0||durationSec>600)throw failure("AUDIO_DURATION");
    await execImpl("ffmpeg",["-v","error","-nostdin","-i",source,"-f","null","-"],{timeout:timeoutMs,signal:deadline,maxBuffer:16000});
    const audioSha256=sha256(bytes),finalPath=join(directory,`${audioSha256}.mp3`);
    try {await rename(source,finalPath);} catch(error) {if(!["EEXIST","EPERM"].includes(error.code)||(await stat(finalPath).catch(()=>null))===null)throw error;}
    return {uploadSha256:audioSha256,artifact:{url:`/api/story-audio/${audioSha256}.mp3`,sha256:audioSha256,bytes:bytes.length,
      durationSec,model:"external",voice:"external",provider:"external",synthetic:true}};
  } catch(error) {
    if(["TimeoutError","AbortError"].includes(error?.name))throw failure("TIMEOUT");
    if(error?.code&&(String(error.code).startsWith("AUDIO_")||String(error.code).startsWith("BAD_AUDIO")))throw error;
    throw failure("BAD_AUDIO");
  } finally {await rm(source,{force:true});}
}
