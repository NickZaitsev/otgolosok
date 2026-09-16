import { DatabaseSync } from "node:sqlite";
import { betterAuth } from "better-auth";
import { getMigrations } from "better-auth/db/migration";
import { emailOTP } from "better-auth/plugins";

const noopDelivery = async ({ email, otp }) => {
  if (process.env.NODE_ENV !== "test") console.info(`Login code for ${email}: ${otp}`);
};

export async function createAuth({ databasePath, baseURL, secret, sendOTP = noopDelivery, production = process.env.NODE_ENV === "production" }) {
  if (!baseURL) throw new Error("APP_ORIGIN is required for authentication");
  if (production && (!secret || secret.length < 32)) throw new Error("BETTER_AUTH_SECRET must contain at least 32 characters");
  const database = new DatabaseSync(databasePath, { timeout: 5000 });
  database.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON");
  const options = {
    appName: "Отголосок", baseURL, basePath: "/api/auth", database,
    secret: secret || "development-only-better-auth-secret-32",
    trustedOrigins: [baseURL], emailAndPassword: { enabled: false },
    user: { additionalFields: { role: { type: "string", required: false, defaultValue: "user", input: false } } },
    session: { expiresIn: 60 * 60 * 24 * 30, updateAge: 60 * 60 * 24 },
    rateLimit: { enabled: true, window: 60, max: 20, storage: "database" },
    advanced: {
      useSecureCookies: production,
      defaultCookieAttributes: { httpOnly: true, secure: production, sameSite: "lax", path: "/" },
      cookiePrefix: "otgolosok",
      ipAddress: { ipAddressHeaders: ["x-real-ip"] },
    },
    plugins: [emailOTP({
      expiresIn: 600, allowedAttempts: 5, storeOTP: "hashed", resendStrategy: "rotate",
      rateLimit: { window: 60, max: 1 }, sendVerificationOTP: sendOTP,
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
  return auth.api.getSession({ headers });
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
