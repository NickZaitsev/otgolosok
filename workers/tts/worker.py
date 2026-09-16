#!/usr/bin/env python3
"""Pull external audio jobs, synthesize locally, and upload the finished file."""

import argparse
import hashlib
import json
import os
import subprocess
import tempfile
import threading
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path


class Api:
    def __init__(self, base_url, token, worker_id):
        self.base = base_url.rstrip("/") + "/api/worker/v1"
        self.token = token
        self.worker_id = worker_id

    def request(self, method, path, body=None, headers=None):
        data = None if body is None else json.dumps(body).encode()
        request = urllib.request.Request(self.base + path, data=data, method=method, headers={
            "Authorization": f"Bearer {self.token}", "X-Worker-Id": self.worker_id,
            **({"Content-Type": "application/json"} if body is not None else {}), **(headers or {})})
        try:
            with urllib.request.urlopen(request, timeout=330) as response:
                return None if response.status == 204 else json.load(response)
        except urllib.error.HTTPError as error:
            if error.code == 204:
                return None
            detail = error.read().decode(errors="replace")[:1000]
            raise RuntimeError(f"worker API {error.code}: {detail}") from error

    def lease_headers(self, job):
        return {"X-Lease-Token": job["leaseToken"], "X-Lease-Generation": str(job["leaseGeneration"])}


class Heartbeat:
    def __init__(self, api, job):
        self.api, self.job, self.stop = api, job, threading.Event()
        self.thread = threading.Thread(target=self.run, daemon=True)

    def run(self):
        while not self.stop.wait(30):
            self.api.request("POST", f'/jobs/{self.job["id"]}/heartbeat', headers={**self.api.lease_headers(self.job), "Content-Length": "0"})

    def __enter__(self): self.thread.start(); return self
    def __exit__(self, *_): self.stop.set(); self.thread.join(timeout=2)


def synthesize_mock(text, output):
    duration = max(45, min(150, round(len(text.split()) / 2.3)))
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", f"sine=frequency=440:duration={duration}", str(output)], check=True)


def synthesize_silero(text, output, model_path, speaker, device):
    import torch
    model = torch.package.PackageImporter(model_path).load_pickle("tts_models", "model")
    model.to(device)
    model.save_wav(text=text, speaker=speaker, sample_rate=48000, audio_path=str(output))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--engine", choices=["mock", "silero"], default=os.getenv("TTS_ENGINE", "mock"))
    parser.add_argument("--model-path", default=os.getenv("SILERO_MODEL_PATH", ""))
    parser.add_argument("--speaker", default=os.getenv("SILERO_SPEAKER", "xenia"))
    parser.add_argument("--device", default=os.getenv("WORKER_DEVICE", "cpu"))
    parser.add_argument("--once", action="store_true")
    args = parser.parse_args()
    api = Api(os.environ["WORKER_API_URL"], os.environ["WORKER_TOKEN"], os.getenv("WORKER_ID", os.uname().nodename))
    profile = os.getenv("WORKER_PROFILE_ID", "silero-ru-v1")
    while True:
        response = api.request("POST", "/claim", {"requestId": uuid.uuid4().hex, "profileIds": [profile], "version": "tts-worker-1"})
        if not response:
            if args.once: return
            time.sleep(10); continue
        job = response["job"]
        try:
            with tempfile.TemporaryDirectory(prefix="otgolosok-tts-") as directory, Heartbeat(api, job):
                output = Path(directory) / "speech.wav"
                if args.engine == "mock": synthesize_mock(job["spokenText"], output)
                else:
                    if not args.model_path: raise RuntimeError("SILERO_MODEL_PATH is required")
                    synthesize_silero(job["spokenText"], output, args.model_path, args.speaker, args.device)
                content = output.read_bytes(); digest = hashlib.sha256(content).hexdigest(); upload_id = uuid.uuid4().hex
                request = urllib.request.Request(api.base + f'/jobs/{job["id"]}/result', data=content, method="PUT", headers={
                    "Authorization": f"Bearer {api.token}", "X-Worker-Id": api.worker_id, **api.lease_headers(job),
                    "Content-Type": "audio/wav", "X-Upload-Id": upload_id, "X-Content-SHA256": digest,
                    "X-TTS-Model": args.engine, "X-TTS-Voice": args.speaker})
                with urllib.request.urlopen(request, timeout=330) as result: json.load(result)
        except Exception as error:
            try:
                api.request("POST", f'/jobs/{job["id"]}/fail', {"failureId": uuid.uuid4().hex, "code": "SYNTHESIS_FAILED", "message": str(error)}, api.lease_headers(job))
            except Exception: pass
            if args.once: raise
        if args.once: return


if __name__ == "__main__": main()
