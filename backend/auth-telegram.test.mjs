import test from "node:test";
import assert from "node:assert/strict";
import { createAuth } from "./auth.mjs";
import { telegramEmail } from "./telegram-auth.mjs";

const origin = "https://otgolosok.test";
const secret = "telegram-integration-test-secret-at-least-32";
const headers = { Origin: origin, "Content-Type": "application/json", "X-Real-IP": "127.0.0.1" };
function request(path, body, overrides = {}) {
  return new Request(origin + "/api/auth" + path, { method: "POST", headers: { ...headers, ...overrides }, body: JSON.stringify(body) });
}

test("OAuth initiation rejects foreign and missing origins even without a session cookie", async t => {
  const runtime = await createAuth({ databasePath: ":memory:", baseURL: origin, secret, production: false });
  t.after(() => runtime.close());
  for (const maliciousHeaders of [{ Origin: "https://evil.test" }, { Origin: "" }, { "Sec-Fetch-Site": "cross-site" }]) {
    const response = await runtime.auth.handler(request("/sign-in/social", { provider: "telegram", callbackURL: "/account" }, maliciousHeaders));
    assert.equal(response.status, 403);
  }
});

test("email signup cannot claim the reserved Telegram email namespace", async t => {
  const runtime = await createAuth({ databasePath: ":memory:", baseURL: origin, secret, production: false });
  t.after(() => runtime.close());
  for (const email of [telegramEmail("123"), "another@users.telegram.invalid", "UPPER@USERS.TELEGRAM.INVALID"]) {
    const response = await runtime.auth.handler(request("/sign-up/email", { email, name: "Подмена", password: "correct-password" }));
    assert.equal(response.status, 403);
  }
  assert.equal(runtime.database.prepare("SELECT COUNT(*) AS count FROM user").get().count, 0);
});

import { generateKeyPairSync } from "node:crypto";
import { exportJWK, SignJWT } from "jose";
import { publicAccountUser, freshTelegramSession, TELEGRAM_REAUTH_WINDOW_MS } from "./auth.mjs";
import { createAccountStore } from "./account-store.mjs";
import { createStore } from "./store.mjs";
import { createApp } from "./server.mjs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function oauthFixture(t) {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = { ...await exportJWK(publicKey), kid: "integration-key", alg: "RS256", use: "sig" };
  const codes = new Map();
  const clientId = "123456789";
  const fetchImpl = async (input, init) => {
    if (String(input).endsWith("/.well-known/jwks.json")) return Response.json({ keys: [jwk] });
    assert.equal(String(input), "https://oauth.telegram.org/token");
    assert.equal(init.redirect, "error");
    const claims = codes.get(init.body.get("code"));
    if (!claims) return Response.json({ error: "invalid_grant" }, { status: 400 });
    const now = Math.floor(Date.now() / 1000);
    const idToken = await new SignJWT({ iss: "https://oauth.telegram.org", aud: clientId, iat: now, exp: now + 300, name: "Мария", ...claims })
      .setProtectedHeader({ alg: "RS256", kid: jwk.kid }).sign(privateKey);
    return Response.json({ id_token: idToken, access_token: "private-access-token", token_type: "Bearer", expires_in: 300 });
  };
  const runtime = await createAuth({ databasePath: ":memory:", baseURL: origin, secret, production: false, telegram: { clientId, clientSecret: "private-test-secret" }, telegramDependencies: { fetchImpl } });
  t.after(() => runtime.close());
  const accountStore = createAccountStore(runtime.accountDatabase);
  let ip = 1;
  async function start() {
    const response = await runtime.auth.handler(request("/sign-in/social", { provider: "telegram", callbackURL: "/account", errorCallbackURL: "/login?telegram_error=1", disableRedirect: true }, { "X-Real-IP": `127.0.0.${ip++}` }));
    assert.equal(response.status, 200);
    const url = new URL(/** @type {any} */ (await response.json()).url);
    assert.equal(url.searchParams.get("code_challenge_method"), "S256");
    assert.equal(url.searchParams.get("scope"), "openid profile");
    assert.ok(url.searchParams.get("nonce"));
    return { url, cookie: response.headers.getSetCookie().map(cookie => cookie.split(";", 1)[0]).join("; ") };
  }
  async function callback(flow, sub, changes = {}) {
    const code = crypto.randomUUID();
    codes.set(code, { sub, nonce: flow.url.searchParams.get("nonce"), ...changes });
    return runtime.auth.handler(new Request(`${origin}/api/auth/callback/telegram?code=${code}&state=${flow.url.searchParams.get("state")}`, { headers: { Cookie: flow.cookie, "X-Real-IP": `127.0.0.${ip++}` } }));
  }
  async function login(sub, changes = {}) {
    const response = await callback(await start(), sub, changes);
    const cookie = response.headers.getSetCookie().map(cookie => cookie.split(";", 1)[0]).join("; ");
    const session = await runtime.auth.api.getSession({ headers: new Headers({ Cookie: cookie }) });
    return { response, cookie, session };
  }
  return { runtime, accountStore, start, callback, login };
}

