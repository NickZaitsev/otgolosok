import { safeReturnTo } from "./return-to";
import { TERMS_VERSION } from "../../../legal/publication.mjs";

/**
 * Telegram sign-in for the mobile app: the app opens /app-auth/telegram in a Custom Tab with a
 * PKCE-style challenge, the site signs in through Telegram, trades its browser session for a
 * single-use code (POST /api/mobile-auth/handoff) and returns to the app through this scheme.
 */
export const APP_AUTH_CALLBACK = "otgolosok-auth://telegram";
export const APP_AUTH_START_PATH = "/app-auth/telegram";
export const APP_AUTH_COMPLETE_PATH = "/app-auth/telegram/complete";

export type AppAuthError = "TERMS_REQUIRED" | "CANCELLED" | "FAILED";

/** base64url(SHA-256(verifier)): exactly 43 base64url characters. */
export function isHandoffChallenge(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
}

/** A handoff code from POST /api/mobile-auth/handoff: 32 random bytes, base64url. */
export const isHandoffCode = isHandoffChallenge;

/** The app sends the terms version it showed; only the current one counts as acceptance. */
export const appAuthTermsAccepted = (terms: string | null) => terms === TERMS_VERSION;

/** Same-origin Telegram callbacks that carry the challenge to the completion page. */
export function appAuthCallbacks(challenge: string, origin: string) {
  if (!isHandoffChallenge(challenge)) throw new Error("Invalid handoff challenge");
  const callback = `${APP_AUTH_COMPLETE_PATH}?${new URLSearchParams({ challenge })}`;
  const failure = `${callback}&failed=1`;
  const callbackURL = safeReturnTo(callback, origin, "ru"), errorCallbackURL = safeReturnTo(failure, origin, "ru");
  // safeReturnTo falls back to /account for anything it does not accept; that would lose the app.
  if (callbackURL !== callback || errorCallbackURL !== failure) throw new Error("Unsafe app sign-in callback");
  return { callbackURL, errorCallbackURL };
}

/** Maps Better Auth's `error` callback parameter to what the app shows. */
export function appAuthError(error: string | null): AppAuthError {
  if (error === "TERMS_REQUIRED") return "TERMS_REQUIRED";
  if (error === "access_denied" || error === "cancelled" || error === "canceled") return "CANCELLED";
  return "FAILED";
}

export function appAuthRedirect(result: { code: string } | { error: AppAuthError }): string {
  const parameters = new URLSearchParams("code" in result ? [["code", result.code]] : [["error", result.error]]);
  return `${APP_AUTH_CALLBACK}?${parameters}`;
}
