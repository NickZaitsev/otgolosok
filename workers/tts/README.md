# Local TTS worker

The worker makes outbound HTTPS requests only. Configure:

```text
WORKER_API_URL=https://your-site.example
WORKER_TOKEN=<same value as server WORKER_API_TOKEN>
WORKER_ID=my-gpu-pc
WORKER_PROFILE_ID=silero-ru-v1
SILERO_MODEL_PATH=/absolute/path/to/model.pt
SILERO_SPEAKER=xenia
WORKER_DEVICE=cpu
```

Install Python, PyTorch for the target machine, and FFmpeg. Download a compatible
Russian Silero model yourself and verify its license and checksum. Run:

```bash
python workers/tts/worker.py --engine silero
```

`--engine mock --once` creates a test tone and is intended only for integration tests.
The server must first enqueue an external audio job through the authenticated admin
endpoint `POST /api/story-admin/jobs/:id/external-audio` with `{revision, profileId}`.
