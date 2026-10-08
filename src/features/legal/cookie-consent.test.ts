// @vitest-environment jsdom
import { beforeEach, afterEach, expect, it, vi } from "vitest";

beforeEach(() => { vi.resetModules(); localStorage.clear(); });
afterEach(() => vi.restoreAllMocks());
const receipt = "11111111-1111-4111-8111-111111111111." + "a".repeat(43);

it("сохраняет отдельный выбор и срок с версией и подтверждением сервера", async () => {
  const {cookieChoice, saveCookieChoice, COOKIE_CONSENT_KEY, COOKIE_CONSENT_VERSION} = await import("./cookie-consent");
  expect(cookieChoice()).toBeNull();
  expect(saveCookieChoice(true, receipt)).toBe(true);
  expect(cookieChoice()).toBe("accepted");
  expect(JSON.parse(localStorage.getItem(COOKIE_CONSENT_KEY)!)).toEqual(expect.objectContaining({version: COOKIE_CONSENT_VERSION, analytics: true, receipt, decidedAt: expect.any(Number)}));
  saveCookieChoice(false);
  expect(cookieChoice()).toBe("rejected");
});

it.each(["bad-json", "expired", "future", "old-version", "missing-receipt", "wrong-type"])("не считает %s согласием", async scenario => {
  const {cookieChoice, COOKIE_CONSENT_KEY, COOKIE_CONSENT_VERSION, COOKIE_CHOICE_LIFETIME} = await import("./cookie-consent");
  const value = {analytics: true as unknown, version: COOKIE_CONSENT_VERSION, decidedAt: Date.now(), receipt: receipt as string | undefined};
  if (scenario === "expired") value.decidedAt -= COOKIE_CHOICE_LIFETIME;
  if (scenario === "future") value.decidedAt += 10_000;
  if (scenario === "old-version") value.version = "old";
  if (scenario === "missing-receipt") delete value.receipt;
  if (scenario === "wrong-type") value.analytics = "true";
  localStorage.setItem(COOKIE_CONSENT_KEY, scenario === "bad-json" ? "invalid" : JSON.stringify(value));
  expect(cookieChoice()).toBeNull();
});

it("ошибка хранилища не разрешает аналитику и сохраняет локальный отказ", async () => {
  const {cookieChoice, saveCookieChoice} = await import("./cookie-consent");
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {throw new Error("quota");});
  expect(saveCookieChoice(true, receipt)).toBe(false);
  expect(cookieChoice()).toBe("rejected");
});

it("сообщает о выборе из другой вкладки и снимает подписки", async () => {
  const {subscribeCookieChoice, COOKIE_CONSENT_KEY, cookieChoice, saveCookieChoice} = await import("./cookie-consent");
  const choices: unknown[] = [];
  const unsubscribe = subscribeCookieChoice(() => choices.push(cookieChoice()));
  saveCookieChoice(true, receipt);
  localStorage.removeItem(COOKIE_CONSENT_KEY);
  window.dispatchEvent(new StorageEvent("storage", {key: COOKIE_CONSENT_KEY}));
  unsubscribe();
  saveCookieChoice(false);
  expect(choices).toEqual(["accepted", null]);
});
