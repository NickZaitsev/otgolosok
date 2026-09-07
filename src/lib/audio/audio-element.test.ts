import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AUDIO_PLAY_TIMEOUT_MS,
  AUDIO_UNLOCK_TIMEOUT_MS,
  createTestToneDataUri,
  playAudioSource,
  playTestTone,
  stopAudioElement,
  unlockAudioElement,
} from "./audio-element";

function createAudio(play: () => Promise<void> = () => Promise.resolve()) {
  return {
    currentTime: 12,
    load: vi.fn(),
    pause: vi.fn(),
    play: vi.fn(play),
    preload: "none",
    src: "",
  } as unknown as HTMLAudioElement;
}

function decodeDataUri(uri: string) {
  const encoded = uri.split(",")[1];
  return Uint8Array.from(Buffer.from(encoded, "base64"));
}

describe("audio element helpers", () => {
  afterEach(() => vi.useRealTimers());

  it("invokes play synchronously so an iOS user gesture is retained", async () => {
    let resolvePlayback: (() => void) | undefined;
    const audio = createAudio(
      () => new Promise<void>((resolve) => {
        resolvePlayback = resolve;
      }),
    );

    const unlock = unlockAudioElement(audio);

    expect(audio.play).toHaveBeenCalledOnce();
    expect(audio.src).toMatch(/^data:audio\/wav;base64,/);
    expect(audio.preload).toBe("auto");
    expect(audio.load).toHaveBeenCalledOnce();

    resolvePlayback?.();
    await expect(unlock).resolves.toBe(true);
    expect(audio.pause).toHaveBeenCalledOnce();
    expect(audio.currentTime).toBe(0);
  });

  it("reports a rejected unlock without throwing", async () => {
    const audio = createAudio(() => Promise.reject(new Error("NotAllowedError")));

    await expect(unlockAudioElement(audio)).resolves.toBe(false);
  });

  it("uses a complete silent clip instead of a sub-millisecond WAV", async () => {
    const audio = createAudio();
    await unlockAudioElement(audio);
    const bytes = decodeDataUri(audio.src);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const duration = view.getUint32(40, true) / view.getUint32(24, true);
    expect(duration).toBeGreaterThanOrEqual(0.1);
    expect(bytes.slice(44).every((sample) => sample === 128)).toBe(true);
  });

  it("settles a stalled unlock and cancels the native playback attempt", async () => {
    vi.useFakeTimers();
    const audio = createAudio(() => new Promise(() => {}));
    const unlock = unlockAudioElement(audio);
    await vi.advanceTimersByTimeAsync(AUDIO_UNLOCK_TIMEOUT_MS);
    await expect(unlock).resolves.toBe(false);
    expect(audio.pause).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("bounds story playback startup and allows a subsequent retry", async () => {
    vi.useFakeTimers();
    const audio = createAudio(() => new Promise(() => {}));
    const playback = playAudioSource(audio, "/audio/story.mp3");
    await vi.advanceTimersByTimeAsync(AUDIO_PLAY_TIMEOUT_MS);
    await expect(playback).resolves.toBe(false);

    vi.mocked(audio.play).mockResolvedValueOnce();
    await expect(playAudioSource(audio, "/audio/story.mp3")).resolves.toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("settles a stalled operation immediately when the walk is stopped", async () => {
    vi.useFakeTimers();
    const audio = createAudio(() => new Promise(() => {}));
    const unlock = unlockAudioElement(audio);
    stopAudioElement(audio);
    await expect(unlock).resolves.toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not interrupt a manual retry when an old unlock times out or settles late", async () => {
    vi.useFakeTimers();
    let resolveUnlock!: () => void;
    const audio = createAudio(() => new Promise<void>((resolve) => { resolveUnlock = resolve; }));
    const unlock = unlockAudioElement(audio);
    await vi.advanceTimersByTimeAsync(AUDIO_UNLOCK_TIMEOUT_MS);
    await expect(unlock).resolves.toBe(false);
    vi.mocked(audio.play).mockResolvedValueOnce();
    await playAudioSource(audio, "/audio/story.mp3");
    const pauses = vi.mocked(audio.pause).mock.calls.length;
    resolveUnlock();
    await vi.advanceTimersByTimeAsync(AUDIO_PLAY_TIMEOUT_MS);
    expect(audio.pause).toHaveBeenCalledTimes(pauses);
    expect(audio.src).toBe("/audio/story.mp3");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears the unlock timeout when manual playback replaces it", async () => {
    vi.useFakeTimers();
    const audio = createAudio(() => new Promise(() => {}));
    const unlock = unlockAudioElement(audio);
    vi.mocked(audio.play).mockResolvedValueOnce();
    await expect(playAudioSource(audio, "/audio/story.mp3")).resolves.toBe(true);
    await expect(unlock).resolves.toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not pause newer playback when an old unlock resolves", async () => {
    let resolveUnlock!: () => void;
    const audio = createAudio(() => new Promise<void>((resolve) => { resolveUnlock = resolve; }));
    const unlock = unlockAudioElement(audio);
    vi.mocked(audio.play).mockResolvedValueOnce();
    await playAudioSource(audio, "/audio/story.mp3");
    const pauses = vi.mocked(audio.pause).mock.calls.length;

    resolveUnlock();
    await expect(unlock).resolves.toBe(false);
    expect(audio.pause).toHaveBeenCalledTimes(pauses);
    expect(audio.src).toBe("/audio/story.mp3");
  });

  it("invalidates pending playback when the walk stops", async () => {
    let resolvePlay!: () => void;
    const audio = createAudio(() => new Promise<void>((resolve) => { resolvePlay = resolve; }));
    const playback = playAudioSource(audio, "/audio/story.mp3");
    stopAudioElement(audio);
    resolvePlay();
    await expect(playback).resolves.toBe(false);
  });

  it("handles synchronous media setup errors", async () => {
    const audio = createAudio();
    vi.mocked(audio.load).mockImplementation(() => { throw new Error("Media unavailable"); });
    await expect(unlockAudioElement(audio)).resolves.toBe(false);
    await expect(playAudioSource(audio, "/audio/story.mp3")).resolves.toBe(false);
  });

  it("creates a valid five-second mono WAV by default", () => {
    const bytes = decodeDataUri(createTestToneDataUri());
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe("RIFF");
    expect(new TextDecoder().decode(bytes.slice(8, 12))).toBe("WAVE");
    expect(view.getUint32(24, true)).toBe(8_000);
    expect(view.getUint32(40, true)).toBe(40_000);
    expect(bytes).toHaveLength(40_044);
  });

  it("plays the generated tone on the provided element", async () => {
    const audio = createAudio();

    await expect(
      playTestTone(audio, { durationSeconds: 0.1, frequencyHz: 880 }),
    ).resolves.toBe(true);

    expect(audio.pause).toHaveBeenCalledOnce();
    expect(audio.load).toHaveBeenCalledOnce();
    expect(audio.play).toHaveBeenCalledOnce();
    expect(audio.currentTime).toBe(0);
    expect(audio.src).toMatch(/^data:audio\/wav;base64,/);
  });

  it("stops and rewinds playback", () => {
    const audio = createAudio();

    stopAudioElement(audio);

    expect(audio.pause).toHaveBeenCalledOnce();
    expect(audio.currentTime).toBe(0);
  });
});
