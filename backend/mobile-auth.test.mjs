import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exportJWK, SignJWT } from "jose";
import { createAuth, freshTelegramSession, TELEGRAM_REAUTH_WINDOW_MS } from "./auth.mjs";
import { createAccountStore } from "./account-store.mjs";
import { createStore } from "./store.mjs";
import { createApp } from "./server.mjs";
import { createReviewRateLimiter } from "./walk-reviews.mjs";
import { createMobileAuthStore, handoffChallenge, HANDOFF_TTL_MS } from "./mobile-auth.mjs";
import { LEGAL_READY, TERMS_VERSION } from "../legal/publication.mjs";

const origin = "https://otgolosok.test";
const secret = "mobile-auth-test-secret-with-more-than-32-characters";
const json = { Origin: origin, "Content-Type": "application/json" };
const pkce = () => { const verifier = randomBytes(32).toString("base64url"); return { verifier, challenge: handoffChallenge(verifier) }; };
const cookieOf = response => response.headers.getSetCookie().map(value => value.split(";", 1)[0]).join("; ");
let ip = 1;
const nextIp = () => `10.0.0.${ip++}`;

/**
 * A Better Auth runtime with a mocked Telegram OIDC provider and the HTTP app in front of it.
 * @param {import("node:test").TestContext} t
 * @param {{production?: boolean, mobileAuthLimiter?: ReturnType<typeof createReviewRateLimiter>}} [options]
 */
async function fixture(t, { production = true, mobileAuthLimiter } = {}) {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = { ...await exportJWK(publicKey), kid: "mobile-key", alg: "RS256", use: "sig" };
  const codes = new Map(), clientId = "123456789";
  const fetchImpl = async (input, init) => {
    if (String(input).endsWith("/.well-known/jwks.json")) return Response.json({ keys: [jwk] });
    const claims = codes.get(init.body.get("code"));
    if (!claims) return Response.json({ error: "invalid_grant" }, { status: 400 });
    const now = Math.floor(Date.now() / 1000);
    const idToken = await new SignJWT({ iss: "https://oauth.telegram.org", aud: clientId, iat: now, exp: now + 300, name: "Мария", ...claims })
      .setProtectedHeader({ alg: "RS256", kid: jwk.kid }).sign(privateKey);
    return Response.json({ id_token: idToken, access_token: "private-access-token", token_type: "Bearer", expires_in: 300 });
  };
  const runtime = await createAuth({ databasePath: ":memory:", baseURL: origin, secret, production, legalReady: true,
    telegram: { clientId, clientSecret: "private-test-secret" }, telegramDependencies: { fetchImpl } });
  const accountStore = createAccountStore(runtime.accountDatabase);
  const directory = await mkdtemp(join(tmpdir(), "mobile-auth-"));
  const store = createStore(":memory:");
  const app = createApp({ store, origin, audioDirectory: directory, workerEnabled: false, auth: runtime.auth, accountStore, authSecret: secret,
    ...(mobileAuthLimiter ? { mobileAuthLimiter } : {}) });
  await /** @type {Promise<void>} */ (new Promise(resolve => app.server.listen(0, "127.0.0.1", resolve)));
  const base = `http://127.0.0.1:${/** @type {import("node:net").AddressInfo} */ (app.server.address()).port}`;
  t.after(async () => { await app.close(); store.close(); runtime.close(); await rm(directory, { recursive: true, force: true }); });
  /** Runs the site's Telegram sign-in with the app-auth callbacks and returns the browser cookie. */
  async function telegramCallback(sub, challenge, termsAccepted = true) {
    const callbackURL = `/app-auth/telegram/complete?challenge=${challenge}`;
    const started = await runtime.auth.handler(new Request(origin + "/api/auth/sign-in/social", { method: "POST", headers: { ...json, "X-Real-IP": nextIp() },
      body: JSON.stringify({ provider: "telegram", callbackURL, errorCallbackURL: `${callbackURL}&failed=1`, disableRedirect: true, termsAccepted, termsVersion: TERMS_VERSION }) }));
    assert.equal(started.status, 200);
    const url = new URL(/** @type {any} */ (await started.json()).url), code = crypto.randomUUID();
    codes.set(code, { sub, nonce: url.searchParams.get("nonce") });
    const callback = await runtime.auth.handler(new Request(`${origin}/api/auth/callback/telegram?code=${code}&state=${url.searchParams.get("state")}`,
      { headers: { Cookie: cookieOf(started), "X-Real-IP": nextIp() } }));
    assert.equal(callback.status, 302);
    return { callback, callbackURL };
  }
  async function telegramLogin(sub, challenge) {
    const { callback, callbackURL } = await telegramCallback(sub, challenge);
    assert.equal(callback.headers.get("location"), callbackURL);
    return cookieOf(callback);
  }
  async function passwordLogin(email) {
    const response = await runtime.auth.handler(new Request(origin + "/api/auth/sign-up/email", { method: "POST", headers: { ...json, "X-Real-IP": nextIp() },
      body: JSON.stringify({ name: "Иван", email, password: "correct-password", termsAccepted: true, termsVersion: TERMS_VERSION }) }));
    assert.equal(response.status, 200);
    return cookieOf(response);
  }
  const session = async cookie => /** @type {any} */ (await (await fetch(base + "/api/auth/session", { headers: { Cookie: cookie } })).json());
  async function handoff(cookie, challenge, headers = {}) {
    const { csrfToken } = await session(cookie);
    return fetch(base + "/api/mobile-auth/handoff", { method: "POST", headers: { ...json, Cookie: cookie, "X-CSRF-Token": csrfToken, ...headers }, body: JSON.stringify({ challenge }) });
  }
  const exchange = (input, headers = {}) => fetch(base + "/api/mobile-auth/exchange", { method: "POST",
    headers: { ...json, "X-Real-IP": "192.0.2.1", "User-Agent": "Otgolosok/1.0 (Android)", ...headers }, body: typeof input === "string" ? input : JSON.stringify(input) });
  return { runtime, accountStore, base, telegramCallback, telegramLogin, passwordLogin, session, handoff, exchange };
}

