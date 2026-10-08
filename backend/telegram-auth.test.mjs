import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { betterAuth } from "better-auth";
import { exportJWK, SignJWT } from "jose";
import { supportsIdTokenSignIn } from "better-auth/oauth2";
import {
  TELEGRAM_PROVIDER_ID,
  createTelegramAuthPlugin,
  isTelegramEmail,
  loadTelegramAuthConfig,
  telegramEmail,
} from "./telegram-auth.mjs";

const NOW_SECONDS = 1_800_000_000;
const CLIENT_ID = "123456789";
const CLIENT_SECRET = "telegram-test-client-secret";

async function signingKeys(kid = "telegram-key") {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const publicJwk = await exportJWK(publicKey);
  return { privateKey, publicJwk: { ...publicJwk, alg: "RS256", use: "sig", kid } };
}

function providerFrom(plugin) {
  const initialized = plugin.init({ socialProviders: [] });
  return initialized.context.socialProviders[0];
}

function telegramPlugin(fetchImpl, now = () => NOW_SECONDS * 1000) {
  return createTelegramAuthPlugin({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET }, { fetchImpl, now });
}

/** @param {import("jose").JWK} publicJwk @param {(input: URL|Request|string, init?: RequestInit) => Promise<Response>|Response} [other] */
function jwksFetch(publicJwk, other = () => { throw new Error("Unexpected network call"); }) {
  return async (input, init) => {
    if (String(input) === "https://oauth.telegram.org/.well-known/jwks.json") {
      assert.ok(init.signal instanceof AbortSignal);
      assert.equal(init.redirect, "error");
      return Response.json({ keys: [publicJwk] });
    }
    return other(input, init);
  };
}

async function token(privateKey, claims = {}, kid = "telegram-key") {
  const defaults = {
    iss: "https://oauth.telegram.org",
    aud: CLIENT_ID,
    sub: "telegram-user-42",
    nonce: "expected-nonce",
    name: "Мария",
    iat: NOW_SECONDS - 30,
    exp: NOW_SECONDS + 300,
  };
  return new SignJWT({ ...defaults, ...claims })
    .setProtectedHeader({ alg: "RS256", kid, typ: "JWT" })
    .sign(privateKey);
}

test("Telegram config is optional only when both variables are absent and never exposes their values in errors", () => {
  assert.equal(loadTelegramAuthConfig({}), null);
  assert.equal(loadTelegramAuthConfig({ TELEGRAM_LOGIN_CLIENT_ID: "", TELEGRAM_LOGIN_CLIENT_SECRET: "" }), null);
  assert.deepEqual(loadTelegramAuthConfig({
    TELEGRAM_LOGIN_CLIENT_ID: CLIENT_ID,
    TELEGRAM_LOGIN_CLIENT_SECRET: CLIENT_SECRET,
  }), { clientId: CLIENT_ID, clientSecret: CLIENT_SECRET });

  for (const env of [
    { TELEGRAM_LOGIN_CLIENT_ID: CLIENT_ID },
    { TELEGRAM_LOGIN_CLIENT_SECRET: CLIENT_SECRET },
    { TELEGRAM_LOGIN_CLIENT_ID: "not-numeric", TELEGRAM_LOGIN_CLIENT_SECRET: CLIENT_SECRET },
  ]) {
    assert.throws(() => loadTelegramAuthConfig(env), error => {
      assert.ok(error instanceof Error);
      assert.equal(/** @type {Error & {code?: string}} */ (error).code, "TELEGRAM_AUTH_CONFIG_INVALID");
      assert.doesNotMatch(error.message, /123456789|telegram-test-client-secret|not-numeric/);
      return true;
    });
  }
});

