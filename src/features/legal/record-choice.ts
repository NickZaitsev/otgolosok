import { COOKIE_CONSENT_VERSION, cookieReceipt, cookieRecord, saveCookieChoice } from "./cookie-consent";

async function record(analytics: boolean, receipt: string | null) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch("/api/legal/analytics-choice", {
        method: "POST", credentials: "same-origin", cache: "no-store", signal: AbortSignal.timeout(10_000),
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ analytics, receipt, version: COOKIE_CONSENT_VERSION }),
      });
      if (!response.ok) {
        if (response.status !== 429 && response.status < 500) throw Object.assign(new Error("Не удалось сохранить выбор."), { deterministic: true });
        throw new Error("Не удалось сохранить выбор.");
      }
      return await response.json().catch(() => { throw Object.assign(new Error("Некорректное подтверждение выбора."), { deterministic: true }); }) as { receipt: string | null; decidedAt?: number };
    } catch (error) {
      if (attempt === 2 || (error as { deterministic?: boolean })?.deterministic) throw error;
      await new Promise(resolve => setTimeout(resolve, 250 * 2 ** attempt));
    }
  }
  throw new Error("Не удалось сохранить выбор.");
}

/** Revocation stops tracking locally before waiting for the server. */
export async function recordCookieChoice(analytics: boolean) {
  const initialRecord = cookieRecord();
  const previous = cookieReceipt();
  if (!analytics) {
    saveCookieChoice(false, previous);
    if (!previous) return;
    await record(false, previous);
    saveCookieChoice(false);
    return;
  }
  const result = await record(true, previous);
  if (cookieRecord() !== initialRecord) {
    if (result.receipt) await record(false, result.receipt);
    throw new Error("Выбор cookie изменился на другой вкладке.");
  }
  if (typeof result.receipt !== "string" || !/^[a-f0-9-]{36}\.[A-Za-z0-9_-]{43}$/.test(result.receipt) ||
    !Number.isFinite(result.decidedAt) || !saveCookieChoice(true, result.receipt, Math.min(Date.now(), result.decidedAt!))) {
    saveCookieChoice(false, result.receipt);
    if (result.receipt) await record(false, result.receipt);
    throw new Error("Не удалось сохранить выбор. Аналитика остаётся выключенной.");
  }
}
