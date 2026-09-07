const DEFAULT_TONE_DURATION_SECONDS = 5;
const DEFAULT_TONE_FREQUENCY_HZ = 440;
const DEFAULT_SAMPLE_RATE_HZ = 8_000;
const DEFAULT_AMPLITUDE = 0.22;
const operations = new WeakMap<HTMLAudioElement, symbol>();
const pendingPlayback = new WeakMap<HTMLAudioElement, () => void>();
const pendingStartOffset = new WeakMap<HTMLAudioElement, () => void>();
export const AUDIO_UNLOCK_TIMEOUT_MS = 3_000;
export const AUDIO_PLAY_TIMEOUT_MS = 10_000;

function beginOperation(audio: HTMLAudioElement) {
  pendingPlayback.get(audio)?.();
  pendingStartOffset.get(audio)?.();
  const operation = Symbol();
  operations.set(audio, operation);
  return operation;
}

function deferStartOffset(
  audio: HTMLAudioElement,
  operation: symbol,
  startSeconds: number,
) {
  if (!(startSeconds > 0) || !Number.isFinite(startSeconds)) return () => {};

  // Keep the zero-offset path usable with the minimal audio mocks used by
  // existing callers, which do not implement EventTarget.
  if (
    typeof audio.addEventListener !== "function" ||
    typeof audio.removeEventListener !== "function"
  ) return () => {};

  const applyOffset = () => {
    cleanup();
    if (operations.get(audio) === operation) seekAudioElement(audio, startSeconds);
  };
  const cleanup = () => {
    audio.removeEventListener("loadedmetadata", applyOffset);
    clearTimeout(timer);
    if (pendingStartOffset.get(audio) === cleanup) pendingStartOffset.delete(audio);
  };

  audio.addEventListener("loadedmetadata", applyOffset);
  const timer = setTimeout(cleanup, AUDIO_PLAY_TIMEOUT_MS);
  pendingStartOffset.set(audio, cleanup);

  // Metadata may already be available when replaying a cached source.
  if (audio.readyState >= 1 && Number.isFinite(audio.duration) && audio.duration > 0) applyOffset();
  return cleanup;
}

/** Some mobile media engines leave play() pending instead of rejecting it. */
function waitForPlayback(audio: HTMLAudioElement, operation: symbol, timeoutMs: number) {
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (played: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (pendingPlayback.get(audio) === cancel) pendingPlayback.delete(audio);
      resolve(played);
    };
    const cancel = () => finish(false);
    const timer = setTimeout(() => {
      if (operations.get(audio) === operation) {
        // Cancel the pending native play request so it cannot start later.
        try { audio.pause(); } catch { /* Cleanup must still settle the promise. */ }
      }
      finish(false);
    }, timeoutMs);
    pendingPlayback.set(audio, cancel);

    try {
      // Invoke synchronously, while the original click owns user activation.
      const playback = audio.play();
      Promise.resolve(playback).then(
        () => finish(operations.get(audio) === operation),
        () => finish(false),
      );
    } catch {
      finish(false);
    }
  });
}

export interface TestToneOptions {
  durationSeconds?: number;
  frequencyHz?: number;
  sampleRateHz?: number;
  amplitude?: number;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
}

function writeAscii(bytes: Uint8Array, offset: number, value: string) {
  for (let index = 0; index < value.length; index += 1) {
    bytes[offset + index] = value.charCodeAt(index);
  }
}

function writeUint16(bytes: Uint8Array, offset: number, value: number) {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
}

function writeUint32(bytes: Uint8Array, offset: number, value: number) {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
  bytes[offset + 2] = (value >>> 16) & 0xff;
  bytes[offset + 3] = (value >>> 24) & 0xff;
}

function encodeBase64(bytes: Uint8Array) {
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let encoded = "";

  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index];
    const second = bytes[index + 1];
    const third = bytes[index + 2];
    const value = (first << 16) | ((second ?? 0) << 8) | (third ?? 0);

    encoded += alphabet[(value >>> 18) & 63];
    encoded += alphabet[(value >>> 12) & 63];
    encoded += second === undefined ? "=" : alphabet[(value >>> 6) & 63];
    encoded += third === undefined ? "=" : alphabet[value & 63];
  }

  return encoded;
}

/**
 * Builds a small mono PCM WAV data URI without depending on browser globals.
 * The default is a softly faded five-second tone intended for field checks.
 */
