import { describe, expect, it } from "vitest";
import { contentSecurityPolicy } from "../../../scripts/content-security-policy.mjs";
import { CONSENT_KEY, CONSENT_LIFETIME_MS, CONSENT_VERSION, METRIKA_COLLECTORS, METRIKA_ID } from "../../../backend/place-metrika.mjs";
import { COOKIE_CHOICE_LIFETIME, COOKIE_CONSENT_KEY, COOKIE_CONSENT_VERSION } from "../legal/cookie-consent";
import { METRIKA_ID as SITE_METRIKA_ID } from "./metrika";

// Place pages are rendered by the backend with their own copy of the counter rules: they must not drift apart.
describe("счётчик страниц мест совпадает с правилами сайта", () => {
  it("читает то же согласие на cookie с той же версией и сроком", () => {
    expect([CONSENT_KEY, CONSENT_VERSION, CONSENT_LIFETIME_MS]).toEqual([COOKIE_CONSENT_KEY, COOKIE_CONSENT_VERSION, COOKIE_CHOICE_LIFETIME]);
  });

  it("использует тот же счётчик и разрешённые сайтом коллекторы", () => {
    expect(METRIKA_ID).toBe(SITE_METRIKA_ID);
    const connect = contentSecurityPolicy([]).split("; ").find((directive: string) => directive.startsWith("connect-src"));
    for (const origin of METRIKA_COLLECTORS) expect(connect).toContain(origin);
  });
});
