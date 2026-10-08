import test from "node:test";
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {createServer} from "node:http";
import {createLegalConsentRoute, createLegalConsentStore} from "./legal-consent.mjs";
import {TERMS_VERSION} from "../legal/publication.mjs";

async function fixture(t, legalReady = true) {
  const db = new DatabaseSync(":memory:");
  const store = createLegalConsentStore(db);
  const handler = createLegalConsentRoute({store, origin: "http://localhost", secret: "test-only-consent-secret-longer-than-32-characters", legalReady,
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