test("Telegram code flow creates one stable account, encrypts tokens and marks the session for reauthentication", async t => {
  const f = await oauthFixture(t);
  const providers = await f.runtime.auth.handler(new Request(origin + "/api/auth/providers"));
  assert.deepEqual(await providers.json(), { telegram: true });
  const first = await f.login("telegram-42");
  assert.equal(first.response.status, 302);
  assert.equal(new URL(first.response.headers.get("location"), origin).href, origin + "/account");
  assert.ok(first.session);
  assert.equal(first.session.user.email, telegramEmail("telegram-42"));
  assert.equal(first.session.user.emailVerified, false);
  assert.equal(first.session.session.authProvider, "telegram");
  assert.equal(f.accountStore.telegramSubject(first.session.user.id), "telegram-42");
  const account = f.runtime.database.prepare("SELECT * FROM account WHERE providerId='telegram'").get();
  assert.notEqual(account.accessToken, "private-access-token");
  assert.equal(freshTelegramSession(first.session.session), true);
  assert.deepEqual(publicAccountUser(first.session.user, first.session.session, f.accountStore), { id: first.session.user.id, email: null, name: "Мария", authMethod: "telegram", requiresReauthentication: false });
  const repeat = await f.login("telegram-42");
  assert.equal(repeat.session.user.id, first.session.user.id);
  const other = await f.login("telegram-43");
  assert.notEqual(other.session.user.id, first.session.user.id);
  assert.equal(f.runtime.database.prepare("SELECT COUNT(*) AS count FROM user").get().count, 2);
});

test("OAuth rejects wrong nonce and replayed state without creating users or sessions", async t => {
  const f = await oauthFixture(t);
  const flow = await f.start();
  const wrong = await f.callback(flow, "bad-user", { nonce: "unbound-nonce" });
  assert.equal(wrong.status, 302);
  assert.match(wrong.headers.get("location"), /telegram_error=1/);
  assert.equal(f.runtime.database.prepare("SELECT COUNT(*) AS count FROM user").get().count, 0);
  const replay = await f.callback(flow, "bad-user");
  assert.equal(replay.status, 302);
  assert.equal(f.runtime.database.prepare("SELECT COUNT(*) AS count FROM user").get().count, 0);
  const direct = await f.runtime.auth.handler(request("/sign-in/social", { provider: "telegram", idToken: { token: "client-token" } }));
  assert.equal(direct.status, 404);
});

test("Telegram reauthentication freshness requires the server marker and immutable creation time", () => {
  const now = Date.now();
  for (const [createdAt, authProvider, expected] of [
    [now, "telegram", true], [now - TELEGRAM_REAUTH_WINDOW_MS, "telegram", true],
    [now - TELEGRAM_REAUTH_WINDOW_MS - 1, "telegram", false], [now + 1, "telegram", false],
    [now, "password", false], [now, undefined, false], ["invalid", "telegram", false],
  ]) assert.equal(freshTelegramSession({ createdAt, authProvider }, now), expected);
});

