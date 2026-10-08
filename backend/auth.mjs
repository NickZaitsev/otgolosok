import { DatabaseSync } from "node:sqlite";
import { createHmac, timingSafeEqual } from "node:crypto";
import { betterAuth } from "better-auth";
import { createAuthMiddleware, APIError, addOAuthServerContext, getOAuthState } from "better-auth/api";
import { createTelegramAuthPlugin, telegramEmail } from "./telegram-auth.mjs";
import { getMigrations } from "better-auth/db/migration";
import { LEGAL_READY, TERMS_VERSION } from "../legal/publication.mjs";

function openAuthDatabase(path) {
  const database = new DatabaseSync(path, { timeout: 5000 });
  database.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON");
  return database;
}

/** @param {{databasePath: string, baseURL: string, secret?: string, production?: boolean, legalReady?: boolean, telegram?: Parameters<typeof createTelegramAuthPlugin>[0], telegramDependencies?: Parameters<typeof createTelegramAuthPlugin>[1]}} options */
export async function createAuth({ databasePath, baseURL, secret, production = process.env.NODE_ENV === "production", telegram = null, telegramDependencies = {}, legalReady = LEGAL_READY }) {
  if (!baseURL) throw new Error("APP_ORIGIN is required for authentication");
  if (production && (!secret || secret.length < 32)) throw new Error("BETTER_AUTH_SECRET must contain at least 32 characters");
  const database = openAuthDatabase(databasePath);
  // ID tokens are verified by the provider before persistence. They are not
  // needed after login, and Better Auth only encrypts access/refresh tokens.
  const discardTelegramIdToken = async (account, ctx) => ({ data:
    account.providerId === "telegram" || (ctx?.path === "/callback/:id" && ctx.params?.id === "telegram")
      ? { ...account, idToken: null } : account,
  });
  /** @satisfies {import("better-auth").BetterAuthOptions} */
  const options = {
    appName: "Отголосок", baseURL, basePath: "/api/auth", database,
    secret: secret || "development-only-better-auth-secret-32",
    trustedOrigins: [baseURL],
    plugins: [createTelegramAuthPlugin(telegram, telegramDependencies)],
    account: { accountLinking: { enabled: false }, encryptOAuthTokens: true },
    hooks: { before: createAuthMiddleware(async ctx => {
      // OAuth login CSRF must also be rejected before the first session exists.
      if (ctx.path === "/sign-in/social" && (ctx.headers?.get("origin") !== new URL(baseURL).origin || ctx.headers?.get("sec-fetch-site") === "cross-site")) {
        throw new APIError("FORBIDDEN", { message: "Вход возможен только с сайта Отголоска." });
      }
      const input = /** @type {Record<string, unknown>} */ (ctx.body);
      if (ctx.path === "/sign-in/social" && input?.provider === "telegram") {
        // Client additionalData is untrusted. Better Auth embeds serverContext in
        // its authenticated, single-use OAuth state and restores it on callback.
        if (legalReady && input.termsAccepted === true && input.termsVersion === TERMS_VERSION) {
          await addOAuthServerContext({ termsAcceptance: { version: TERMS_VERSION, acceptedAt: Date.now() } });
        }
      }
      if (ctx.path !== "/sign-up/email") return;
      if (!legalReady) throw new APIError("SERVICE_UNAVAILABLE", { code: "LEGAL_UNAVAILABLE", message: "Регистрация временно недоступна." });
      if (input?.termsAccepted !== true || input?.termsVersion !== TERMS_VERSION) {
        throw new APIError("BAD_REQUEST", { code: "TERMS_REQUIRED", message: "Для регистрации примите актуальные условия использования." });
      }
      // Evidence fields are assigned by the server, never by an API client.
      delete input.termsVersion;
      delete input.termsAcceptedAt;
    }) },
    databaseHooks: { user: { create: { before: async (user, ctx) => {
      if (ctx?.path === "/sign-up/email") return { data: { ...user, termsVersion: TERMS_VERSION, termsAcceptedAt: new Date() } };
      if (ctx?.path !== "/callback/:id" || ctx.params?.id !== "telegram") return { data: user };
      if (!legalReady) throw new APIError("SERVICE_UNAVAILABLE", { code: "LEGAL_UNAVAILABLE", message: "Регистрация временно недоступна." });
      const evidence = /** @type {{version?: unknown, acceptedAt?: unknown} | undefined} */ ((await getOAuthState())?.serverContext?.termsAcceptance);
      // The authenticated state already proves who assigned this timestamp.
      // Comparing it to a later wall clock would reject valid flows when the
      // system clock moves backwards between initiation and callback.
      if (evidence?.version !== TERMS_VERSION || typeof evidence.acceptedAt !== "number" || !Number.isSafeInteger(evidence.acceptedAt) || evidence.acceptedAt <= 0 || evidence.acceptedAt > 8.64e15) {
        throw new APIError("BAD_REQUEST", { code: "TERMS_REQUIRED", message: "Для регистрации примите актуальные условия использования." });
      }
      return { data: { ...user, termsVersion: TERMS_VERSION, termsAcceptedAt: new Date(evidence.acceptedAt) } };
    } } }, session: { create: { before: async (session, ctx) => ({ data: {
      ...session,
      authProvider: ctx?.path === "/callback/:id" && ctx.params?.id === "telegram" ? "telegram" : "password",
    } }) } }, account: {
      create: { before: discardTelegramIdToken },
      update: { before: discardTelegramIdToken },
    } },
    emailAndPassword: { enabled: true, minPasswordLength: 10, maxPasswordLength: 128 },
    user: {
      additionalFields: {
        role: { type: "string", required: false, defaultValue: "user", input: false },
        termsVersion: { type: "string", required: false, input: false, returned: false },
        termsAcceptedAt: { type: "date", required: false, input: false, returned: false },
      },
      validateUserInfo: ({ user, source }) => {
        const reserved = typeof user.email === "string" && user.email.toLowerCase().endsWith("@users.telegram.invalid");
        if (!reserved) return;
        if (source.method === "oauth" && source.oauth.providerId === "telegram" && typeof source.oauth.profile.sub === "string" && user.email === telegramEmail(source.oauth.profile.sub)) return;
        return { error: "reserved_email", errorDescription: "Этот адрес недоступен для регистрации." };
      },
    },
    // Better Auth refreshes expiresAt at most once a day. Seven days is the
    // inactivity window; authSession separately enforces the 30 day absolute
    // lifetime from the immutable createdAt value.
    session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24, additionalFields: { authProvider: { type: "string", required: false, input: false } } },
    rateLimit: { enabled: true, window: 60, max: 20, storage: "database" },
    advanced: {
      // The session cookie has an explicit __Host name below. Disabling the
      // automatic __Secure prefix prevents Better Auth from double-prefixing
      // it, while defaultCookieAttributes still makes every production cookie
      // Secure.
      useSecureCookies: false,
      defaultCookieAttributes: { httpOnly: true, secure: production, sameSite: "lax", path: "/" },
      cookiePrefix: "otgolosok",
      cookies: { session_token: { name: production ? "__Host-otgolosok-session" : "otgolosok.session" } },
      ipAddress: { ipAddressHeaders: ["x-real-ip"] },
    },
  };
  const { runMigrations } = await getMigrations(options);
  await runMigrations();
  // A Telegram identity cannot belong to two users, including simultaneous callbacks.
  database.exec("CREATE UNIQUE INDEX IF NOT EXISTS account_telegram_identity ON account(providerId,accountId) WHERE providerId='telegram'");
  database.exec("UPDATE account SET idToken=NULL WHERE providerId='telegram' AND idToken IS NOT NULL");
  const auth = betterAuth(options);
  // Better Auth keeps transactions open across awaits on its connection (sign-up
  // hashes the password inside one). Account data gets a separate connection so
  // its synchronous transactions never nest in, or roll back with, Better Auth's.
  // An in-memory database is private to its connection, so tests share it.
  const accountDatabase = databasePath === ":memory:" ? database : openAuthDatabase(databasePath);
  return { auth, database, accountDatabase, close: () => { if (accountDatabase !== database) accountDatabase.close(); database.close(); } };
}

