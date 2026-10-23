import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { APIError } from "better-auth/api";
import { freshTelegramSession, publicAccountUser, sessionCsrfToken, validSessionCsrf } from "./auth.mjs";
import { createReviewRateLimiter } from "./walk-reviews.mjs";

/**
 * Sign-in handoff from the site to the mobile app (PKCE-like). The site page that finished a
 * Telegram sign-in asks for a single-use code bound to the app's challenge; the app redeems it
 * with the verifier and receives its own Better Auth session. Codes are stored only as SHA-256.
 */
export const HANDOFF_TTL_MS = 60_000;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
// RFC 7636 verifier: 43–128 unreserved characters; the app sends 32 random bytes (43 characters).
const VERIFIER = /^[A-Za-z0-9_-]{43,128}$/;
const digest = value => createHash("sha256").update(value, "utf8").digest();

/** `base64url(sha256(verifier))`, the PKCE S256 transform. */
export const handoffChallenge = verifier => digest(verifier).toString("base64url");
export const validChallenge = value => typeof value === "string" && TOKEN.test(value);

/** @param {import("node:sqlite").DatabaseSync} db */
export function createMobileAuthStore(db, { now = Date.now } = {}) {
  db.exec(`CREATE TABLE IF NOT EXISTS mobile_auth_handoff (
    id TEXT PRIMARY KEY, code_hash TEXT NOT NULL UNIQUE, challenge TEXT NOT NULL,
    user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
    auth_provider TEXT NOT NULL CHECK (auth_provider IN ('password','telegram')),
    created_at INTEGER NOT NULL, used_at INTEGER
  ); CREATE INDEX IF NOT EXISTS mobile_auth_handoff_created ON mobile_auth_handoff(created_at);`);
  const cleanup = time => db.prepare("DELETE FROM mobile_auth_handoff WHERE created_at <= ?").run(time - HANDOFF_TTL_MS);
  return {
    /** @param {{userId: string, challenge: string, authProvider: "password" | "telegram"}} input @returns {string} the code */
    issue({ userId, challenge, authProvider }) {
      if (!validChallenge(challenge)) throw new TypeError("Invalid handoff challenge");
      const time = now();
      cleanup(time);
      const code = randomBytes(32).toString("base64url");
      db.prepare("INSERT INTO mobile_auth_handoff(id,code_hash,challenge,user_id,auth_provider,created_at) VALUES(?,?,?,?,?,?)")
        .run(randomUUID(), digest(code).toString("hex"), challenge, userId, authProvider, time);
      return code;
    },
    /**
     * Redeems a code once. The code is spent by the first presentation, even with a wrong
     * verifier: an intercepted code cannot be retried against the verifier.
     * @returns {{userId: string, authProvider: "password" | "telegram"} | null}
     */
    redeem({ code, verifier }) {
      if (typeof code !== "string" || !TOKEN.test(code) || typeof verifier !== "string" || !VERIFIER.test(verifier)) return null;
      const time = now();
      cleanup(time);
      const row = /** @type {{challenge: string, user_id: string, auth_provider: "password" | "telegram"} | undefined} */ (db.prepare(
        "UPDATE mobile_auth_handoff SET used_at=? WHERE code_hash=? AND used_at IS NULL AND created_at>? RETURNING challenge,user_id,auth_provider",
      ).get(time, digest(code).toString("hex"), time - HANDOFF_TTL_MS));
      if (!row) return null;
      const expected = Buffer.from(row.challenge), actual = Buffer.from(handoffChallenge(verifier));
      if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
      return { userId: row.user_id, authProvider: row.auth_provider };
    },
  };
}

const INVALID = { error: { code: "HANDOFF_INVALID", message: "Ссылка для входа устарела. Войдите ещё раз." } };

/**
 * POST /api/mobile-auth/handoff {challenge} → {code}: signed-in browser, same origin, CSRF.
 * POST /api/mobile-auth/exchange {code, verifier} → {user, csrfToken} and the session cookie; the
 * session the app presented (if any) is revoked.
 */
