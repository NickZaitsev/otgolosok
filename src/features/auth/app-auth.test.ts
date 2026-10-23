import { describe, expect, it } from "vitest";
import { appAuthCallbacks, appAuthError, appAuthRedirect, appAuthTermsAccepted, isHandoffChallenge } from "./app-auth";
import { TERMS_VERSION } from "../../../legal/publication.mjs";

const challenge = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
const origin = "https://otgolosok.online";

describe("вход в мобильное приложение через Telegram", () => {
  it.each([
    [challenge, true],
    ["A".repeat(43), true],
    ["_-".repeat(21) + "a", true],
    ["A".repeat(42), false],
    ["A".repeat(44), false],
    [`${challenge.slice(0, 42)}+`, false],
    [`${challenge.slice(0, 42)}=`, false],
    [`${challenge.slice(0, 42)}/`, false],
    ["", false],
    [null, false],
    [42, false],
  ])("проверяет challenge %j", (value, valid) => {
    expect(isHandoffChallenge(value)).toBe(valid);
  });

  it("строит обратные адреса Telegram на странице завершения, которые пропускает safeReturnTo", () => {
    expect(appAuthCallbacks(challenge, origin)).toEqual({
      callbackURL: `/app-auth/telegram/complete?challenge=${challenge}`,
      errorCallbackURL: `/app-auth/telegram/complete?challenge=${challenge}&failed=1`,
    });
  });

  it("не строит обратные адреса для повреждённого challenge", () => {
    expect(() => appAuthCallbacks("../../evil", origin)).toThrow();
  });

  it.each([
    [TERMS_VERSION, true],
    ["", false],
    [null, false],
    ["2000-01-01", false],
  ])("считает условия принятыми только для актуальной версии: %j", (terms, accepted) => {
    expect(appAuthTermsAccepted(terms)).toBe(accepted);
  });

  it.each([
    ["TERMS_REQUIRED", "TERMS_REQUIRED"],
    ["access_denied", "CANCELLED"],
    ["cancelled", "CANCELLED"],
    ["LEGAL_UNAVAILABLE", "FAILED"],
    ["state_mismatch", "FAILED"],
    [null, "FAILED"],
  ] as const)("переводит ошибку Better Auth %j в %s", (error, expected) => {
    expect(appAuthError(error)).toBe(expected);
  });

  it("возвращает в приложение код или код ошибки", () => {
    expect(appAuthRedirect({ code: challenge })).toBe(`otgolosok-auth://telegram?code=${challenge}`);
    expect(appAuthRedirect({ error: "TERMS_REQUIRED" })).toBe("otgolosok-auth://telegram?error=TERMS_REQUIRED");
  });
});
