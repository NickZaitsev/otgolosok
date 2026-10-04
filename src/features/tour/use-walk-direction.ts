"use client";

import { useCallback, useSyncExternalStore } from "react";
import type { WalkDirection } from "./walk-direction";

const changeEvent = "otgolosok-walk-direction-change";
const sessionDirections = new Map<string, WalkDirection>();
const serverSnapshot = (): WalkDirection => "forward";

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(changeEvent, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(changeEvent, onChange);
  };
}

export function useWalkDirection(routeId: string) {
  const key = `otgolosok:walk-direction:${routeId}`;
  const read = useCallback((): WalkDirection => {
    const session = sessionDirections.get(key);
    if (session) return session;
    try {
      const stored = window.localStorage.getItem(key);
      if (stored !== null) return stored === "reverse" ? "reverse" : "forward";
    } catch { /* The choice stays available in memory when storage is restricted. */ }
    return "forward";
  }, [key]);
  const direction = useSyncExternalStore(subscribe, read, serverSnapshot);
  const setDirection = useCallback((value: WalkDirection) => {
    try {
      window.localStorage.setItem(key, value);
      sessionDirections.delete(key);
    } catch { sessionDirections.set(key, value); }
    window.dispatchEvent(new Event(changeEvent));
  }, [key]);
  return { direction, setDirection };
}