export function createMobileAuthRoutes({ auth, accountStore, origin, authSecret, json, body,
  limiter = createReviewRateLimiter({ limit: 20, windowMs: 60_000 }),
  handoffLimiter = createReviewRateLimiter({ limit: 10, windowMs: 60_000 }) }) {
  const store = accountStore?.mobileAuthHandoffs ?? null;
  const limited = (res, check) => {
    res.setHeader("Retry-After", String(check.retryAfterSec));
    json(res, 429, { error: { code: "RATE_LIMITED", message: "Слишком много попыток. Повторите позже." } });
  };
  return async (req, res, url, session) => {
    const handoff = url.pathname === "/api/mobile-auth/handoff", exchange = url.pathname === "/api/mobile-auth/exchange";
    if (!handoff && !exchange) return false;
    if (req.method !== "POST") { res.setHeader("Allow", "POST"); json(res, 405, { error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed." } }); return true; }
    if (!auth || !store) { json(res, 503, { error: { code: "AUTH_UNAVAILABLE", message: "Вход временно недоступен." } }); return true; }
    if (handoff) {
      if (!session) { json(res, 401, { error: { code: "UNAUTHORIZED", message: "Войдите в аккаунт." } }); return true; }
      if (!origin || req.headers.origin !== origin || req.headers["sec-fetch-site"] === "cross-site" || url.search) {
        json(res, 403, { error: { code: "FORBIDDEN", message: "Same-origin request required." } }); return true;
      }
      if (!validSessionCsrf(authSecret, session.session.id, req.headers["x-csrf-token"])) {
        json(res, 403, { error: { code: "CSRF", message: "Обновите страницу и повторите действие." } }); return true;
      }
      const budget = handoffLimiter.check(session.user.id);
      if (!budget.allowed) { limited(res, budget); return true; }
      handoffLimiter.record(session.user.id);
      const input = await body(req, 1024);
      if (Object.keys(input).some(key => key !== "challenge") || !validChallenge(input.challenge)) {
        json(res, 400, { error: { code: "BAD_REQUEST", message: "Некорректный запрос входа." } }); return true;
      }
      // A stale Telegram session must not mint a fresh one: the app session would then pass
      // the 5-minute Telegram re-authentication check for account deletion.
      const authProvider = freshTelegramSession(session.session) ? "telegram" : "password";
      json(res, 200, { code: store.issue({ userId: session.user.id, challenge: input.challenge, authProvider }) });
      return true;
    }
    if (req.headers.origin !== origin || ![undefined, "same-origin", "none"].includes(req.headers["sec-fetch-site"]) || url.search) {
      json(res, 403, { error: { code: "FORBIDDEN", message: "Same-origin request required." } }); return true;
    }
    // X-Real-IP is overwritten by nginx, as for Better Auth rate limiting.
    const key = String(req.headers["x-real-ip"] ?? req.socket.remoteAddress ?? "unknown");
    const budget = limiter.check(key);
    if (!budget.allowed) { limited(res, budget); return true; }
    limiter.record(key);
    let input;
    try { input = await body(req, 1024); } catch { json(res, 400, INVALID); return true; }
    if (Object.keys(input).some(name => !["code", "verifier"].includes(name))) { json(res, 400, INVALID); return true; }
    const redeemed = store.redeem({ code: input.code, verifier: input.verifier });
    if (!redeemed) { json(res, 400, INVALID); return true; }
    const headers = new Headers();
    for (const name of ["user-agent", "x-real-ip"]) {
      const value = req.headers[name];
      if (typeof value === "string") headers.set(name, value);
    }
    let issued;
    try {
      issued = await auth.api.issueMobileSession({ body: { ...redeemed, replaceToken: session?.session.token }, headers, returnHeaders: true });
    } catch (error) {
      // The user was deleted between handoff and exchange.
      if (error instanceof APIError && error.status === "BAD_REQUEST") { json(res, 400, INVALID); return true; }
      throw error;
    }
    const { session: created, user } = issued.response;
    res.setHeader("Set-Cookie", issued.headers.getSetCookie());
    json(res, 200, { user: publicAccountUser(user, created, accountStore, true), csrfToken: sessionCsrfToken(authSecret, created.id) });
    return true;
  };
}
