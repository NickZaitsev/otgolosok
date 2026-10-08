import test from "node:test";
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {createServer} from "node:http";
import {createLegalConsentRoute, createLegalConsentStore} from "./legal-consent.mjs";
import {TERMS_VERSION} from "../legal/publication.mjs";
import {createReviewRateLimiter} from "./walk-reviews.mjs";

async function fixture(t, legalReady = true, budgets = {}) {
  const db = new DatabaseSync(":memory:");
  const store = createLegalConsentStore(db);
  const handler = createLegalConsentRoute({store, origin: "http://localhost", secret: "test-only-consent-secret-longer-than-32-characters", legalReady, ...budgets,
    json: (res, status, value) => {res.writeHead(status, {"Content-Type": "application/json", "Cache-Control": "no-store"}); res.end(JSON.stringify(value));},
    body: async req => {const parts = [];for await (const part of req) parts.push(part); return JSON.parse(Buffer.concat(parts).toString());},
  });
  const server = createServer(async (req, res) => {try {await handler(req, res, new URL(req.url, "http://localhost"));}catch {res.writeHead(400);res.end();}});
  await /** @type {Promise<void>} */ (new Promise(resolve => server.listen(0, "127.0.0.1", resolve)));
  t.after(async () => {server.closeAllConnections();await new Promise(resolve => server.close(resolve));db.close();});
  const endpoint = `http://127.0.0.1:${/** @type {import("node:net").AddressInfo} */ (server.address()).port}/api/legal/analytics-choice`;
  const send = (body, headers = {}) => fetch(endpoint, {method: "POST", headers: {Origin: "http://localhost", "Content-Type": "application/json", ...headers}, body: JSON.stringify({version: TERMS_VERSION, ...body})});
  return {db, send, endpoint};
}

test("durable analytics evidence is idempotent, revocable and cannot be forged", async t => {
  const {db, send} = await fixture(t);
  const granted = await send({analytics: true});assert.equal(granted.status, 200);
  const {receipt, decidedAt} = /** @type {any} */ (await granted.json());
  const id = receipt.split(".")[0];
  const stored = db.prepare("SELECT * FROM analytics_consents WHERE id=?").get(id);
  assert.equal(stored.accepted_at, decidedAt);assert.equal(stored.version, TERMS_VERSION);assert.equal(stored.revoked_at, null);
  const retried = await send({analytics: true, receipt});assert.deepEqual(await retried.json(), {receipt, decidedAt});
  assert.equal(db.prepare("SELECT count(*) AS count FROM analytics_consents").get().count, 1);
  const forged = await send({analytics: false, receipt: id + "." + "a".repeat(43)});assert.equal(forged.status, 400);
  assert.equal(db.prepare("SELECT revoked_at FROM analytics_consents WHERE id=?").get(id).revoked_at, null);
  assert.equal((await send({analytics: false, receipt})).status, 200);
  assert.ok(db.prepare("SELECT revoked_at FROM analytics_consents WHERE id=?").get(id).revoked_at >= decidedAt);
});

test("consent rejects cross-site, malformed and stale requests before writing", async t => {
  const {db, send, endpoint} = await fixture(t);
  assert.equal((await fetch(endpoint)).status, 405);
  assert.equal((await send({analytics: true}, {Origin: "https://other.test"})).status, 403);
  assert.equal((await send({analytics: true}, {"Sec-Fetch-Site": "cross-site"})).status, 403);
  for (const body of [{analytics: "true"}, {analytics: true, version: "old"}, {analytics: true, email: "extra@example.test"}]) {
    assert.equal((await send(body)).status, 400);
  }
  assert.equal(db.prepare("SELECT count(*) AS count FROM analytics_consents").get().count, 0);
});

test("unpublished policies prevent analytics consent", async t => {
  const {db, send} = await fixture(t, false);
  assert.equal((await send({analytics: true})).status, 503);
  assert.equal((await send({analytics: false})).status, 200);
  assert.equal(db.prepare("SELECT count(*) AS count FROM analytics_consents").get().count, 0);
});