test("Telegram synthetic emails are stable, provider-specific and recognizable", () => {
  const email = telegramEmail("telegram-user-42");
  assert.equal(email, "0ebe2143b2955b04530d94303c5f550096a9d2fff0b887597a44a19a4b11d6bb@users.telegram.invalid");
  assert.equal(telegramEmail("telegram-user-42"), email);
  assert.notEqual(telegramEmail("telegram-user-43"), email);
  assert.equal(isTelegramEmail(email), true);
  assert.equal(isTelegramEmail(email.toUpperCase()), true);
  assert.equal(isTelegramEmail("user@example.com"), false);
  assert.throws(() => telegramEmail(""), /non-empty/);
});

test("providers status endpoint exists and reports both disabled and configured states", async () => {
  const plugin = createTelegramAuthPlugin(null);
  assert.equal(plugin.id, "telegram-auth");
  assert.ok(plugin.endpoints.telegramProviders);
  assert.equal(plugin.init({ socialProviders: [] }), undefined);

  /** @type {Array<[null|{clientId: string, clientSecret: string}, boolean]>} */
  const statuses = [
    [null, false],
    [{ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET }, true],
  ];
  for (const [config, expected] of statuses) {
    const auth = betterAuth({
      baseURL: "https://otgolosok.test",
      secret: "K7cN5rvY2fAh4sPT9xWq6mLB8jGz3eDU",
      plugins: [createTelegramAuthPlugin(config, { fetchImpl: async () => { throw new Error("No startup network expected"); } })],
    });
    const response = await auth.handler(new Request("https://otgolosok.test/api/auth/providers"));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { telegram: expected });
  }
});

test("Telegram authorization URL pins issuer endpoint, nonce, PKCE and the minimal scopes", async () => {
  const provider = providerFrom(telegramPlugin(async () => { throw new Error("No startup fetch expected"); }));
  assert.equal(provider.id, TELEGRAM_PROVIDER_ID);
  assert.equal(provider.issuer, "https://oauth.telegram.org");
  assert.equal(provider.requiresIdTokenNonce, true);
  assert.deepEqual(provider.idToken.algorithms, ["RS256"]);
  assert.deepEqual(provider.options.scope, ["openid", "profile"]);
  assert.equal(provider.options.disableIdTokenSignIn, true);
  assert.equal(supportsIdTokenSignIn(provider), false);

  const url = await provider.createAuthorizationURL({
    state: "oauth-state",
    codeVerifier: "pkce-verifier-that-is-long-enough",
    idTokenNonce: "oidc-nonce",
    redirectURI: "https://otgolosok.test/api/auth/callback/telegram",
    scopes: ["phone"],
    additionalParams: { scope: "phone", state: "attacker-state" },
  });
  assert.equal(url.origin + url.pathname, "https://oauth.telegram.org/auth");
  assert.equal(url.searchParams.get("client_id"), CLIENT_ID);
  assert.equal(url.searchParams.get("state"), "oauth-state");
  assert.equal(url.searchParams.get("nonce"), "oidc-nonce");
  assert.equal(url.searchParams.get("scope"), "openid profile");
  assert.equal(url.searchParams.get("redirect_uri"), "https://otgolosok.test/api/auth/callback/telegram");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.match(url.searchParams.get("code_challenge"), /^[A-Za-z0-9_-]{43}$/);
  assert.equal(url.searchParams.has("phone"), false);
});

