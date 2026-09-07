import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AUDIO_PLAY_TIMEOUT_MS,
  pauseAudioElement,
  playAudioSource,
  resumeAudioElement,
  seekAudioElement,
  stopAudioElement,
} from "./audio-element";

class DeferredAudio extends EventTarget {
  src = "existing.mp3";
  currentTime = 0;
  duration = Number.NaN;
  readyState = 0;
  preload = "";
  load = vi.fn();
  pause = vi.fn();
  play = vi.fn(() => Promise.resolve());
}

const asAudio = (audio: DeferredAudio) => audio as unknown as HTMLAudioElement;

describe("audio player saved-position controls", () => {
  afterEach(() => vi.useRealTimers());
  it("pauses and cancels pending playback without rewinding", async () => {
    const audio = new DeferredAudio();
    audio.currentTime = 4.5;
    let settle!: () => void;
    audio.play.mockReturnValueOnce(new Promise<void>((resolve) => { settle = resolve; }));

    const pending = resumeAudioElement(asAudio(audio));
    pauseAudioElement(asAudio(audio));
    settle();

    await expect(pending).resolves.toBe(false);
    expect(audio.pause).toHaveBeenCalledTimes(1);
    expect(audio.currentTime).toBe(4.5);
  });

  it("resumes the existing source and position without loading", async () => {
    const audio = new DeferredAudio();
    audio.src = "story.mp3";
    audio.currentTime = 7;

    const resumed = resumeAudioElement(asAudio(audio));

    expect(audio.play).toHaveBeenCalledTimes(1);
    expect(audio.load).not.toHaveBeenCalled();
    expect(audio.src).toBe("story.mp3");
    expect(audio.currentTime).toBe(7);
    await expect(resumed).resolves.toBe(true);
  });

  it("clamps finite seeks and reports invalid or failed assignments", () => {
    const audio = new DeferredAudio();
    audio.duration = 10;

    expect(seekAudioElement(asAudio(audio), -2)).toBe(0);
    expect(seekAudioElement(asAudio(audio), 99)).toBe(10);
    expect(seekAudioElement(asAudio(audio), Number.NaN)).toBeNull();
    audio.duration = Number.POSITIVE_INFINITY;
    expect(seekAudioElement(asAudio(audio), 2)).toBeNull();

    Object.defineProperty(audio, "currentTime", {
      configurable: true,
      set: () => { throw new Error("not seekable"); },
    });
    audio.duration = 10;
    expect(seekAudioElement(asAudio(audio), 2)).toBeNull();
  });

  it("starts playback synchronously and applies a positive offset after metadata", async () => {
    const audio = new DeferredAudio();

    const playing = playAudioSource(asAudio(audio), "story.mp3", 4);

    expect(audio.play).toHaveBeenCalledTimes(1);
    expect(audio.currentTime).toBe(0);
    audio.duration = 12;
    audio.dispatchEvent(new Event("loadedmetadata"));
    expect(audio.currentTime).toBe(4);
    await expect(playing).resolves.toBe(true);
  });

  it("clamps a deferred offset to the media duration", async () => {
    const audio = new DeferredAudio();
    const playing = playAudioSource(asAudio(audio), "story.mp3", 50);

    audio.duration = 12;
    audio.dispatchEvent(new Event("loadedmetadata"));

    expect(audio.currentTime).toBe(12);
    await expect(playing).resolves.toBe(true);
  });

  it("removes a deferred offset when paused or superseded", async () => {
    const audio = new DeferredAudio();
    const first = playAudioSource(asAudio(audio), "one.mp3", 5);
    pauseAudioElement(asAudio(audio));
    audio.duration = 10;
    audio.dispatchEvent(new Event("loadedmetadata"));
    expect(audio.currentTime).toBe(0);
    await expect(first).resolves.toBe(false);

    const second = playAudioSource(asAudio(audio), "two.mp3", 6);
    const third = playAudioSource(asAudio(audio), "three.mp3");
    audio.dispatchEvent(new Event("loadedmetadata"));
    expect(audio.currentTime).toBe(0);
    await expect(second).resolves.toBe(false);
    await expect(third).resolves.toBe(true);
  });

  it("does not restore from stale duration before new metadata arrives", async () => {
    const audio = new DeferredAudio();
    audio.duration = 8;
    const playing = playAudioSource(asAudio(audio), "new.mp3", 15);
    expect(audio.currentTime).toBe(0);
    audio.duration = 30;
    audio.readyState = 1;
    audio.dispatchEvent(new Event("loadedmetadata"));
    expect(audio.currentTime).toBe(15);
    await expect(playing).resolves.toBe(true);
  });

  it("restores immediately when load synchronously provides metadata", async () => {
    const audio = new DeferredAudio();
    audio.load.mockImplementation(() => { audio.duration = 30; audio.readyState = 1; });
    const playing = playAudioSource(asAudio(audio), "cached.mp3", 15);
    expect(audio.currentTime).toBe(15);
    expect(audio.play).toHaveBeenCalledTimes(1);
    await expect(playing).resolves.toBe(true);
  });

  it("stops and removes the pending metadata offset after exiting", async () => {
    const audio = new DeferredAudio();
    const playing = playAudioSource(asAudio(audio), "story.mp3", 5);
    stopAudioElement(asAudio(audio));
    audio.duration = 10;
    audio.dispatchEvent(new Event("loadedmetadata"));
    expect(audio.currentTime).toBe(0);
    await expect(playing).resolves.toBe(false);
  });

  it("times out hung playback and prevents late metadata from restoring the old offset", async () => {
    vi.useFakeTimers();
    const audio = new DeferredAudio();
    audio.play.mockReturnValueOnce(new Promise<void>(() => {}));
    const playing = playAudioSource(asAudio(audio), "hung.mp3", 5);
    await vi.advanceTimersByTimeAsync(AUDIO_PLAY_TIMEOUT_MS);
    await expect(playing).resolves.toBe(false);
    audio.duration = 10;
    audio.dispatchEvent(new Event("loadedmetadata"));
    expect(audio.currentTime).toBe(0);
    expect(audio.pause).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });
});
