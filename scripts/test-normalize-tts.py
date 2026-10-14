"""Проверить произношение ГУМа через настоящую подготовку текста для TTS."""

import importlib.util
import subprocess
import sys
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "backend" / "normalize-tts.py"


SPEC = importlib.util.spec_from_file_location("normalize_tts", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class GumPronunciationTest(unittest.TestCase):
    def normalize(self, text):
        return subprocess.run(
            [sys.executable, str(SCRIPT)],
            input=text,
            text=True,
            capture_output=True,
            timeout=30,
            check=False,
        )

    def test_gum_is_one_word_in_all_cases(self):
        for source, expected in [
            ("ГУМ", "Гум"),
            ("ГУМа", "Гума"),
            ("ГУМу", "Гуму"),
            ("ГУМом", "Гумом"),
            ("ГУМе", "Гуме"),
            ("ГУМ-а", "Гума"),
            ("ГУМ-ом", "Гумом"),
            ("«ГУМ», (ГУМа).", '"Гум", (Гума).'),
        ]:
            with self.subTest(source=source):
                result = self.normalize(source)
                self.assertEqual(result.returncode, 0)
                self.assertEqual(result.stdout, expected)

    def test_other_normalization_and_word_boundaries_are_preserved(self):
        source = "Гуменюк, Игумнов, ГУМАНИТАРНЫЙ, ГУМ2, ГУМ_код, АГУМ, ГУМы."
        self.assertEqual(MODULE.prepare_pronunciation(source), source)
        result = self.normalize("В ГУМе 2 магазина.")
        self.assertEqual(result.returncode, 0)
        self.assertEqual(result.stdout, "В Гуме два магазина.")

    def test_empty_input_fails_without_output(self):
        result = self.normalize(" \n")
        self.assertEqual(result.returncode, 1)
        self.assertEqual(result.stdout, "")


if __name__ == "__main__":
    unittest.main()