test("authorization code exchange uses the pinned Telegram endpoint, Basic auth and PKCE payload", async () => {
  /** @type {{input: string, init: any}|undefined} */
  let captured;
  const provider = providerFrom(telegramPlugin(async (input, init) => {
    captured = { input: String(input), init };
    return Response.json({
      access_token: "access-token",
      refresh_token: "refresh-token",
      id_token: "id-token",
      token_type: "Bearer",
      expires_in: 120,
      scope: "openid profile",
    });
  }));
  const result = await provider.validateAuthorizationCode({
    code: "authorization-code",
    redirectURI: "https://otgolosok.test/api/auth/callback/telegram",
    codeVerifier: "pkce-verifier",
  });
  if (!captured) assert.fail("Token request was not sent");
  const request = /** @type {{input: string, init: any}} */ (captured);
  assert.equal(request.input, "https://oauth.telegram.org/token");
  assert.equal(request.init.method, "POST");
  assert.equal(request.init.headers.Authorization, `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64")}`);
  assert.ok(request.init.signal instanceof AbortSignal);
  assert.equal(request.init.redirect, "error");
  const body = request.init.body;
  assert.equal(body.get("grant_type"), "authorization_code");
  assert.equal(body.get("client_id"), CLIENT_ID);
  assert.equal(body.get("code"), "authorization-code");
  assert.equal(body.get("redirect_uri"), "https://otgolosok.test/api/auth/callback/telegram");
  assert.equal(body.get("code_verifier"), "pkce-verifier");
  assert.deepEqual([...body.keys()].sort(), ["client_id", "code", "code_verifier", "grant_type", "redirect_uri"]);
  assert.deepEqual(result, {
    accessToken: "access-token",
    refreshToken: "refresh-token",
    idToken: "id-token",
    tokenType: "Bearer",
    scopes: ["openid", "profile"],
    accessTokenExpiresAt: new Date((NOW_SECONDS + 120) * 1000),
  });
});

test("token exchange retries transient responses and network failures but not deterministic 4xx", async () => {
  let transientCalls = 0;
  const transientProvider = providerFrom(telegramPlugin(async () => {
    transientCalls += 1;
    if (transientCalls === 1) return new Response("busy", { status: 503 });
    if (transientCalls === 2) return new Response("slow down", { status: 429 });
    return Response.json({ access_token: "access", id_token: "id" });
  }));
  const recovered = await transientProvider.validateAuthorizationCode({ code: "code", redirectURI: "https://example.test/callback", codeVerifier: "verifier" });
  assert.equal(transientCalls, 3);
  assert.equal(recovered.idToken, "id");

  let networkCalls = 0;
  const networkProvider = providerFrom(telegramPlugin(async () => {
    networkCalls += 1;
    if (networkCalls === 1) throw new TypeError("temporary network failure");
    return Response.json({ access_token: "network-access", id_token: "network-id" });
  }));
  const networkRecovered = await networkProvider.validateAuthorizationCode({ code: "code", redirectURI: "https://example.test/callback", codeVerifier: "verifier" });
  assert.equal(networkCalls, 2);
  assert.equal(networkRecovered.accessToken, "network-access");

  let boundedCalls = 0;
  const boundedProvider = providerFrom(telegramPlugin(async () => {
    boundedCalls += 1;
    return new Response("service secret", { status: 503 });
  }));
  await assert.rejects(
    boundedProvider.validateAuthorizationCode({ code: "code", redirectURI: "https://example.test/callback", codeVerifier: "verifier" }),
    error => error instanceof Error && error.message === "Telegram token exchange failed" && !String(error).includes("service secret"),
  );
  assert.equal(boundedCalls, 3);

  let deterministicCalls = 0;
  const deterministicProvider = providerFrom(telegramPlugin(async () => {
    deterministicCalls += 1;
    return Response.json({ error: "invalid_grant", leaked: CLIENT_SECRET }, { status: 400 });
  }));
  await assert.rejects(
    deterministicProvider.validateAuthorizationCode({ code: "sensitive-code", redirectURI: "https://example.test/callback", codeVerifier: "verifier" }),
    error => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, "Telegram token exchange failed");
      assert.doesNotMatch(String(error), /telegram-test-client-secret|sensitive-code|invalid_grant|leaked/);
      return true;
    },
  );
  assert.equal(deterministicCalls, 1);
});

test("token exchange stops reading a streamed response above 64 KiB", async () => {
  let pulls = 0;
  let cancelled = false;
  const stream = new ReadableStream({
    pull(controller) {
      pulls += 1;
      if (pulls > 10) return controller.close();
      controller.enqueue(new Uint8Array(16 * 1024).fill(65));
    },
    cancel() { cancelled = true; },
  });
  const provider = providerFrom(telegramPlugin(async () => new Response(stream, { status: 200 })));
  await assert.rejects(
    provider.validateAuthorizationCode({ code: "code", redirectURI: "https://example.test/callback", codeVerifier: "verifier" }),
    error => error instanceof Error && error.message === "Telegram token exchange failed",
  );
  assert.equal(cancelled, true);
  assert.ok(pulls < 10, `oversized stream should be cancelled early, read ${pulls} chunks`);
});

