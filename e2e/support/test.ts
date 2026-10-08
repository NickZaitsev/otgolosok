import { test as base } from "@playwright/test";
import { COOKIE_CONSENT_KEY, COOKIE_CONSENT_VERSION } from "../../src/features/legal/cookie-consent";

export { expect } from "@playwright/test";
export type { Locator, Page } from "@playwright/test";

/**
 * Every e2e test runs with silent media. Headless Chromium mutes itself, but WebKit
 * plays real story audio through the speakers, and so does any browser run with --headed.
 */
export const test = base.extend<{ silentMedia: void; essentialCookies: boolean; cookieChoice: void }>({
  essentialCookies: [true, { option: true }],
  cookieChoice: [async ({ page, essentialCookies }, use) => {
    // Scenarios unrelated to consent use the app after an explicit refusal.
    if (essentialCookies) await page.addInitScript(({ key, version }) => {
      localStorage.setItem(key, JSON.stringify({version, analytics: false, decidedAt: Date.now()}));
    }, { key: COOKIE_CONSENT_KEY, version: COOKIE_CONSENT_VERSION });
    await use();
  }, { auto: true }],
  silentMedia: [async ({ page }, use) => {
    await page.addInitScript(() => {
      const play = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
        this.muted = true;
        return play.call(this);
      };
    });
    await use();
  }, { auto: true }],
});
