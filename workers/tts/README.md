# TTS worker moved to just-tts

The standalone worker now lives in the sibling repository
`C:\00_projects\just-tts`. It can be installed on another machine without this
site checkout. See its `README.md` for installation, local synthesis and worker
commands.

The server contract remains `/api/worker/v1`; backend queues, credentials, lease,
audio validation and publication stay in this repository. Historical sample WAV
files remain in `artifacts/`.
