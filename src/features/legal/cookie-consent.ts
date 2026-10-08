export const COOKIE_CONSENT_KEY = "otgolosok:cookie-choice";
export const COOKIE_CONSENT_VERSION = "2026-10-08";
export const COOKIE_CONSENT_EVENT = "otgolosok:cookie-choice-changed";
export const COOKIE_SETTINGS_EVENT = "otgolosok:cookie-settings";
export const COOKIE_CHOICE_LIFETIME = 180 * 24 * 60 * 60 * 1000;
export type CookieChoice = "accepted" | "rejected" | null;

let rejectedInMemory = false;

export function cookieChoice(): CookieChoice {
  if (typeof window === "undefined") return null;
  if (rejectedInMemory) return "rejected";
  try {
    const value = JSON.parse(localStorage.getItem(COOKIE_CONSENT_KEY) ?? "null");
    if (!value || value.version !== COOKIE_CONSENT_VERSION ||
      typeof value.analytics !== "boolean" || !Number.isFinite(value.decidedAt) ||
      value.decidedAt > Date.now() || Date.now() - value.decidedAt >= COOKIE_CHOICE_LIFETIME) return null;
    if (value.analytics && (typeof value.receipt !== "string" || !/^[a-f0-9-]{36}\.[A-Za-z0-9_-]{43}$/.test(value.receipt))) return null;
    return value.analytics ? "accepted" : "rejected";
  } catch { return null; }
}

/** An opt-in requires a durable record; storage errors never enable tracking. */
export function saveCookieChoice(analytics: boolean, receipt: string | null = null, decidedAt = Date.now()): boolean {
  try {
    localStorage.setItem(COOKIE_CONSENT_KEY, JSON.stringify({
      version: COOKIE_CONSENT_VERSION, analytics, decidedAt, receipt,
    }));
    rejectedInMemory = false;
  } catch {
    rejectedInMemory = true;
    window.dispatchEvent(new Event(COOKIE_CONSENT_EVENT));
    return false;
  }
  window.dispatchEvent(new Event(COOKIE_CONSENT_EVENT));
  return true;
}

export function cookieReceipt(): string | null {
  try { return JSON.parse(localStorage.getItem(COOKIE_CONSENT_KEY) ?? "null")?.receipt ?? null; }
  catch { return null; }
}

export function cookieRecord(): string | null {
  try { return localStorage.getItem(COOKIE_CONSENT_KEY); }
  catch { return null; }
}

export function subscribeCookieChoice(notify: () => void) {
  const storage = (event: StorageEvent) => {
    if (event.key === COOKIE_CONSENT_KEY || event.key === null) {
      rejectedInMemory = false;
      notify();
    }
  };
  window.addEventListener("storage", storage);
  window.addEventListener(COOKIE_CONSENT_EVENT, notify);
  window.addEventListener("focus", notify);
  return () => {
    window.removeEventListener("storage", storage);
    window.removeEventListener(COOKIE_CONSENT_EVENT, notify);
    window.removeEventListener("focus", notify);
  };
}

export function openCookieSettings() {
  window.dispatchEvent(new Event(COOKIE_SETTINGS_EVENT));
}