async function invalid(response) {
  assert.equal(response.status, 400);
  assert.deepEqual(/** @type {any} */ (await response.json()).error.code, "HANDOFF_INVALID");
}

test("GET /api/legal/publication exposes the terms version publicly and is cacheable for five minutes", async t => {
  const f = await fixture(t);
  const response = await fetch(f.base + "/api/legal/publication");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "public, max-age=300");
  assert.deepEqual(await response.json(), { ready: LEGAL_READY, termsVersion: TERMS_VERSION });
  const write = await fetch(f.base + "/api/legal/publication", { method: "POST", headers: json, body: "{}" });
  assert.equal(write.status, 405);
});

test("Telegram handoff gives the app its own session with the browser's Telegram marker and the __Host cookie", async t => {
  const f = await fixture(t);
  const { verifier, challenge } = pkce();
  const browser = await f.telegramLogin("telegram-mobile", challenge);
  const issued = await f.handoff(browser, challenge);
  assert.equal(issued.status, 200);
  const { code } = /** @type {any} */ (await issued.json());
  assert.match(code, /^[A-Za-z0-9_-]{43}$/);
  const stored = f.runtime.accountDatabase.prepare("SELECT * FROM mobile_auth_handoff").get();
  assert.notEqual(stored.code_hash, code);
  assert.equal(stored.auth_provider, "telegram");

  const response = await f.exchange({ code, verifier });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const raw = response.headers.getSetCookie().find(value => value.startsWith("__Host-otgolosok-session="));
  assert.ok(raw);
  for (const attribute of [/; Secure/i, /; HttpOnly/i, /; SameSite=Lax/i, /; Path=\//i, /; Max-Age=604800/i]) assert.match(raw, attribute);
  assert.doesNotMatch(raw, /; Domain=/i);
  const result = /** @type {any} */ (await response.json());
  assert.equal(result.user.authMethod, "telegram");
  assert.equal(result.user.requiresReauthentication, false);
  const app = cookieOf(response), browserSession = await f.session(browser), appSession = await f.session(app);
  assert.equal(appSession.user.id, browserSession.user.id);
  assert.equal(appSession.csrfToken, result.csrfToken);
  assert.notEqual(appSession.csrfToken, browserSession.csrfToken);
  const sessions = f.runtime.database.prepare("SELECT authProvider,userAgent,ipAddress FROM session ORDER BY createdAt").all();
  assert.equal(sessions.length, 2);
  assert.deepEqual({ ...sessions[1] }, { authProvider: "telegram", userAgent: "Otgolosok/1.0 (Android)", ipAddress: "192.0.2.1" });
  // The browser session ends on its own; the app session is independent of it.
  assert.equal((await fetch(f.base + "/api/auth/sign-out", { method: "POST", headers: { ...json, Cookie: browser, "X-Real-IP": nextIp() }, body: "{}" })).status, 200);
  assert.equal((await f.session(app)).user.id, browserSession.user.id);
  await invalid(await f.exchange({ code, verifier }));
});

test("Telegram sign-up without the current terms returns to the completion page with TERMS_REQUIRED", async t => {
  const f = await fixture(t, { production: false });
  const { challenge } = pkce();
  const { callback } = await f.telegramCallback("telegram-no-terms", challenge, false);
  const location = new URL(callback.headers.get("location"), origin);
  assert.equal(location.pathname, "/app-auth/telegram/complete");
  assert.deepEqual([location.searchParams.get("challenge"), location.searchParams.get("failed"), location.searchParams.get("error")], [challenge, "1", "TERMS_REQUIRED"]);
  assert.equal(cookieOf(callback).includes("otgolosok.session="), false);
});

test("a fresh Telegram app session can delete the account; it then becomes stale like any Telegram session", async t => {
  const f = await fixture(t, { production: false });
  const { verifier, challenge } = pkce();
  const issued = await f.handoff(await f.telegramLogin("telegram-delete", challenge), challenge);
  const response = await f.exchange({ code: /** @type {any} */ (await issued.json()).code, verifier });
  const app = cookieOf(response), { csrfToken } = /** @type {any} */ (await response.json());
  const created = f.runtime.database.prepare("SELECT id,createdAt FROM session WHERE token=?").get(decodeURIComponent(app.split("=")[1]).split(".")[0]);
  assert.equal(freshTelegramSession({ authProvider: "telegram", createdAt: created.createdAt }), true);
  const remove = () => fetch(f.base + "/api/me", { method: "DELETE", headers: { ...json, Cookie: app, "X-CSRF-Token": csrfToken }, body: "{}" });
  f.runtime.database.prepare("UPDATE session SET createdAt=? WHERE id=?").run(Date.now() - TELEGRAM_REAUTH_WINDOW_MS - 1000, created.id);
  const stale = await remove();
  assert.equal(stale.status, 403);
  assert.equal(/** @type {any} */ (await stale.json()).error.code, "REAUTH_REQUIRED");
  f.runtime.database.prepare("UPDATE session SET createdAt=? WHERE id=?").run(Date.now(), created.id);
  assert.equal((await remove()).status, 200);
  assert.equal(f.runtime.database.prepare("SELECT COUNT(*) AS count FROM user").get().count, 0);
  assert.equal(f.runtime.accountDatabase.prepare("SELECT COUNT(*) AS count FROM mobile_auth_handoff").get().count, 0);
});

test("exchange revokes the session the app presented, so a re-authentication leaves no live orphan", async t => {
  const f = await fixture(t, { production: false });
  const first = pkce();
  const browser = await f.telegramLogin("telegram-reauth", first.challenge);
  const firstCode = /** @type {any} */ (await (await f.handoff(browser, first.challenge)).json()).code;
  const oldApp = cookieOf(await f.exchange({ code: firstCode, verifier: first.verifier }));
  const userId = (await f.session(oldApp)).user.id;
  const second = pkce();
  const secondCode = /** @type {any} */ (await (await f.handoff(browser, second.challenge)).json()).code;
  const response = await f.exchange({ code: secondCode, verifier: second.verifier }, { Cookie: oldApp });
  assert.equal(response.status, 200);
  assert.equal((await f.session(cookieOf(response))).user.id, userId);
  assert.equal((await f.session(oldApp)).user, null);
  assert.equal((await f.session(browser)).user.id, userId);
  assert.equal(f.runtime.database.prepare("SELECT COUNT(*) AS count FROM session").get().count, 2);
});

test("password and stale Telegram browser sessions hand off a password-marked session", async t => {
  const f = await fixture(t, { production: false });
  const password = pkce();
  const passwordResponse = await f.exchange({ code: /** @type {any} */ (await (await f.handoff(await f.passwordLogin("ivan@example.test"), password.challenge)).json()).code, verifier: password.verifier });
  assert.equal(passwordResponse.status, 200);
  assert.equal(/** @type {any} */ (await passwordResponse.json()).user.email, "ivan@example.test");
  const stale = pkce(), browser = await f.telegramLogin("telegram-stale", stale.challenge);
  f.runtime.database.prepare("UPDATE session SET createdAt=?").run(Date.now() - TELEGRAM_REAUTH_WINDOW_MS - 1000);
  const response = await f.exchange({ code: /** @type {any} */ (await (await f.handoff(browser, stale.challenge)).json()).code, verifier: stale.verifier });
  assert.equal(/** @type {any} */ (await response.json()).user.requiresReauthentication, true);
  const providers = f.runtime.database.prepare("SELECT authProvider FROM session ORDER BY createdAt DESC LIMIT 1").get();
  assert.equal(providers.authProvider, "password");
});

test("exchange answers every invalid code the same way and spends a code on its first presentation", async t => {
  const f = await fixture(t, { production: false });
  const { verifier, challenge } = pkce();
  const browser = await f.telegramLogin("telegram-invalid", challenge);
  const codeFor = async () => /** @type {any} */ (await (await f.handoff(browser, challenge)).json()).code;
  const wrongVerifier = await codeFor();
  await invalid(await f.exchange({ code: wrongVerifier, verifier: pkce().verifier }));
  await invalid(await f.exchange({ code: wrongVerifier, verifier }));
  const expired = await codeFor();
  f.runtime.accountDatabase.prepare("UPDATE mobile_auth_handoff SET created_at=created_at-? WHERE used_at IS NULL").run(HANDOFF_TTL_MS);
  await invalid(await f.exchange({ code: expired, verifier }));
  for (const input of [{ code: randomBytes(32).toString("base64url"), verifier }, { code: "short", verifier }, { code: await codeFor(), verifier: "short" },
    { code: 1, verifier }, {}, { code: await codeFor(), verifier, extra: true }, "not json", "[]"]) await invalid(await f.exchange(input));
  assert.equal((await f.exchange({ code: await codeFor(), verifier }, { "Content-Type": "text/plain" })).status, 400);
  assert.equal(f.runtime.database.prepare("SELECT COUNT(*) AS count FROM session").get().count, 1);
});

test("handoff requires a session, the site origin and CSRF; exchange requires the site origin", async t => {
  const f = await fixture(t, { production: false });
  const { challenge } = pkce();
  const browser = await f.telegramLogin("telegram-gates", challenge);
  const anonymous = await fetch(f.base + "/api/mobile-auth/handoff", { method: "POST", headers: json, body: JSON.stringify({ challenge }) });
  assert.equal(anonymous.status, 401);
  for (const headers of [{ Origin: "https://evil.test" }, { Origin: "" }, { "Sec-Fetch-Site": "cross-site" }]) {
    assert.equal((await f.handoff(browser, challenge, headers)).status, 403);
  }
  const noCsrf = await fetch(f.base + "/api/mobile-auth/handoff", { method: "POST", headers: { ...json, Cookie: browser }, body: JSON.stringify({ challenge }) });
  assert.equal(noCsrf.status, 403);
  assert.equal(/** @type {any} */ (await noCsrf.json()).error.code, "CSRF");
  for (const bad of ["short", `${challenge}A`, `${challenge.slice(0, 42)}+`]) assert.equal((await f.handoff(browser, bad)).status, 400);
  assert.equal((await fetch(f.base + "/api/mobile-auth/handoff", { headers: { Cookie: browser } })).status, 405);
  assert.equal(f.runtime.accountDatabase.prepare("SELECT COUNT(*) AS count FROM mobile_auth_handoff").get().count, 0);
  const { code } = /** @type {any} */ (await (await f.handoff(browser, challenge)).json());
  for (const headers of [{ Origin: "https://evil.test" }, { Origin: "" }, { "Sec-Fetch-Site": "cross-site" }, { "Sec-Fetch-Site": "same-site" }]) {
    assert.equal((await f.exchange({ code, verifier: "x".repeat(43) }, headers)).status, 403);
  }
  // The rejected requests did not spend the code.
  assert.equal(f.runtime.accountDatabase.prepare("SELECT used_at FROM mobile_auth_handoff").get().used_at, null);
  // The server-only session endpoint is not reachable over HTTP.
  assert.equal((await fetch(f.base + "/api/auth/mobile-auth/session", { method: "POST", headers: { ...json, "X-Real-IP": nextIp() }, body: JSON.stringify({ userId: "x", authProvider: "telegram" }) })).status, 404);
});

test("exchange is rate limited per client address", async t => {
  const f = await fixture(t, { production: false, mobileAuthLimiter: createReviewRateLimiter({ limit: 2, windowMs: 60_000 }) });
  const input = { code: randomBytes(32).toString("base64url"), verifier: pkce().verifier };
  await invalid(await f.exchange(input));
  await invalid(await f.exchange(input));
  const limited = await f.exchange(input);
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get("retry-after")) >= 1);
  await invalid(await f.exchange(input, { "X-Real-IP": "192.0.2.2" }));
});