export function createTestToneDataUri(options: TestToneOptions = {}) {
  const durationSeconds = clamp(
    options.durationSeconds ?? DEFAULT_TONE_DURATION_SECONDS,
    0.05,
    30,
  );
  const frequencyHz = clamp(
    options.frequencyHz ?? DEFAULT_TONE_FREQUENCY_HZ,
    40,
    4_000,
  );
  const sampleRateHz = Math.round(
    clamp(options.sampleRateHz ?? DEFAULT_SAMPLE_RATE_HZ, 8_000, 48_000),
  );
  const amplitude = clamp(options.amplitude ?? DEFAULT_AMPLITUDE, 0, 1);
  const sampleCount = Math.round(durationSeconds * sampleRateHz);
  const bytes = new Uint8Array(44 + sampleCount);

  writeAscii(bytes, 0, "RIFF");
  writeUint32(bytes, 4, 36 + sampleCount);
  writeAscii(bytes, 8, "WAVE");
  writeAscii(bytes, 12, "fmt ");
  writeUint32(bytes, 16, 16);
  writeUint16(bytes, 20, 1);
  writeUint16(bytes, 22, 1);
  writeUint32(bytes, 24, sampleRateHz);
  writeUint32(bytes, 28, sampleRateHz);
  writeUint16(bytes, 32, 1);
  writeUint16(bytes, 34, 8);
  writeAscii(bytes, 36, "data");
  writeUint32(bytes, 40, sampleCount);

  const fadeSamples = Math.max(
    1,
    Math.min(Math.round(sampleRateHz * 0.04), sampleCount / 2),
  );

  for (let index = 0; index < sampleCount; index += 1) {
    const fadeIn = Math.min(1, index / fadeSamples);
    const fadeOut = Math.min(1, (sampleCount - 1 - index) / fadeSamples);
    const envelope = Math.min(fadeIn, fadeOut);
    const phase = (2 * Math.PI * frequencyHz * index) / sampleRateHz;
    const sample = Math.sin(phase) * amplitude * envelope;
    bytes[44 + index] = Math.round(128 + sample * 127);
  }

  return `data:audio/wav;base64,${encodeBase64(bytes)}`;
}

/**
 * Must be called directly from a user gesture. `play()` is invoked before the
 * first await so iOS can grant playback permission to this exact element.
 */
export async function unlockAudioElement(audio: HTMLAudioElement) {
  const operation = beginOperation(audio);

  try {
    audio.preload = "auto";
    // Use a complete short clip; the old four-sample WAV was only 0.5 ms long.
    audio.src = createTestToneDataUri({ durationSeconds: 0.15, amplitude: 0 });
    audio.currentTime = 0;
    audio.load();
    const played = await waitForPlayback(audio, operation, AUDIO_UNLOCK_TIMEOUT_MS);
    if (!played || operations.get(audio) !== operation) return false;
    audio.pause();
    audio.currentTime = 0;
    return true;
  } catch {
    return false;
  }
}

/** Cancels any pending play request but preserves the current saved position. */
export function pauseAudioElement(audio: HTMLAudioElement) {
  beginOperation(audio);
  try { audio.pause(); } catch { /* A failed pause must still cancel pending work. */ }
}

/** Resumes the current source and saved position without replacing or loading it. */
export function resumeAudioElement(audio: HTMLAudioElement): Promise<boolean> {
  const operation = beginOperation(audio);
  return waitForPlayback(audio, operation, AUDIO_PLAY_TIMEOUT_MS);
}

/** Seeks without changing playback state. Returns the applied position, if any. */
export function seekAudioElement(audio: HTMLAudioElement, target: number): number | null {
  if (!Number.isFinite(target) || !Number.isFinite(audio.duration) || audio.duration <= 0) {
    return null;
  }
  const position = Math.min(Math.max(target, 0), audio.duration);
  try {
    audio.currentTime = position;
    return position;
  } catch {
    return null;
  }
}

/** Starts a five-second test tone on the same audio element used for unlock. */
export async function playTestTone(
  audio: HTMLAudioElement,
  options: TestToneOptions = {},
) {
  return playAudioSource(audio, createTestToneDataUri(options));
}

/** Reuses the unlocked element for either a story or the diagnostic tone. */
export async function playAudioSource(
  audio: HTMLAudioElement,
  source: string,
  startSeconds = 0,
) {
  const operation = beginOperation(audio);
  let cancelOffset = () => {};
  try {
    audio.pause();
    audio.src = source;
    audio.currentTime = 0;
    audio.load();
    cancelOffset = deferStartOffset(audio, operation, startSeconds);
    const played = await waitForPlayback(audio, operation, AUDIO_PLAY_TIMEOUT_MS);
    if (!played) cancelOffset();
    return played;
  } catch {
    cancelOffset();
    return false;
  }
}

export function stopAudioElement(audio: HTMLAudioElement) {
  beginOperation(audio);
  audio.pause();
  audio.currentTime = 0;
}
