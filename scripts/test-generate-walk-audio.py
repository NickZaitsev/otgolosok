import importlib.util
import io
import unittest
import urllib.error
from email.message import Message
from pathlib import Path

SPEC = importlib.util.spec_from_file_location("walk_audio", Path(__file__).with_name("generate-walk-audio.py"))
assert SPEC is not None and SPEC.loader is not None
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class Response(io.BytesIO):
    def __init__(self, body=b"mp3", content_type="audio/mpeg"):
        super().__init__(body)
        self.headers = {"Content-Type": content_type}


def http_error(code, retry_after=None):
    headers = Message()
    if retry_after is not None:
        headers["Retry-After"] = retry_after
    return urllib.error.HTTPError("https://speech.invalid/audio/speech", code, "error", headers, None)


def opener(outcomes):
    calls = []

    def open_request(request, timeout):
        calls.append(timeout)
        outcome = outcomes[len(calls) - 1]
        if isinstance(outcome, BaseException):
            raise outcome
        return outcome

    return open_request, calls


class SpeechRetryTest(unittest.TestCase):
    def test_transient_failures_are_retried_until_success(self):
        for name, failure in [
            ("rate limit", http_error(429)),
            ("server error", http_error(503)),
            ("network", urllib.error.URLError("connection refused")),
            ("timeout", TimeoutError()),
            ("reset", ConnectionResetError()),
        ]:
            with self.subTest(name):
                open_request, calls = opener([failure, Response(b"audio")])
                sleeps = []
                self.assertEqual(MODULE.speech_audio(object(), opener=open_request, sleep=sleeps.append), b"audio")
                self.assertEqual(len(calls), 2)
                self.assertEqual(len(sleeps), 1)
                self.assertLessEqual(sleeps[0], MODULE.BASE_DELAY_SEC)

    def test_permanent_http_errors_are_not_retried_or_echoed(self):
        for code in (400, 401, 403, 404, 422):
            with self.subTest(code):
                open_request, calls = opener([http_error(code)])
                with self.assertRaisesRegex(RuntimeError, f"^Speech request failed with HTTP {code}$"):
                    MODULE.speech_audio(object(), opener=open_request, sleep=lambda _: None)
                self.assertEqual(len(calls), 1)

    def test_retry_after_is_honoured_and_capped(self):
        for header, expected in [("3", 3.0), ("600", MODULE.MAX_DELAY_SEC)]:
            with self.subTest(header):
                open_request, _ = opener([http_error(503, header), Response()])
                sleeps = []
                MODULE.speech_audio(object(), opener=open_request, sleep=sleeps.append)
                self.assertEqual(sleeps, [expected])

    def test_attempts_are_bounded(self):
        open_request, calls = opener([http_error(502)] * MODULE.MAX_ATTEMPTS)
        sleeps = []
        with self.assertRaises(MODULE.TransientSpeechError):
            MODULE.speech_audio(object(), opener=open_request, sleep=sleeps.append)
        self.assertEqual(len(calls), MODULE.MAX_ATTEMPTS)
        self.assertEqual(len(sleeps), MODULE.MAX_ATTEMPTS - 1)
        self.assertTrue(all(0 <= delay <= MODULE.MAX_DELAY_SEC for delay in sleeps))

    def test_non_audio_response_is_rejected_without_retry(self):
        open_request, calls = opener([Response(b"<html>", "text/html")])
        with self.assertRaisesRegex(RuntimeError, "did not return audio"):
            MODULE.speech_audio(object(), opener=open_request, sleep=lambda _: None)
        self.assertEqual(len(calls), 1)


if __name__ == "__main__":
    unittest.main()
