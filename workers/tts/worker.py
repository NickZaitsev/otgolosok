#!/usr/bin/env python3
"""Pull external audio jobs, synthesize locally, and upload the finished file."""
import argparse, hashlib, json, os, random, re, socket, subprocess, threading, time, urllib.error, urllib.request, uuid, wave
from pathlib import Path

class WorkerApiError(RuntimeError):
    def __init__(self,status,detail):super().__init__(f'worker API {status}: {detail}');self.status=status

DEFAULT_SILERO_SPEAKER='baya'
DEFAULT_SILERO_MODEL_PATH=Path(__file__).resolve().parents[2]/'backend'/'data'/'models'/'silero-v5_5-ru.pt'

class Api:
    def __init__(self, base_url, token, worker_id, attempts=5):
        self.base=base_url.rstrip('/')+'/api/worker/v1';self.token=token;self.worker_id=worker_id;self.attempts=attempts
    def raw(self, method, path, data=None, headers=None, timeout=330):
        request=urllib.request.Request(self.base+path,data=data,method=method,headers={'Authorization':f'Bearer {self.token}','X-Worker-Id':self.worker_id,**(headers or {})})
        for attempt in range(self.attempts):
            try:return urllib.request.urlopen(request,timeout=timeout)
            except urllib.error.HTTPError as error:
                if error.code<500 and error.code not in (408,429):
                    detail=error.read().decode(errors='replace')[:1000];raise WorkerApiError(error.code,detail) from error
                failure=error
            except (urllib.error.URLError,TimeoutError,ConnectionError) as error:failure=error
            if attempt+1<self.attempts:time.sleep(min(20,.5*2**attempt)*random.uniform(.8,1.2))
        raise RuntimeError(f'worker API unavailable: {failure}') from failure
    def request(self, method, path, body=None, headers=None):
        encoded=None if body is None else json.dumps(body).encode()
        with self.raw(method,path,encoded,{**({'Content-Type':'application/json'} if body is not None else {}),**(headers or {})}) as response:
            return None if response.status==204 else json.load(response)
    @staticmethod
    def lease_headers(job):return {'X-Lease-Token':job['leaseToken'],'X-Lease-Generation':str(job['leaseGeneration'])}

class Heartbeat:
    def __init__(self,api,job,interval=30):
        self.api,self.job,self.interval=api,job,interval;self.stop=threading.Event();self.failed=None;self.progress={'stage':'synthesis'};self.thread=threading.Thread(target=self.run,daemon=True)
    def run(self):
        while not self.stop.wait(self.interval):
            try:self.api.request('POST',f'/jobs/{self.job["id"]}/heartbeat',body=self.progress,headers=self.api.lease_headers(self.job))
            except Exception as error:self.failed=error;self.stop.set()
    def check(self):
        if self.failed:raise RuntimeError(f'heartbeat lost: {self.failed}')
    def update(self,stage,percent=None):self.progress={'stage':stage,**({'percent':percent} if percent is not None else {})}
    def __enter__(self):self.thread.start();return self
    def __exit__(self,*_):self.stop.set();self.thread.join(timeout=2)

def chunks(text,maximum=700):
    result=[];current=''
    for sentence in re.split(r'(?<=[.!?…])\s+',text.strip()):
        while len(sentence)>maximum:
            cut=sentence.rfind(' ',0,maximum+1);cut=cut if cut>0 else maximum
            if current:result.append(current);current=''
            result.append(sentence[:cut].strip());sentence=sentence[cut:].strip()
        candidate=f'{current} {sentence}'.strip()
        if current and len(candidate)>maximum:result.append(current);current=sentence
        else:current=candidate
    if current:result.append(current)
    return result

def concatenate_wav(inputs,output):
    params=None
    with wave.open(str(output),'wb') as target:
        for path in inputs:
            with wave.open(str(path),'rb') as source:
                current=source.getparams()[:4]
                if params is None:params=current;target.setparams(source.getparams())
                elif current!=params:raise RuntimeError('Silero chunks produced incompatible WAV formats')
                target.writeframes(source.readframes(source.getnframes()))

def monitored_process(command,heartbeat=None,timeout=300):
    process=subprocess.Popen(command);started=time.monotonic()
    while process.poll() is None:
        if time.monotonic()-started>timeout:process.kill();raise TimeoutError('synthesis timed out')
        if heartbeat:
            try:heartbeat.check()
            except Exception:process.terminate();process.wait(timeout=5);raise
        time.sleep(.25)
    if process.returncode:raise subprocess.CalledProcessError(process.returncode,process.args)

def synthesize_mock(text,output,heartbeat=None):
    duration=max(1,min(150,round(len(text.split())/2.3)))
    monitored_process(['ffmpeg','-v','error','-y','-f','lavfi','-i',f'sine=frequency=440:duration={duration}',str(output)],heartbeat)

