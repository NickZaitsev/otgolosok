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

F5-TTS is supported through a fixed local command adapter. Configure an executable
that accepts `--text <text> --output <wav>` as `F5_TTS_COMMAND`, then run
`python workers/tts/worker.py --engine f5`. Pin and review the chosen checkpoint,
reference voice, transcript and license on the worker machine.

`--engine mock --once` creates a test tone and is intended only for integration tests.
The server must first enqueue an external audio job through the authenticated admin
endpoint `POST /api/story-admin/jobs/:id/external-audio` with `{revision, profileId}`.

`WORKER_SPOOL_DIR` stores manifests and completed WAV files. On restart the worker
checks server state and resumes an idempotent upload while its lease is valid. API
requests use bounded exponential backoff with jitter, and a lost heartbeat stops a
running synthesis attempt.

Long Silero input is split at sentence boundaries and compatible WAV chunks are
joined before upload. Set `SILERO_MODEL_SHA256` to pin the selected model file;
startup fails if it differs. Startup also validates FFmpeg and the F5 executable.
