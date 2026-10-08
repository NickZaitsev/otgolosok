import { createHash } from "node:crypto";
import { createAuthEndpoint } from "better-auth/api";
import { createAuthorizationURL } from "better-auth/oauth2";
import { createRemoteJWKSet, customFetch, jwtVerify } from "jose";

export const TELEGRAM_PROVIDER_ID = "telegram";

const TELEGRAM_ISSUER = "https://oauth.telegram.org";
const TELEGRAM_AUTHORIZATION_ENDPOINT = `${TELEGRAM_ISSUER}/auth`;
const TELEGRAM_TOKEN_ENDPOINT = `${TELEGRAM_ISSUER}/token`;
const TELEGRAM_JWKS_ENDPOINT = `${TELEGRAM_ISSUER}/.well-known/jwks.json`;
const TELEGRAM_SCOPES = ["openid", "profile"];
const FETCH_TIMEOUT_MS = 5_000;
const FETCH_ATTEMPTS = 3;
const TOKEN_RESPONSE_LIMIT = 64 * 1024;

function configError() {
  /** @type {Error & {code?: string}} */
  const error = new Error("Invalid Telegram authentication configuration");
  error.code = "TELEGRAM_AUTH_CONFIG_INVALID";
  return error;
}

export function telegramEmail(subject) {
  if (typeof subject !== "string" || !subject) throw new TypeError("Telegram subject must be a non-empty string");
  return `${createHash("sha256").update(subject, "utf8").digest("hex")}@users.telegram.invalid`;
}

export function isTelegramEmail(email) {
  return typeof email === "string" && /^[a-f0-9]{64}@users\.telegram\.invalid$/i.test(email);
}

export function loadTelegramAuthConfig(env = process.env) {
  const clientId = env.TELEGRAM_LOGIN_CLIENT_ID;
  const clientSecret = env.TELEGRAM_LOGIN_CLIENT_SECRET;
  const hasClientId = typeof clientId === "string" && clientId.length > 0;
  const hasClientSecret = typeof clientSecret === "string" && clientSecret.length > 0;
  if (!hasClientId && !hasClientSecret) return null;
  if (!hasClientId || !hasClientSecret || !/^\d+$/.test(clientId)) throw configError();
  return { clientId, clientSecret };
}

function retryableStatus(status) {
  return status === 429 || status >= 500 && status <= 599;
}

function wait(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function boundedFetch(fetchImpl, input, init, failureMessage) {
  for (let attempt = 0; attempt < FETCH_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetchImpl(input, { ...init, redirect: "error", signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (!retryableStatus(response.status) || attempt === FETCH_ATTEMPTS - 1) return response;
      await response.body?.cancel().catch(() => {});
    } catch {
      if (attempt === FETCH_ATTEMPTS - 1) throw new Error(failureMessage);
    }
    await wait(20 * 2 ** attempt);
  }
  throw new Error(failureMessage);
}

async function parseTokenResponse(response) {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > TOKEN_RESPONSE_LIMIT) {
    await response.body?.cancel().catch(() => {});
    throw new Error("Telegram token exchange failed");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Telegram token exchange failed");
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > TOKEN_RESPONSE_LIMIT) {
        await reader.cancel().catch(() => {});
        throw new Error("Telegram token exchange failed");
      }
      chunks.push(value);
    }
  } catch {
    await reader.cancel().catch(() => {});
    throw new Error("Telegram token exchange failed");
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let value;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new Error("Telegram token exchange failed");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Telegram token exchange failed");
  return value;
}

function optionalString(value) {
  return typeof value === "string" && value ? value : undefined;
}

function boundedName(value) {
  if (typeof value !== "string") return "Пользователь Telegram";
  const name = value.trim().replace(/\s+/g, " ");
  if (!name || name.length > 80 || /[\p{Cc}\p{Cf}<>]/u.test(name)) return "Пользователь Telegram";
  return name;
}

function nowDate(now) {
  const value = now();
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("Telegram identity verification failed");
  return date;
}

/**
 * @param {{clientId: string, clientSecret: string}|null} config
 * @param {{fetchImpl?: typeof fetch, now?: () => number|Date}} dependencies
 */