def load_silero(model_path,device):
    import torch
    model=torch.package.PackageImporter(model_path).load_pickle('tts_models','model');model.to(device);return model

def load_text_pipeline(device):
    from ru_normalizr import NormalizeOptions, Normalizer
    from silero_stress import load_accentor
    normalizer=Normalizer(NormalizeOptions.tts());accentor=load_accentor();accentor.to(device=device);return normalizer,accentor

def prepare_silero_text(text,normalizer,accentor):
    normalized=normalizer.normalize(text)
    if not normalized.strip():raise RuntimeError('ru-normalizr produced empty text')
    stressed=accentor(normalized)
    if not stressed.strip():raise RuntimeError('Silero Stress produced empty text')
    return silero_compatible(stressed)

def synthesize_silero(text,output,model_path,speaker,device,heartbeat=None,model=None,normalizer=None,accentor=None):
    model=model or load_silero(model_path,device);parts=[];text_parts=chunks(text)
    try:
        for index,part in enumerate(text_parts):
            if heartbeat:heartbeat.check()
            path=output.with_name(f'chunk-{index:04d}.wav');parts.append(path);model.save_wav(text=part,speaker=speaker,sample_rate=48000,audio_path=str(path))
            if heartbeat:heartbeat.update('synthesis',min(95,round((index+1)*100/max(1,len(text_parts)))))
        concatenate_wav(parts,output)
    finally:
        for path in parts:path.unlink(missing_ok=True)

def silero_compatible(text):
    """Replace punctuation unsupported by older Silero text frontends."""
    return (text.replace('\u2013','-').replace('\u2014','-').replace('\u00ab','"').replace('\u00bb','"')
        .replace('\u201c','"').replace('\u201d','"').replace('\u201e','"').replace('\u202f',' ').replace('\u00a0',' '))

def synthesize_f5(text,output,command,heartbeat=None):
    if not command:raise RuntimeError('F5_TTS_COMMAND is required')
    monitored_process([command,'--text',text,'--output',str(output)],heartbeat)

def file_sha256(path):
    digest=hashlib.sha256()
    with path.open('rb') as source:
        for block in iter(lambda:source.read(1024*1024),b''):digest.update(block)
    return digest.hexdigest()

def save_manifest(path,job,output,engine,speaker):
    value={'job':job,'output':str(output),'engine':engine,'speaker':speaker,'uploadId':uuid.uuid4().hex};path.write_text(json.dumps(value,ensure_ascii=False),encoding='utf-8');return value

def upload(api,manifest,value):
    job,output=value['job'],Path(value['output'])
    if not output.is_file():return False
    headers={**api.lease_headers(job),'Content-Type':'audio/wav','X-Upload-Id':value['uploadId'],'X-Content-SHA256':file_sha256(output),'X-TTS-Model':value['engine'],'X-TTS-Voice':value['speaker']}
    with api.raw('PUT',f'/jobs/{job["id"]}/result',output.read_bytes(),headers) as response:json.load(response)
    output.unlink(missing_ok=True);manifest.unlink(missing_ok=True);return True

def discard(manifest,value):
    Path(value.get('output','')).unlink(missing_ok=True);manifest.unlink(missing_ok=True)

def upload_with_recovery(api,manifest,value,attempts=5):
    """Retry the completed local file; client errors abandon this lease without re-synthesis."""
    for attempt in range(attempts):
        try:return upload(api,manifest,value)
        except WorkerApiError as error:
            if error.status in (401,403):raise
            if error.status in (409,413,422):discard(manifest,value);return False
            raise
        except Exception:
            if attempt+1==attempts:raise
            time.sleep(min(60,2**attempt)*random.uniform(.8,1.2))

def reconcile_spool(api,spool):
    for manifest in spool.glob('*.json'):
        try:
            value=json.loads(manifest.read_text(encoding='utf-8'));job=value['job'];status=api.request('GET',f'/jobs/{job["id"]}')['job']
            if status['state']=='succeeded':Path(value['output']).unlink(missing_ok=True);manifest.unlink(missing_ok=True)
            elif status['state']=='leased' and status['leaseGeneration']==job['leaseGeneration']:upload_with_recovery(api,manifest,value)
            elif status['state']!='leased':discard(manifest,value)
        except WorkerApiError as error:
            if error.status in (401,403):raise
        except Exception:continue

