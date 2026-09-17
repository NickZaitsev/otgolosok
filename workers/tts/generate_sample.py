#!/usr/bin/env python3
"""Generate a short local demo with the production Silero text pipeline."""

import argparse
from pathlib import Path

from worker import DEFAULT_SILERO_MODEL_PATH, load_silero, load_text_pipeline, prepare_silero_text, synthesize_silero


SAMPLE_TEXT = (
    "Москва умеет хранить голоса прошлого. В 2024 году старинный дом снова "
    "открыл двери, и теперь его история звучит по-новому."
)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-path", type=Path, default=DEFAULT_SILERO_MODEL_PATH)
    parser.add_argument("--output", type=Path, default=Path("artifacts/tts-v5_5-baya-sample.wav"))
    parser.add_argument("--speaker", default="baya")
    parser.add_argument("--device", default="cpu")
    parser.add_argument("--text", default=SAMPLE_TEXT)
    args = parser.parse_args()

    args.output.parent.mkdir(parents=True, exist_ok=True)
    model = load_silero(args.model_path, args.device)
    normalizer, accentor = load_text_pipeline(args.device)
    prepared = prepare_silero_text(args.text, normalizer, accentor)
    synthesize_silero(
        prepared,
        args.output,
        args.model_path,
        args.speaker,
        args.device,
        model=model,
    )
    print(args.output.resolve())
    print(prepared)


if __name__ == "__main__":
    main()
