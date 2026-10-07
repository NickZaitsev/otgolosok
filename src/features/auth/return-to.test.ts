import { describe, expect, it } from "vitest";
import { safeReturnTo } from "./return-to";

describe("safeReturnTo", () => {
  const origin = "https://otgolosok.test";
  it.each([
    ["/walk?id=one#map", "/walk?id=one#map"],
    [null, "/account"],
    ["//evil.test/path", "/account"],
    ["/\\evil.test/path", "/account"],
    ["https://evil.test/path", "/account"],
    ["javascript:alert(1)", "/account"],
    ["\u0000/path", "/account"],
  ])("maps %s to %s", (value, expected) => expect(safeReturnTo(value, origin)).toBe(expected));

  it.each([
    ["en", null, "/en/account"],
    ["zh", "https://evil.test/path", "/zh/account"],
    ["en", "/walk?id=one#map", "/en/walk?id=one#map"],
    ["zh", "/zh/history", "/zh/history"],
  ] as const)("keeps %s redirects on the same origin and locale", (locale, value, expected) => {
    expect(safeReturnTo(value, origin, locale)).toBe(expected);
  });
});
