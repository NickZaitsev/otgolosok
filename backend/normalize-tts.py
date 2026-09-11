#!/usr/bin/env python3
"""Normalize Russian narration text before it reaches a speech provider."""

import sys

from ru_normalizr import NormalizeOptions, Normalizer


def main() -> int:
    text = sys.stdin.read()
    if not text.strip():
        return 1
    normalized = Normalizer(NormalizeOptions.tts()).normalize(text)
    if not normalized.strip():
        return 1
    sys.stdout.write(normalized)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
