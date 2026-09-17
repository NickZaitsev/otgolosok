import { randomUUID } from "node:crypto";
import { ingestPreparedMp3 } from "./audio-ingest.mjs";

const wait=(milliseconds,signal)=>new Promise((resolve,reject)=>{const timer=setTimeout(resolve,milliseconds);signal?.addEventListener("abort",()=>{clearTimeout(timer);reject(signal.reason);},{once:true});});

export function startTtsApiWorker({store,client,audioDirectory,profileId,pollMs=2000,audioIngest=ingestPreparedMp3,logs=null}) {
  let stopped=false,running=null;const controller=new AbortController(),workerId="tts-api-dispatcher";
  const process=async()=>{
    const claim=store.claimExternalAudio({workerId,requestId:randomUUID(),profileIds:[profileId],
      textPreparationVersions:["html-unescape-v1_ru-normalizr-0.3.0_silero-stress-1.5_typography-v1"],leaseMs:300000});
    if(!claim)return;
    const headers={workerId,generation:claim.leaseGeneration,leaseToken:claim.leaseToken};
    try {
      const expected={modelSha256:claim.profile.modelSha256,configSha256:claim.profile.configSha256,
        referenceSha256:claim.profile.referenceSha256,preparationVersion:claim.profile.textPreparation?.version};
      const created=await client.create({requestId:`${claim.id}-${claim.leaseGeneration}`,profileId:claim.profile.id,text:claim.spokenText,expected});
      let remote;
      while(!stopped) {
        remote=await client.get(created.id);
        if(["succeeded","failed","expired"].includes(remote.state))break;
        store.heartbeatExternalAudio(claim.id,{...headers,leaseMs:300000,progress:{stage:"remote-synthesis"}});
        await wait(pollMs,controller.signal);
      }
      if(remote?.state!=="succeeded")throw Object.assign(new Error("remote synthesis failed"),{code:remote?.error?.code??"TTS_API_FAILED"});
      const download=await client.audio(created.id);
      if(download.sha256!==remote.result.sha256)throw Object.assign(new Error("remote checksum mismatch"),{code:"AUDIO_CHECKSUM"});
      store.heartbeatExternalAudio(claim.id,{...headers,leaseMs:300000,progress:{stage:"download"}});
      const accepted=await audioIngest(download.bytes,audioDirectory,{expectedSha256:download.sha256,signal:controller.signal});
      const artifact={...accepted.artifact,model:claim.profile.engine,voice:remote.result.voice,
        preparationVersion:remote.result.preparationVersion,preparedTextSha256:remote.result.preparedTextSha256,
        configSha256:remote.result.configSha256??undefined};
      store.acceptExternalAudio(claim.id,{...headers,uploadId:`remote-${created.id}`,uploadSha256:download.sha256,artifact});
      await client.ack(created.id,download.sha256);
    } catch(error) {
      if(!stopped) {
        try {store.failExternalAudio(claim.id,{...headers,failureId:randomUUID(),code:/^[A-Z_]{1,60}$/.test(error.code??"")?error.code:"TTS_API_FAILED",message:"Remote TTS delivery failed"});} catch {}
        logs?.captureException(error,{operation:"ttsApiWorker",context:{jobId:claim.id}});
      }
    }
  };
  const wake=()=>{if(stopped||running)return;running=process().catch(error=>logs?.captureException(error,{operation:"ttsApiWorker"})).finally(()=>{running=null;});};
  const timer=setInterval(wake,pollMs);wake();
  return {wake,stop:async()=>{stopped=true;clearInterval(timer);controller.abort();await running;}};
}
