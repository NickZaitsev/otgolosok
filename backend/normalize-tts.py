#!/usr/bin/env python3
"""Normalize Russian narration text before it reaches a speech provider."""

import re
import sys

from ru_normalizr import NormalizeOptions, Normalizer

# До раскрытия аббревиатур: название универмага произносится одним словом.
GUM_WORD = re.compile(r"(?<!\w)ГУМ(?:-?(а|у|ом|е))?(?!\w)")


def prepare_pronunciation(text: str) -> str:
    return GUM_WORD.sub(lambda match: "Гум" + (match.group(1) or ""), text)


def main() -> int:
    text = sys.stdin.read()
    if not text.strip():
        return 1
    normalized = Normalizer(NormalizeOptions.tts()).normalize(
        prepare_pronunciation(text)
    )
    if not normalized.strip():
        return 1
    sys.stdout.write(normalized)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
