import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { LEGAL_READY, TERMS_VERSION } from "../legal/publication.mjs";
import { createReviewRateLimiter } from "./walk-reviews.mjs";
import { failure } from "./domain.mjs";

const LIFETIME = 180 * 24 * 60 * 60 * 1000;
const EVIDENCE_RETENTION = 30 * 24 * 60 * 60 * 1000;

export function createLegalConsentStore(db, { now = Date.now } = {}) {
  db.exec(`CREATE TABLE IF NOT EXISTS analytics_consents (
    id TEXT PRIMARY KEY, version TEXT NOT NULL, accepted_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL, revoked_at INTEGER
  ); CREATE INDEX IF NOT EXISTS analytics_consents_expiry ON analytics_consents(expires_at);`);
  const cleanup = time => db.prepare("DELETE FROM analytics_consents WHERE expires_at < ?").run(time - EVIDENCE_RETENTION);
  cleanup(now());
  return {
    grantAnalytics(previousId = null) {
      const time = now();
      cleanup(time);
      const previous = previousId ? db.prepare("SELECT * FROM analytics_consents WHERE id=?").get(previousId) : null;
      if (previous && previous.version === TERMS_VERSION && !previous.revoked_at && previous.expires_at > time) {
        return { id: previous.id, decidedAt: previous.accepted_at };
      }
      const id = randomUUID();
      db.prepare("INSERT INTO analytics_consents(id,version,accepted_at,expires_at) VALUES(?,?,?,?)").run(id, TERMS_VERSION, time, time + LIFETIME);
      return { id, decidedAt: time };
    },
    revokeAnalytics(id) {
      const time = now();
      cleanup(time);
      if (id) db.prepare("UPDATE analytics_consents SET revoked_at=COALESCE(revoked_at,?) WHERE id=?").run(time, id);
    },
  };
}

/** Consent evidence is pseudonymous; no account, email, raw IP or user-agent is stored. */
export function createLegalConsentRoute({ store, origin, secret, json, body, legalReady = LEGAL_READY,
  limiter = createReviewRateLimiter({ limit: 20, windowMs: 60_000 }),
  grantLimiter = createReviewRateLimiter({ limit: 12, windowMs: 3_600_000 }),
  globalGrantLimiter = createReviewRateLimiter({ limit: 2000, windowMs: 86_400_000, maxKeys: 1 }) }) {
  const signature = id => createHmac("sha256", secret).update(`analytics-consent:${id}`).digest("base64url");
  const verifiedId = receipt => {
    if (receipt === undefined || receipt === null) return null;
    if (typeof receipt !== "string" || !/^[a-f0-9-]{36}\.[A-Za-z0-9_-]{43}$/.test(receipt)) throw failure("BAD_REQUEST");
    const [id, signed] = receipt.split(".");
    if (!timingSafeEqual(Buffer.from(signature(id)), Buffer.from(signed))) throw failure("BAD_REQUEST");
    return id;
  };
  return async (req, res, url) => {
    if (url.pathname !== "/api/legal/analytics-choice") return false;
    if (req.method !== "POST") { res.setHeader("Allow", "POST"); json(res, 405, {error: {code: "METHOD_NOT_ALLOWED"}}); return true; }
    if (url.search || !origin || req.headers.origin !== origin || req.headers["sec-fetch-site"] === "cross-site") {
      json(res, 403, {error: {code: "FORBIDDEN", message: "Запрос должен исходить с сайта."}}); return true;
    }
    if (!store || !secret) { json(res, 503, {error: {code: "UNAVAILABLE", message: "Не удалось сохранить выбор."}}); return true; }
    const key = String(req.headers["x-real-ip"] ?? req.socket.remoteAddress ?? "unknown");
    const limit = limiter.check(key);
    if (!limit.allowed) { res.setHeader("Retry-After", String(limit.retryAfterSec)); json(res, 429, {error: {code: "RATE_LIMITED"}}); return true; }
    limiter.record(key);
    const input = await body(req, 1024);
    if (Object.keys(input).some(key => !["analytics", "version", "receipt"].includes(key)) ||
      typeof input.analytics !== "boolean" || input.version !== TERMS_VERSION) throw failure("BAD_REQUEST");
    const previousId = verifiedId(input.receipt);
    if (!input.analytics) {
      store.revokeAnalytics(previousId);
      json(res, 200, {receipt: null}); return true;
    }
    if (!legalReady) { json(res, 503, {error: {code: "LEGAL_UNAVAILABLE", message: "Аналитика временно недоступна."}}); return true; }
    // Anonymous grants create persistent evidence. Bound that growth across IPs
    // without imposing either grant budget on withdrawal or ordinary accounts.
    for (const budget of [grantLimiter.check(key), globalGrantLimiter.check("all")]) {
      if (!budget.allowed) { res.setHeader("Retry-After", String(budget.retryAfterSec)); json(res, 429, {error: {code: "RATE_LIMITED"}}); return true; }
    }
    grantLimiter.record(key);
    globalGrantLimiter.record("all");
    const saved = store.grantAnalytics(previousId);
    json(res, 200, {receipt: `${saved.id}.${signature(saved.id)}`, decidedAt: saved.decidedAt});
    return true;
  };
}
