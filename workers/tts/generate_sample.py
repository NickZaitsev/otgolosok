#!/usr/bin/env python3
"""Generate a short local demo with the production Silero text pipeline."""

import argparse
import json
import re
import subprocess
from pathlib import Path

from worker import DEFAULT_SILERO_MODEL_PATH, load_silero, load_text_pipeline, prepare_silero_text, synthesize_silero


SAMPLE_TEXT = (
    "Москва умеет хранить голоса прошлого. В 1874 году на берегу Москвы-реки "
    "работала знаменитая фабрика. Здесь создавали ткани, которые отправляли "
    "покупателям за тысячи километров. Сегодня старинные здания напоминают, "
    "как промышленная история города стала частью его культурной памяти."
)
SAMPLE_SPEAKERS = ("aidar", "baya", "kseniya", "xenia", "eugene")


def loudnorm_measure(path: Path) -> dict[str, str]:
    result = subprocess.run([
        "ffmpeg", "-hide_banner", "-i", str(path), "-af",
        "loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json", "-f", "null", "NUL",
    ], check=True, capture_output=True, text=True)
    match = re.search(r'\{\s*"input_i".*?\}', result.stderr, re.DOTALL)
    if not match:
        raise RuntimeError("FFmpeg did not return loudnorm measurements")
    return json.loads(match.group(0))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-path", type=Path, default=DEFAULT_SILERO_MODEL_PATH)
    parser.add_argument("--output", type=Path, default=Path("artifacts/tts-v5_5-baya-sample.wav"))
    parser.add_argument("--speaker", default="baya")
    parser.add_argument("--device", default="cpu")
    parser.add_argument("--text", default=SAMPLE_TEXT)
    parser.add_argument("--route", type=Path)
    parser.add_argument("--poi", type=int, default=0)
    parser.add_argument("--paragraph", type=int, default=0)
    parser.add_argument("--loudnorm", action="store_true")
    parser.add_argument("--all-speakers", action="store_true")
    args = parser.parse_args()

    text = args.text
    if args.route:
        route = json.loads(args.route.read_text(encoding="utf-8"))
        poi = route["pois"][args.poi]
        text = poi["story"]["paragraphs"][args.paragraph]["text"]

    args.output.parent.mkdir(parents=True, exist_ok=True)
    model = load_silero(args.model_path, args.device)
    normalizer, accentor = load_text_pipeline(args.device)
    prepared = prepare_silero_text(text, normalizer, accentor)
    speakers = SAMPLE_SPEAKERS if args.all_speakers else (args.speaker,)
    for speaker in speakers:
        output = args.output.with_name(f"{args.output.stem}-{speaker}{args.output.suffix}") if args.all_speakers else args.output
        synthesis_output = output.with_name(f"{output.stem}.raw.wav") if args.loudnorm else output
        synthesize_silero(prepared,synthesis_output,args.model_path,speaker,args.device,model=model)
        if args.loudnorm:
            measured = loudnorm_measure(synthesis_output)
            subprocess.run([
                "ffmpeg", "-v", "error", "-y", "-i", str(synthesis_output),
                "-af", (
                    "loudnorm=I=-16:TP=-1.5:LRA=11:linear=true:"
                    f"measured_I={measured['input_i']}:measured_TP={measured['input_tp']}:"
                    f"measured_LRA={measured['input_lra']}:measured_thresh={measured['input_thresh']}:"
                    f"offset={measured['target_offset']}"
                ), "-ar", "48000", str(output),
            ], check=True)
            synthesis_output.unlink()
        print(output.resolve())
    print(prepared)


if __name__ == "__main__":
    main()
