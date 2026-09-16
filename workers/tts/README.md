# Local TTS worker

The worker makes outbound HTTPS requests only. Configure:

```text
WORKER_API_URL=https://your-site.example
WORKER_TOKEN=<same value as server WORKER_API_TOKEN>
WORKER_ID=my-gpu-pc
WORKER_PROFILE_ID=silero-ru-v1
SILERO_MODEL_PATH=/absolute/path/to/model.pt
SILERO_MODEL_SHA256=<sha256 выбранного файла модели>
SILERO_SPEAKER=xenia
WORKER_DEVICE=cpu
```

Install Python, PyTorch for the target machine, and FFmpeg. Download a compatible
Russian Silero model yourself and verify its license and checksum. Run:

```bash
python workers/tts/worker.py --engine silero
```

Verified CPU pilot configuration (Windows, Ryzen 5 5600G, 32 GB RAM): Silero
`v4_ru.pt`, SHA-256 `896ab96347d5bd781ab97959d4fd6885620e5aab52405d3445626eb7c1414b00`,
speaker `xenia`, PyTorch `2.14.0+cpu`, Python `3.12.7`, 48 kHz WAV. A 26.3-second
Russian sample synthesized in 8.36 seconds after loading the model. The checkpoint
offers `aidar`, `baya`, `kseniya`, `xenia`, `eugene`, and `random`; use `xenia` for
the first pilot. The model stays loaded across jobs.

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

The worker reports its version, profiles, current job and bounded progress through
claim/heartbeat. The admin screen uses this to show whether a compatible worker is
online. A completed WAV remains in the spool until the server confirms its receipt.