test("handoff codes survive a restart and expired rows are removed on each write", async t => {
  const directory = await mkdtemp(join(tmpdir(), "mobile-auth-restart-"));
  const settings = { databasePath: join(directory, "auth.sqlite"), baseURL: origin, secret, production: false, legalReady: true };
  t.after(() => rm(directory, { recursive: true, force: true }));
  const { verifier, challenge } = pkce(), time = new Date().toISOString();
  let clock = 1_000_000, code;
  const first = await createAuth(settings);
  try {
    first.accountDatabase.prepare("INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt) VALUES(?,?,?,?,?,?)").run("restart-user", "Тест", "restart@example.test", 1, time, time);
    const handoffs = createMobileAuthStore(first.accountDatabase, { now: () => clock });
    handoffs.issue({ userId: "restart-user", challenge, authProvider: "password" });
    clock += HANDOFF_TTL_MS - 1;
    code = handoffs.issue({ userId: "restart-user", challenge, authProvider: "telegram" });
    clock += 1;
    handoffs.issue({ userId: "restart-user", challenge, authProvider: "password" });
    assert.equal(first.accountDatabase.prepare("SELECT COUNT(*) AS count FROM mobile_auth_handoff").get().count, 2);
  } finally { first.close(); }
  const second = await createAuth(settings);
  try {
    const handoffs = createMobileAuthStore(second.accountDatabase, { now: () => clock });
    assert.deepEqual(handoffs.redeem({ code, verifier }), { userId: "restart-user", authProvider: "telegram" });
    assert.equal(handoffs.redeem({ code, verifier }), null);
    clock += HANDOFF_TTL_MS;
    handoffs.redeem({ code, verifier });
    assert.equal(second.accountDatabase.prepare("SELECT COUNT(*) AS count FROM mobile_auth_handoff").get().count, 0);
  } finally { second.close(); }
});
