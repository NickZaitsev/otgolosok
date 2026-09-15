"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";

/**
 * How the next chapter starts. The walk is designed to be heard without looking
 * at the screen, and the three answers to that are genuinely different walks.
 */
export type AdvanceMode = "manual" | "place" | "sequence";

export const advanceModes: readonly AdvanceMode[] = ["manual", "place", "sequence"];

export const advanceModeLabels: Record<AdvanceMode, string> = {
  manual: "По кнопке",
  place: "По месту",
  sequence: "Подряд",
};

export const advanceModeHints: Record<AdvanceMode, string> = {
  manual: "Следующая часть включается кнопкой «Дальше» или с экрана блокировки.",
  place: "Часть включится сама, когда вы дойдёте до её дома. Нужен доступ к геолокации.",
  sequence: "Части идут одна за другой без пауз. Удобно дома, на ходу можно отстать от рассказа.",
};

export const playbackRates = [0.8, 1, 1.25, 1.5] as const;
export type PlaybackRate = typeof playbackRates[number];

export type WalkSettings = { advance: AdvanceMode; rate: PlaybackRate };

// Place-based start stays opt-in until the stops of the first walk are checked
// on the ground; README records that field check as still pending.
export const defaultWalkSettings: WalkSettings = { advance: "manual", rate: 1 };

export const WALK_SETTINGS_KEY = "otgolosok:walk-settings";

export function parseWalkSettings(raw: string | null): WalkSettings {
  if (!raw || raw.length > 512) return defaultWalkSettings;
  try {
    const saved: unknown = JSON.parse(raw);
    if (!saved || typeof saved !== "object") return defaultWalkSettings;
    const { advance, rate } = saved as { advance?: unknown; rate?: unknown };
    return {
      advance: advanceModes.includes(advance as AdvanceMode) ? advance as AdvanceMode : defaultWalkSettings.advance,
      rate: playbackRates.includes(rate as PlaybackRate) ? rate as PlaybackRate : defaultWalkSettings.rate,
    };
  } catch {
    return defaultWalkSettings;
  }
}

const changeEvent = "otgolosok-walk-settings-change";
const serverSnapshot = () => null;
// Kept for browsers that refuse storage: the choice still holds for this session.
let sessionSettings: string | null = null;

function readSettings() {
  try { return window.localStorage.getItem(WALK_SETTINGS_KEY) ?? sessionSettings; }
  catch { return sessionSettings; }
}

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(changeEvent, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(changeEvent, onChange);
  };
}

export function useWalkSettings() {
  // A string snapshot stays stable between writes and matches the prerender.
  const raw = useSyncExternalStore(subscribe, readSettings, serverSnapshot);
  const settings = useMemo(() => parseWalkSettings(raw), [raw]);
  const updateSettings = useCallback((patch: Partial<WalkSettings>) => {
    const next = JSON.stringify({ ...parseWalkSettings(readSettings()), ...patch });
    sessionSettings = next;
    try { window.localStorage.setItem(WALK_SETTINGS_KEY, next); }
    catch { /* The choice still applies to this session. */ }
    window.dispatchEvent(new Event(changeEvent));
  }, []);
  return { settings, updateSettings };
}
