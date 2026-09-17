# Local TTS worker

The worker makes outbound HTTPS requests only. Configure:

```text
WORKER_API_URL=https://your-site.example
WORKER_TOKEN=<same value as server WORKER_API_TOKEN>
WORKER_ID=my-gpu-pc
WORKER_PROFILE_ID=silero-ru-v1
SILERO_MODEL_PATH=/absolute/path/to/silero-v5_5-ru.pt
SILERO_MODEL_SHA256=50081637b602126ee06cb3bc8a744d25651d2da149ee8864b9a379bfdd934437
SILERO_SPEAKER=baya
WORKER_DEVICE=cpu
```

Install Python, PyTorch for the target machine, FFmpeg, and the worker text
dependencies. Download the official `v5_5_ru` checkpoint and verify its checksum:

```bash
python -m pip install -r workers/tts/requirements.txt
curl --create-dirs -L https://models.silero.ai/models/tts/ru/v5_5_ru.pt \
  -o backend/data/models/silero-v5_5-ru.pt
python workers/tts/worker.py --engine silero
```

Generate a standalone WAV sample with the same text pipeline and the default
`baya` voice:

```bash
python workers/tts/generate_sample.py
```

Generate the same standard test passage with every Russian `v5_5_ru` voice and
normalize each output with FFmpeg:

```bash
python workers/tts/generate_sample.py --all-speakers --loudnorm \
  --output artifacts/tts-v5_5-standard.wav
```

Use a real paragraph from a bundled map route and normalize it to `-16 LUFS`
with FFmpeg:

```bash
python workers/tts/generate_sample.py --route public/data/routes/paveletskaya.json \
  --paragraph 0 --loudnorm --output artifacts/tts-v5_5-baya-map-loudnorm.wav
```

For every Silero job, the worker first applies `ru-normalizr` in TTS mode and then
Silero Stress 1.5. Both processors are loaded once at startup and reused across
jobs. This expands numbers and abbreviations and adds stress marks plus homograph
disambiguation before synthesis.

Verified CPU configuration (Windows): Silero `v5_5_ru.pt`, SHA-256
`50081637b602126ee06cb3bc8a744d25651d2da149ee8864b9a379bfdd934437`,
speaker `baya`, PyTorch `2.14.0+cpu`, Python `3.12.7`, 48 kHz WAV. The checkpoint
offers `aidar`, `baya`, `kseniya`, `eugene`, and `xenia`. The model stays loaded
across jobs.

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