export async function authSession(auth, req) {
  if (!auth) return null;
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) value.forEach(item => headers.append(name, item));
    else if (value !== undefined) headers.set(name, value);
  }
  const value = await auth.api.getSession({ headers });
  if (!value) return null;
  const created = new Date(value.session.createdAt).getTime();
  if (!Number.isFinite(created) || Date.now() - created > 30 * 24 * 60 * 60 * 1000) return null;
  return value;
}

export async function verifySessionPassword(auth, req, password) {
  if (typeof password !== "string" || !password) return false;
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) value.forEach(item => headers.append(name, item));
    else if (value !== undefined) headers.set(name, value);
  }
  const requestOrigin = req.headers.origin ?? `http://${req.headers.host ?? "localhost"}`;
  const response = await auth.handler(new Request(new URL("/api/auth/verify-password", requestOrigin), {
    method: "POST", headers, body: JSON.stringify({ password }),
  }));
  return response.ok;
}

export function sessionCsrfToken(secret, sessionId) {
  return createHmac("sha256", secret).update(`account-csrf:${sessionId}`).digest("base64url");
}

export function validSessionCsrf(secret, sessionId, candidate) {
  if (typeof candidate !== "string") return false;
  const expected = Buffer.from(sessionCsrfToken(secret, sessionId));
  const actual = Buffer.from(candidate);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// Sign-in, sign-up and password forms are a few hundred bytes; anything much
// larger is refused before Better Auth parses it.
export const AUTH_BODY_LIMIT = 16 * 1024;

async function limitedBody(req, limit) {
  if (Number(req.headers["content-length"]) > limit) return null;
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) return null;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export function authRequestHandler(auth) {
  return async (req, res) => {
    const origin = `http://${req.headers.host || "localhost"}`;
    const hasBody = !["GET", "HEAD"].includes(req.method);
    const payload = hasBody ? await limitedBody(req, AUTH_BODY_LIMIT) : undefined;
    if (payload === null) {
      // Close the connection: the rest of an oversized body is not read.
      res.writeHead(413, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", Connection: "close" });
      res.end(JSON.stringify({ code: "PAYLOAD_TOO_LARGE", message: "Слишком большой запрос." }));
      return;
    }
    const request = new Request(new URL(req.url, origin), { method: req.method, headers: req.headers, body: payload });
    const response = await auth.handler(request);
    const headers = Object.fromEntries(response.headers);
    const setCookies = response.headers.getSetCookie?.() ?? [];
    if (setCookies.length) headers["set-cookie"] = setCookies;
    headers["cache-control"] = "no-store";
    res.writeHead(response.status, headers);
    res.end(Buffer.from(await response.arrayBuffer()));
  };
}

export const TELEGRAM_REAUTH_WINDOW_MS = 5 * 60 * 1000;

export function freshTelegramSession(session, now = Date.now()) {
  const created = new Date(session.createdAt).getTime();
  return session.authProvider === "telegram" && Number.isFinite(created) && now >= created && now - created <= TELEGRAM_REAUTH_WINDOW_MS;
}

export function publicAccountUser(user, session, accountStore, withRole = false) {
  const reserved = typeof user.email === "string" && user.email.toLowerCase().endsWith("@users.telegram.invalid");
  const subject = reserved ? accountStore?.telegramSubject(user.id) : null;
  const telegram = Boolean(subject && telegramEmail(subject) === user.email);
  return { id: user.id, email: reserved ? null : user.email, name: user.name,
    ...(withRole ? { role: user.role } : {}),
    ...(telegram ? { authMethod: "telegram", requiresReauthentication: !freshTelegramSession(session) } : {}),
  };
}
