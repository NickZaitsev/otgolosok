"use client";

import { useMemo, useSyncExternalStore } from "react";

export type TravelMode = "walking" | "driving";
export const TRAVEL_SETTINGS_KEY = "otgolosok:travel-mode";
export const parseTravelMode = (value: unknown): TravelMode => value === "driving" ? "driving" : "walking";
const changeEvent = "otgolosok-travel-mode-change";

/** A denied or full browser storage still keeps the preference for this session. */
export function createTravelSettingsStore(getStorage: () => Pick<Storage, "getItem" | "setItem">, getEvents: () => EventTarget) {
  let sessionMode: TravelMode | null = null;
  let storageFailed = false;
  const read = (): TravelMode => {
    if (storageFailed && sessionMode) return sessionMode;
    try { return parseTravelMode(getStorage().getItem(TRAVEL_SETTINGS_KEY)); }
    catch { return sessionMode ?? "walking"; }
  };
  const update = (mode: TravelMode) => {
    const next = parseTravelMode(mode);
    sessionMode = next;
    try { getStorage().setItem(TRAVEL_SETTINGS_KEY, next); storageFailed = false; }
    catch { storageFailed = true; }
    getEvents().dispatchEvent(new Event(changeEvent));
  };
  const subscribe = (onChange: () => void) => {
    const events = getEvents();
    const storageChanged = () => { storageFailed = false; onChange(); };
    events.addEventListener("storage", storageChanged);
    events.addEventListener(changeEvent, onChange);
    return () => { events.removeEventListener("storage", storageChanged); events.removeEventListener(changeEvent, onChange); };
  };
  return { read, update, subscribe };
}
const store = createTravelSettingsStore(() => window.localStorage, () => window);
export const readPreferredTravelMode = store.read;
const serverSnapshot = (): TravelMode => "walking";
export function useTravelSettings() {
  const travelMode = useSyncExternalStore(store.subscribe, store.read, serverSnapshot);
  return useMemo(() => ({ travelMode, setTravelMode: store.update }), [travelMode]);
}