test("expired evidence is replaced and removed after its retention period", () => {
  const db = new DatabaseSync(":memory:");let time = 1_000;
  try {
    const store = createLegalConsentStore(db, {now: () => time});
    const initial = store.grantAnalytics();time += 180 * 24 * 60 * 60 * 1000;
    const renewed = store.grantAnalytics(initial.id);assert.notEqual(renewed.id, initial.id);
    time += 31 * 24 * 60 * 60 * 1000;store.grantAnalytics(renewed.id);
    assert.equal(db.prepare("SELECT * FROM analytics_consents WHERE id=?").get(initial.id), undefined);
  } finally {db.close();}
});

test("old consent evidence is cleaned on store startup and withdrawal", () => {
  const db = new DatabaseSync(":memory:");let time = 1_000;
  try {
    const store = createLegalConsentStore(db, {now: () => time});
    const first = store.grantAnalytics();
    time += 211 * 24 * 60 * 60 * 1000;
    createLegalConsentStore(db, {now: () => time});
    assert.equal(db.prepare("SELECT id FROM analytics_consents WHERE id=?").get(first.id), undefined);
    const second = store.grantAnalytics();
    time += 211 * 24 * 60 * 60 * 1000;
    store.revokeAnalytics(null);
    assert.equal(db.prepare("SELECT id FROM analytics_consents WHERE id=?").get(second.id), undefined);
  } finally {db.close();}
});

test("consent endpoint limits repeated requests and exposes a bounded retry delay", async t => {
  const {db, send} = await fixture(t);
  for (let count = 0; count < 20; count++) assert.equal((await send({analytics: false})).status, 200);
  const limited = await send({analytics: true});
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get("Retry-After")) > 0 && Number(limited.headers.get("Retry-After")) <= 60);
  assert.equal(db.prepare("SELECT count(*) AS count FROM analytics_consents").get().count, 0);
});

test("per-IP grant budget bounds persisted records while withdrawal remains available", async t => {
  const {db, send} = await fixture(t);
  let receipt;
  for (let count = 0; count < 12; count++) {
    const granted = await send({analytics: true});
    assert.equal(granted.status, 200);
    receipt = (/** @type {any} */ (await granted.json())).receipt;
  }
  const denied = await send({analytics: true});
  assert.equal(denied.status, 429);
  assert.ok(Number(denied.headers.get("Retry-After")) > 60 && Number(denied.headers.get("Retry-After")) <= 3600);
  assert.equal(db.prepare("SELECT count(*) AS count FROM analytics_consents").get().count, 12);
  assert.equal((await send({analytics: false, receipt})).status, 200);
  assert.equal(typeof db.prepare("SELECT revoked_at FROM analytics_consents WHERE id=?").get(receipt.split(".")[0]).revoked_at, "number");
});

test("global grant budget applies across IP addresses and resets after its window", async t => {
  let time = 1000;
  const {db, send} = await fixture(t, true, {globalGrantLimiter: createReviewRateLimiter({limit: 2, windowMs: 86_400_000, maxKeys: 1, now: () => time})});
  const first = await send({analytics: true}, {"X-Real-IP": "10.0.0.1"});
  const receipt = (/** @type {any} */ (await first.json())).receipt;
  assert.equal((await send({analytics: true}, {"X-Real-IP": "10.0.0.2"})).status, 200);
  const denied = await send({analytics: true}, {"X-Real-IP": "10.0.0.3"});
  assert.equal(denied.status, 429);
  assert.equal(Number(denied.headers.get("Retry-After")), 86400);
  assert.equal(db.prepare("SELECT count(*) AS count FROM analytics_consents").get().count, 2);
  assert.equal((await send({analytics: false, receipt}, {"X-Real-IP": "10.0.0.4"})).status, 200);
  assert.equal(typeof db.prepare("SELECT revoked_at FROM analytics_consents WHERE id=?").get(receipt.split(".")[0]).revoked_at, "number");
  time += 86_400_000;
  assert.equal((await send({analytics: true}, {"X-Real-IP": "10.0.0.3"})).status, 200);
  assert.equal(db.prepare("SELECT count(*) AS count FROM analytics_consents").get().count, 3);
});