def validate_startup(args):
    if args.engine=='silero':
        path=Path(args.model_path)
        if not path.is_file():raise RuntimeError('SILERO_MODEL_PATH must point to a model file')
        actual=file_sha256(path)
        if args.model_sha256 and actual.lower()!=args.model_sha256.lower():raise RuntimeError('Silero model checksum mismatch')
        try:
            import ru_normalizr, silero_stress
        except ImportError as error:raise RuntimeError('ru-normalizr and silero-stress are required for Silero') from error
    if args.engine=='f5' and (not args.f5_command or not Path(args.f5_command).is_file()):raise RuntimeError('F5_TTS_COMMAND must point to an executable')
    subprocess.run(['ffmpeg','-version'],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)

def validate_claim_profile(job,args,configured_profile):
    profile=job.get('profile') or {}
    if profile.get('id')!=configured_profile:raise RuntimeError('server returned a different TTS profile')
    if profile.get('engine') and profile['engine']!=args.engine:raise RuntimeError('worker engine does not match claimed profile')
    expected=profile.get('modelSha256')
    if expected:
        if args.engine!='silero' or file_sha256(Path(args.model_path)).lower()!=expected.lower():raise RuntimeError('claimed model checksum does not match local model')
    if profile.get('speaker') and profile['speaker']!=args.speaker:raise RuntimeError('claimed speaker does not match local speaker')

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--engine',choices=['mock','silero','f5'],default=os.getenv('TTS_ENGINE','mock'));parser.add_argument('--model-path',default=os.getenv('SILERO_MODEL_PATH',str(DEFAULT_SILERO_MODEL_PATH)));parser.add_argument('--model-sha256',default=os.getenv('SILERO_MODEL_SHA256',''));parser.add_argument('--speaker',default=os.getenv('SILERO_SPEAKER',DEFAULT_SILERO_SPEAKER));parser.add_argument('--device',default=os.getenv('WORKER_DEVICE','cpu'));parser.add_argument('--f5-command',default=os.getenv('F5_TTS_COMMAND',''));parser.add_argument('--spool',type=Path,default=Path(os.getenv('WORKER_SPOOL_DIR','.worker-spool')));parser.add_argument('--once',action='store_true');args=parser.parse_args()
    validate_startup(args);model=load_silero(args.model_path,args.device) if args.engine=='silero' else None;normalizer=accentor=None
    if model is not None:
        try:
            import torch
            torch.set_num_threads(max(1,int(os.getenv('SILERO_CPU_THREADS',str(os.cpu_count() or 1)))))
        except (ValueError,RuntimeError):pass
        normalizer,accentor=load_text_pipeline(args.device)
    args.spool.mkdir(parents=True,exist_ok=True);api=Api(os.environ['WORKER_API_URL'],os.environ['WORKER_TOKEN'],os.getenv('WORKER_ID',socket.gethostname()));profile=os.getenv('WORKER_PROFILE_ID','silero-ru-v1');idle=2.
    while True:
        reconcile_spool(api,args.spool)
        try:response=api.request('POST','/claim',{'requestId':uuid.uuid4().hex,'profileIds':[profile],'version':'tts-worker-3'})
        except Exception:
            if args.once:raise
            time.sleep(idle*random.uniform(.8,1.2));idle=min(30,idle*2);continue
        if not response:
            if args.once:return
            time.sleep(10*random.uniform(.8,1.2));continue
        idle=2.;job=response['job'];validate_claim_profile(job,args,profile);output=args.spool/f'{job["id"]}-{job["leaseGeneration"]}.wav';manifest=args.spool/f'{job["id"]}.json';value=save_manifest(manifest,job,output,args.engine,args.speaker)
        try:
            with Heartbeat(api,job) as heartbeat:
                heartbeat.update('synthesis',0)
                if args.engine=='mock':synthesize_mock(job['spokenText'],output,heartbeat)
                elif args.engine=='silero':
                    heartbeat.update('text-preparation',0);prepared=prepare_silero_text(job['spokenText'],normalizer,accentor);heartbeat.update('synthesis',0)
                    synthesize_silero(prepared,output,args.model_path,args.speaker,args.device,heartbeat,model)
                else:synthesize_f5(job['spokenText'],output,args.f5_command,heartbeat)
                heartbeat.check()
                heartbeat.update('upload',100)
            upload_with_recovery(api,manifest,value)
        except WorkerApiError as error:
            if error.status in (401,403):raise
            if error.status in (409,413,422):
                discard(manifest,value)
                if args.once:raise
                continue
            raise
        except Exception as error:
            if output.is_file():
                if args.once:raise
                continue
            try:api.request('POST',f'/jobs/{job["id"]}/fail',{'failureId':uuid.uuid4().hex,'code':'SYNTHESIS_FAILED','message':str(error)},api.lease_headers(job))
            except Exception:pass
            manifest.unlink(missing_ok=True)
            if args.once:raise
        if args.once:return
if __name__=='__main__':main()