test("Telegram account deletion requires CSRF and fresh Telegram authentication; cascade revokes its session", async t => {
  const f = await oauthFixture(t);
  const signedIn = await f.login("telegram-delete");
  const directory = await mkdtemp(join(tmpdir(), "telegram-api-"));
  const store = createStore(":memory:");
  const app = createApp({ store, origin, audioDirectory: directory, workerEnabled: false, auth: f.runtime.auth, accountStore: f.accountStore, authSecret: secret });
  await /** @type {Promise<void>} */ (new Promise(resolve => app.server.listen(0, "127.0.0.1", resolve)));
  const base = `http://127.0.0.1:${/** @type {import("node:net").AddressInfo} */ (app.server.address()).port}`;
  t.after(async () => { await app.close(); store.close(); await rm(directory, { recursive: true, force: true }); });
  const sessionResponse = await fetch(base + "/api/auth/session", { headers: { Cookie: signedIn.cookie } });
  const dto = /** @type {any} */ (await sessionResponse.json());
  assert.equal(dto.user.email, null);
  assert.equal(dto.user.authMethod, "telegram");
  const requestHeaders = { Cookie: signedIn.cookie, Origin: origin, "Content-Type": "application/json", "X-CSRF-Token": dto.csrfToken };
  const missingCsrf = { ...requestHeaders }; delete missingCsrf["X-CSRF-Token"];
  assert.equal((await fetch(base + "/api/me", { method: "DELETE", headers: missingCsrf, body: "{}" })).status, 403);
  f.runtime.database.prepare("UPDATE session SET createdAt=? WHERE id=?").run(Date.now() - TELEGRAM_REAUTH_WINDOW_MS - 1000, signedIn.session.session.id);
  const stale = await fetch(base + "/api/me", { method: "DELETE", headers: requestHeaders, body: "{}" });
  assert.equal(stale.status, 403);
  assert.equal(/** @type {any} */ (await stale.json()).error.code, "REAUTH_REQUIRED");
  f.runtime.database.prepare("UPDATE session SET createdAt=? WHERE id=?").run(Date.now(), signedIn.session.session.id);
  assert.equal((await fetch(base + "/api/me", { method: "DELETE", headers: requestHeaders, body: JSON.stringify({ password: "any" }) })).status, 400);
  assert.equal((await fetch(base + "/api/me", { method: "DELETE", headers: requestHeaders, body: "{}" })).status, 200);
  assert.equal(f.runtime.database.prepare("SELECT COUNT(*) AS count FROM user").get().count, 0);
  assert.equal(f.runtime.database.prepare("SELECT COUNT(*) AS count FROM session").get().count, 0);
  assert.equal(f.runtime.database.prepare("SELECT COUNT(*) AS count FROM account").get().count, 0);
});

test("Telegram never links by display name or a token email claim; password sessions cannot acquire the Telegram marker", async t => {
  const f = await oauthFixture(t);
  const response = await f.runtime.auth.handler(request("/sign-up/email", { email: "maria@example.test", name: "Мария", password: "correct-password", authProvider: "telegram" }));
  assert.equal(response.status, 200);
  const passwordSession = /** @type {any} */ (await response.json());
  const cookie = response.headers.getSetCookie().map(cookie => cookie.split(";", 1)[0]).join("; ");
  const session = await f.runtime.auth.api.getSession({ headers: new Headers({ Cookie: cookie }) });
  assert.equal(session.session.authProvider, "password");
  assert.equal(freshTelegramSession(session.session), false);
  const telegram = await f.login("telegram-maria", { email: "maria@example.test", preferred_username: "maria" });
  assert.notEqual(telegram.session.user.id, passwordSession.user.id);
  assert.equal(f.runtime.database.prepare("SELECT COUNT(*) AS count FROM user").get().count, 2);
});

test("simultaneous callbacks for the same Telegram identity cannot create duplicate owners", async t => {
  const f = await oauthFixture(t);
  const flows = await Promise.all([f.start(), f.start()]);
  const responses = await Promise.all(flows.map(flow => f.callback(flow, "concurrent-identity")));
  assert.ok(responses.some(response => response.status === 302 && response.headers.get("location") === "/account"));
  assert.equal(f.runtime.database.prepare("SELECT COUNT(*) AS count FROM account WHERE providerId='telegram'").get().count, 1);
  assert.equal(f.runtime.database.prepare("SELECT COUNT(*) AS count FROM user").get().count, 1);
  const repeated = await f.login("concurrent-identity");
  assert.ok(repeated.session);
});
