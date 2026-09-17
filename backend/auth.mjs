import { DatabaseSync } from "node:sqlite";
import { createHmac, timingSafeEqual } from "node:crypto";
import { betterAuth } from "better-auth";
import { getMigrations } from "better-auth/db/migration";
import { emailOTP } from "better-auth/plugins";

const noopDelivery = async () => {
  if (process.env.NODE_ENV !== "test") console.info("Authentication email delivery is not configured.");
};

export async function createAuth({ databasePath, baseURL, secret, sendOTP = noopDelivery, production = process.env.NODE_ENV === "production" }) {
  if (!baseURL) throw new Error("APP_ORIGIN is required for authentication");
  if (production && (!secret || secret.length < 32)) throw new Error("BETTER_AUTH_SECRET must contain at least 32 characters");
  const database = new DatabaseSync(databasePath, { timeout: 5000 });
  database.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON");
  database.exec(`CREATE TABLE IF NOT EXISTS auth_email_limits(
    dimension TEXT NOT NULL, value_hash TEXT NOT NULL, sent_at INTEGER NOT NULL
  ); CREATE INDEX IF NOT EXISTS auth_email_limits_lookup ON auth_email_limits(dimension,value_hash,sent_at);`);
  const protectedDelivery=async (value,ctx)=>{
    const cutoff=Date.now()-3600000,hmac=input=>createHmac("sha256",secret||"development-only-better-auth-secret-32").update(input).digest("hex"),emailHash=hmac(String(value.email).trim().toLowerCase()),ip=ctx?.request?.headers?.get?.("x-real-ip")??"unknown",ipHash=hmac(ip);
    database.prepare("DELETE FROM auth_email_limits WHERE sent_at<?").run(cutoff);
    const count=(dimension,valueHash)=>database.prepare("SELECT count(*) AS n FROM auth_email_limits WHERE dimension=? AND value_hash=? AND sent_at>=?").get(dimension,valueHash,cutoff).n;
    if(count("email",emailHash)>=5||count("ip",ipHash)>=20||count("global","all")>=Number(process.env.AUTH_EMAIL_HOURLY_CAP??1000))throw Object.assign(new Error("Too many email requests"),{status:429});
    await sendOTP(value);const sent=Date.now(),insert=database.prepare("INSERT INTO auth_email_limits VALUES(?,?,?)");insert.run("email",emailHash,sent);insert.run("ip",ipHash,sent);insert.run("global","all",sent);
  };
  const options = {
    appName: "Отголосок", baseURL, basePath: "/api/auth", database,
    secret: secret || "development-only-better-auth-secret-32",
    trustedOrigins: [baseURL], emailAndPassword: { enabled: false },
    user: { additionalFields: { role: { type: "string", required: false, defaultValue: "user", input: false } } },
    // Better Auth refreshes expiresAt at most once a day. Seven days is the
    // inactivity window; authSession separately enforces the 30 day absolute
    // lifetime from the immutable createdAt value.
    session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24 },
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
    plugins: [emailOTP({
      expiresIn: 600, allowedAttempts: 5, storeOTP: "hashed", resendStrategy: "rotate",
      rateLimit: { window: 3600, max: 20 }, sendVerificationOTP: protectedDelivery,
    })],
  };
  const { runMigrations } = await getMigrations(options);
  await runMigrations();
  const auth = betterAuth(options);
  return { auth, database, close: () => database.close() };
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

export function sessionCsrfToken(secret, sessionId) {
  return createHmac("sha256", secret).update(`account-csrf:${sessionId}`).digest("base64url");
}

export function validSessionCsrf(secret, sessionId, candidate) {
  if (typeof candidate !== "string") return false;
  const expected = Buffer.from(sessionCsrfToken(secret, sessionId));
  const actual = Buffer.from(candidate);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function authRequestHandler(auth) {
  return async (req, res) => {
    const origin = `http://${req.headers.host || "localhost"}`;
    const request = new Request(new URL(req.url, origin), {
      method: req.method, headers: req.headers,
      body: ["GET", "HEAD"].includes(req.method) ? undefined : req,
      duplex: ["GET", "HEAD"].includes(req.method) ? undefined : "half",
    });
    const response = await auth.handler(request);
    const headers = Object.fromEntries(response.headers);
    const setCookies = response.headers.getSetCookie?.() ?? [];
    if (setCookies.length) headers["set-cookie"] = setCookies;
    headers["cache-control"] = "no-store";
    res.writeHead(response.status, headers);
    res.end(Buffer.from(await response.arrayBuffer()));
  };
}
