"use client";

import { useCallback, useSyncExternalStore } from "react";
import { parsePlaybackCheckpoint, playbackStorageKey, type PlaybackChapter, type PlaybackCheckpoint } from "@/lib/audio/playback-progress";

const changeEvent = "otgolosok-playback-change";
const serverSnapshot = () => null;

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(changeEvent, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(changeEvent, onChange);
  };
}

export function usePlaybackProgress(routeId: string, chapters: PlaybackChapter[]) {
  const key = playbackStorageKey(routeId);
  const getSnapshot = useCallback(() => {
    try { return window.localStorage.getItem(key); } catch { return null; }
  }, [key]);
  // A string snapshot stays stable between writes and matches SSR on hydration.
  const raw = useSyncExternalStore(subscribe, getSnapshot, serverSnapshot);
  const saveCheckpoint = useCallback((checkpoint: PlaybackCheckpoint) => {
    try {
      window.localStorage.setItem(key, JSON.stringify(checkpoint));
      window.dispatchEvent(new Event(changeEvent));
      return true;
    } catch { return false; }
  }, [key]);
  const clearCheckpoint = useCallback(() => {
    try {
      window.localStorage.removeItem(key);
      window.dispatchEvent(new Event(changeEvent));
    } catch { /* Storage restrictions must not prevent listening. */ }
  }, [key]);
  return { savedCheckpoint: parsePlaybackCheckpoint(raw, routeId, chapters), saveCheckpoint, clearCheckpoint };
}