export function createTelegramAuthPlugin(config, { fetchImpl = globalThis.fetch, now = Date.now } = {}) {
  if (config !== null && (!config || typeof config.clientId !== "string" || !/^\d+$/.test(config.clientId) || typeof config.clientSecret !== "string" || !config.clientSecret)) {
    throw configError();
  }
  if (typeof fetchImpl !== "function" || typeof now !== "function") throw new TypeError("Invalid Telegram authentication dependencies");

  /** @type {import("better-auth/oauth2").OAuthProvider<import("jose").JWTPayload>|undefined} */
  let provider;
  if (config) {
    const remoteJwks = createRemoteJWKSet(new URL(TELEGRAM_JWKS_ENDPOINT), {
      timeoutDuration: FETCH_TIMEOUT_MS,
      cooldownDuration: 30_000,
      cacheMaxAge: 10 * 60_000,
      [customFetch]: (input, init) => boundedFetch(fetchImpl, input, init, "Telegram identity verification failed"),
    });

    provider = {
      id: TELEGRAM_PROVIDER_ID,
      name: "Telegram",
      issuer: TELEGRAM_ISSUER,
      requiresIdTokenNonce: true,
      idToken: {
        jwks: remoteJwks,
        issuer: TELEGRAM_ISSUER,
        audience: config.clientId,
        algorithms: ["RS256"],
        maxTokenAge: "10m",
      },
      options: {
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        scope: TELEGRAM_SCOPES,
        disableIdTokenSignIn: true,
      },
      accountSubject: ({ profile }) => profile.sub,
      createAuthorizationURL: data => createAuthorizationURL({
        id: TELEGRAM_PROVIDER_ID,
        options: { clientId: config.clientId, clientSecret: config.clientSecret },
        authorizationEndpoint: TELEGRAM_AUTHORIZATION_ENDPOINT,
        state: data.state,
        codeVerifier: data.codeVerifier,
        scopes: TELEGRAM_SCOPES,
        redirectURI: data.redirectURI,
        nonce: data.idTokenNonce,
      }),
      async validateAuthorizationCode({ code, redirectURI, codeVerifier }) {
        const body = new URLSearchParams({
          grant_type: "authorization_code",
          client_id: config.clientId,
          code,
          redirect_uri: redirectURI,
        });
        if (codeVerifier) body.set("code_verifier", codeVerifier);
        const basic = Buffer.from(`${config.clientId}:${config.clientSecret}`, "utf8").toString("base64");
        const response = await boundedFetch(fetchImpl, TELEGRAM_TOKEN_ENDPOINT, {
          method: "POST",
          headers: {
            Accept: "application/json",
            Authorization: `Basic ${basic}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body,
        }, "Telegram token exchange failed");
        if (!response.ok) {
          await response.body?.cancel().catch(() => {});
          throw new Error("Telegram token exchange failed");
        }
        const result = await parseTokenResponse(response);
        const expiresIn = Number(result.expires_in);
        return {
          accessToken: optionalString(result.access_token),
          refreshToken: optionalString(result.refresh_token),
          idToken: optionalString(result.id_token),
          tokenType: optionalString(result.token_type),
          scopes: typeof result.scope === "string" ? result.scope.split(/\s+/).filter(Boolean) : undefined,
          accessTokenExpiresAt: Number.isFinite(expiresIn) && expiresIn > 0 ? new Date(nowDate(now).getTime() + expiresIn * 1000) : undefined,
        };
      },
      async getUserInfo(tokens) {
        if (!tokens.idToken || !tokens.expectedIdTokenNonce) return null;
        try {
          const { payload } = await jwtVerify(tokens.idToken, remoteJwks, {
            issuer: TELEGRAM_ISSUER,
            audience: config.clientId,
            algorithms: ["RS256"],
            requiredClaims: ["sub", "iat", "exp", "nonce"],
            maxTokenAge: "10m",
            clockTolerance: 5,
            currentDate: nowDate(now),
          });
          if (typeof payload.sub !== "string" || !payload.sub || payload.sub.length > 255) return null;
          if (!Number.isInteger(payload.iat) || !Number.isInteger(payload.exp)) return null;
          if (typeof payload.nonce !== "string" || payload.nonce !== tokens.expectedIdTokenNonce) return null;
          return {
            user: {
              name: boundedName(payload.name),
              email: telegramEmail(payload.sub),
              emailVerified: false,
            },
            data: payload,
          };
        } catch {
          return null;
        }
      },
    };
  }

  return {
    id: "telegram-auth",
    init(ctx) {
      if (!provider) return;
      return { context: { socialProviders: [provider, ...ctx.socialProviders] } };
    },
    endpoints: {
      telegramProviders: createAuthEndpoint("/providers", { method: "GET" }, async ctx => ctx.json({
        telegram: ctx.context.socialProviders.some(item => item.id === TELEGRAM_PROVIDER_ID),
      })),
    },
  };
}