test("verified Telegram ID token maps immutable subject and normalized local user fields", async () => {
  const { privateKey, publicJwk } = await signingKeys();
  const provider = providerFrom(telegramPlugin(jwksFetch(publicJwk)));
  const signed = await token(privateKey, { name: "  Мария\n\tИванова  " });
  const result = await provider.getUserInfo({ idToken: signed, expectedIdTokenNonce: "expected-nonce" });
  assert.ok(result);
  assert.equal(result.user.name, "Мария Иванова");
  assert.equal(result.user.email, telegramEmail("telegram-user-42"));
  assert.equal(result.user.emailVerified, false);
  assert.equal(result.data.sub, "telegram-user-42");
  assert.equal(provider.accountSubject({ tokens: {}, profile: result.data }), "telegram-user-42");
});

test("unsafe or oversized Telegram names use a safe Russian fallback", async t => {
  const { privateKey, publicJwk } = await signingKeys();
  const provider = providerFrom(telegramPlugin(jwksFetch(publicJwk)));
  const cases = [
    ["control character", "Мария\u0000Иванова"],
    ["format character", "Мария\u200bИванова"],
    ["angle brackets", "<Мария>"],
    ["over 80 UTF-16 code units", "Я".repeat(81)],
    ["empty after normalization", " \n\t "],
  ];
  for (const [name, unsafeName] of cases) {
    await t.test(name, async () => {
      const signed = await token(privateKey, { name: unsafeName });
      const result = await provider.getUserInfo({ idToken: signed, expectedIdTokenNonce: "expected-nonce" });
      assert.ok(result);
      assert.equal(result.user.name, "Пользователь Telegram");
    });
  }
});

test("Telegram identity verification fails closed for missing token or expected nonce", async () => {
  const { publicJwk } = await signingKeys();
  const provider = providerFrom(telegramPlugin(jwksFetch(publicJwk)));
  assert.equal(await provider.getUserInfo({ expectedIdTokenNonce: "expected-nonce" }), null);
  assert.equal(await provider.getUserInfo({ idToken: "not-a-jwt", expectedIdTokenNonce: "expected-nonce" }), null);
});

test("Telegram rejects malformed claims, wrong trust context, expiry, future issue time and invalid signatures", async t => {
  const { privateKey, publicJwk } = await signingKeys();
  const other = await signingKeys("other-key");
  /** @type {Array<[string, Record<string, unknown>]>} */
  const cases = [
    ["missing subject", { sub: undefined }],
    ["numeric subject", { sub: 42 }],
    ["wrong issuer", { iss: "https://attacker.example" }],
    ["wrong audience", { aud: "987654321" }],
    ["expired", { exp: NOW_SECONDS - 10 }],
    ["missing expiration", { exp: undefined }],
    ["missing issued-at", { iat: undefined }],
    ["issued in the future", { iat: NOW_SECONDS + 60, exp: NOW_SECONDS + 600 }],
    ["missing nonce", { nonce: undefined }],
    ["wrong nonce", { nonce: "wrong-nonce" }],
  ];
  for (const [name, claims] of cases) {
    await t.test(name, async () => {
      const provider = providerFrom(telegramPlugin(jwksFetch(publicJwk)));
      const signed = await token(privateKey, claims);
      assert.equal(await provider.getUserInfo({ idToken: signed, expectedIdTokenNonce: "expected-nonce" }), null);
    });
  }
  await t.test("invalid signature", async () => {
    const provider = providerFrom(telegramPlugin(jwksFetch(publicJwk)));
    const signed = await token(other.privateKey, {}, "telegram-key");
    assert.equal(await provider.getUserInfo({ idToken: signed, expectedIdTokenNonce: "expected-nonce" }), null);
  });
});
