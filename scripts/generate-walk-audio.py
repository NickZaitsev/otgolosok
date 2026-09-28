#!/usr/bin/env python3
"""Generate versioned MP3 chapters once; normal builds never call a paid API."""

import hashlib
import json
import math
import os
import random
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from pathlib import Path

from ru_normalizr import NormalizeOptions, Normalizer

ROOT = Path(__file__).resolve().parents[1]
ROUTE = ROOT / "public/data/routes/paveletskaya.json"
MODEL = "gpt-4o-mini-tts"
VOICE = "marin"
INSTRUCTIONS = (
    "Read the supplied Russian text exactly, without adding or omitting sentences. "
    "You are a warm, clear Russian walking-tour narrator. Use natural Russian pronunciation, "
    "a conversational pace of about 140 words per minute and brief pauses between paragraphs. "
    "No theatrical delivery, no music or sound effects. Read addresses and years naturally. "
    "Pronounce Цинделя with stress on the first syllable: Ци́нделя. "
    "Pronounce Дербеневская with stress on the second syllable: Дербе́невская, never Дербенёвская. "
    "Pronounce Кожевнический with stress on the second syllable: Коже́внический."
)
NORMALIZER = Normalizer(NormalizeOptions.tts())
TRANSIENT_HTTP = {408, 425, 429, 500, 502, 503, 504}
MAX_ATTEMPTS = 4
BASE_DELAY_SEC = 2.0
MAX_DELAY_SEC = 30.0


class TransientSpeechError(RuntimeError):
    pass


def retry_after_seconds(value):
    try:
        return max(0.0, float(value)) if value is not None else None
    except ValueError:
        return None


def speech_audio(request, *, opener=urllib.request.urlopen, sleep=time.sleep, attempts=MAX_ATTEMPTS):
    """POST a speech request, retrying only transient failures with bounded exponential backoff."""
    for attempt in range(1, attempts + 1):
        wait = None
        try:
            with opener(request, timeout=180) as response:
                if not response.headers.get("Content-Type", "").startswith("audio/"):
                    raise RuntimeError("The speech service did not return audio")
                return response.read()
        except urllib.error.HTTPError as error:
            # Never echo a provider response, URL or credentials to build logs.
            if error.code not in TRANSIENT_HTTP:
                raise RuntimeError(f"Speech request failed with HTTP {error.code}") from None
            failure = TransientSpeechError(f"Speech request failed with HTTP {error.code}")
            wait = retry_after_seconds(error.headers.get("Retry-After") if error.headers else None)
        except (urllib.error.URLError, TimeoutError, ConnectionError) as error:
            failure = TransientSpeechError(f"Speech request failed: {type(error).__name__}")
        if attempt == attempts:
            raise failure from None
        backoff = min(MAX_DELAY_SEC, BASE_DELAY_SEC * 2 ** (attempt - 1))
        sleep(min(MAX_DELAY_SEC, wait) if wait is not None else random.uniform(0, backoff))
    raise AssertionError("unreachable")


def sha256(value):
    return hashlib.sha256(value).hexdigest()


def duration(path):
    result = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "json", str(path)],
        check=True, capture_output=True, text=True,
    )
    return float(json.loads(result.stdout)["format"]["duration"])


def generate(step, content, limit):
    # Hash the exact visible narrative, including both transitions. A content
    # change must invalidate its recording even if the chapter ID stays the same.
    script = "\n\n".join(part for part in [
        step["transition"],
        *[paragraph["text"] for paragraph in content["story"]["paragraphs"]],
        step["next_hint"],
    ] if part)
    spoken = (NORMALIZER.normalize(script.replace("12с10", "номер двенадцать, строение десять")
              .replace("Moscowwalks", "Москоу уокс"))
              .replace("Дербеневск", "Дербе́невск")
              .replace("Цинделя", "Ци́нделя"))
    request_body = {
        "model": MODEL, "voice": VOICE, "input": spoken,
        "instructions": INSTRUCTIONS, "response_format": "mp3", "speed": 1.0,
    }
    body = json.dumps(request_body, ensure_ascii=False).encode()
    version = sha256(body)[:12]
    target = ROOT / f"public/audio/walk/{step['id']}-{version}.mp3"
    target.parent.mkdir(parents=True, exist_ok=True)
    if not target.exists():
        request = urllib.request.Request(
            os.environ["OPENAI_BASE_URL"].rstrip("/") + "/audio/speech",
            data=body,
            headers={"Authorization": "Bearer " + os.environ["OPENAI_API_KEY"], "Content-Type": "application/json"},
        )
        audio = speech_audio(request)
        with tempfile.TemporaryDirectory(prefix="otgolosok-tts-") as directory:
            source = Path(directory) / "source.mp3"
            encoded = Path(directory) / "chapter.mp3"
            source.write_bytes(audio)
            subprocess.run([
                "ffmpeg", "-v", "error", "-i", str(source), "-af", "loudnorm=I=-16:TP=-1.5:LRA=11",
                "-ac", "1", "-ar", "24000", "-b:a", "64k", "-map_metadata", "-1", str(encoded),
            ], check=True, capture_output=True)
            measured = duration(encoded)
            # Slightly tighten long pauses/tempo if an otherwise complete take
            # just exceeds the editorial budget. Larger overruns need a retake.
            if limit < measured <= limit * 1.12:
                adjusted = Path(directory) / "adjusted.mp3"
                subprocess.run([
                    "ffmpeg", "-v", "error", "-i", str(encoded), "-af", f"atempo={measured / (limit - 0.75):.5f}",
                    "-ac", "1", "-ar", "24000", "-b:a", "64k", "-map_metadata", "-1", str(adjusted),
                ], check=True, capture_output=True)
                encoded = adjusted
                measured = duration(encoded)
            if not 10 < measured <= limit:
                raise RuntimeError(f"{step['id']}: {measured:.2f}s exceeds its {limit}s narration budget")
            target.write_bytes(encoded.read_bytes())
    measured = duration(target)
    if not 10 < measured <= limit:
        raise RuntimeError(f"{step['id']}: cached audio is outside its duration budget")
    print(f"{step['id']}: {measured:.2f}s, {target.stat().st_size} bytes", flush=True)
    return {
        "url": "/" + target.relative_to(ROOT / "public").as_posix(),
        "duration_sec": measured,
        "synthetic": True,
        "model": MODEL,
        "voice": VOICE,
        "script_sha256": sha256(script.encode()),
        "audio_sha256": sha256(target.read_bytes()),
        "generated_at": datetime.fromtimestamp(target.stat().st_mtime, tz=UTC).isoformat(),
    }


if __name__ == "__main__":
    if not os.environ.get("OPENAI_API_KEY") or not os.environ.get("OPENAI_BASE_URL"):
        raise SystemExit("Set OPENAI_API_KEY and OPENAI_BASE_URL in the environment; do not put them in public files.")
    route = json.loads(ROUTE.read_text())
    contents = {item["id"]: item for item in route["pois"] + route.get("notes", [])}
    steps = route["walk"]["steps"]
    with ThreadPoolExecutor(max_workers=2) as executor:
        recordings = list(executor.map(lambda step: generate(
            step, contents[step["content_id"]],
            120 if any(item["id"] == step["content_id"] for item in route["pois"]) else 60,
        ), steps))
    # Publish references only after every chapter has completed successfully.
    for step, recording in zip(steps, recordings):
        step["audio"] = recording
        step["duration_sec"] = math.ceil(recording["duration_sec"])
    ROUTE.write_text(json.dumps(route, ensure_ascii=False, indent=2) + "\n")
