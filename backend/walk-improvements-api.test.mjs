import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createAccountStore } from "./account-store.mjs";
import { createStore } from "./store.mjs";
import { createApp } from "./server.mjs";
import { sessionCsrfToken } from "./auth.mjs";
import { createReviewRateLimiter } from "./walk-reviews.mjs";

const origin = "https://improvements.test", secret = "walk-improvements-api-secret-longer-than-32", CATALOG = "msk-kozhevniki-zindel-short";
const GUEST_KEY = "g".repeat(43);
const snapshot = { version: 1, title: "Моя", start: null, stops: [], mode: "loop", minutes: 30, route: null, jobs: [], submitting: null };

async function fixture(t) {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE user (id TEXT PRIMARY KEY, name TEXT, email TEXT);
    INSERT INTO user VALUES ('anna','Анна','anna@example.test'), ('boris','Борис','boris@example.test'), ('editor','Редактор','editor@example.test')`);
  const accountStore = createAccountStore(db), store = createStore(":memory:");
  let clock = 0;
  /** @type {{ id: string, role: string } | null} */
  let user = null;
  const auth = /** @type {any} */ ({ api: { getSession: async () => user ? { user: { ...user, name: user.id, email: `${user.id}@example.test` }, session: { id: `session-${user.id}`, createdAt: new Date() } } : null } });
  const app = createApp({ store, accountStore, auth, authSecret: secret, provider: null, origin, audioDirectory: "/tmp", workerEnabled: false, allowLegacyAdminToken: false,
    improvementLimiter: createReviewRateLimiter({ now: () => clock }) });
  await new Promise(resolve => app.server.listen(0, "127.0.0.1", () => resolve(null)));
  t.after(async () => { await app.close(); store.close(); db.close(); });
  const base = `http://127.0.0.1:${/** @type {import("node:net").AddressInfo} */ (app.server.address()).port}`;
  const as = value => { user = value ? { id: value, role: value === "editor" ? "editor" : "user" } : null; };
  /** @param {string} path @param {{ method?: string, body?: unknown, headers?: Record<string, string | null> }} [init] */
  const call = async (path, { method = "GET", body, headers = {} } = {}) => {
    const merged = {
      ...(method === "GET" ? {} : { Origin: origin, "Content-Type": "application/json" }),
      ...(user && method !== "GET" ? { "X-CSRF-Token": sessionCsrfToken(secret, `session-${user.id}`) } : {}),
      ...(!user ? { "X-Review-Key": GUEST_KEY } : {}),
      ...headers,
    };
    const response = await fetch(base + path, { method, headers: Object.fromEntries(Object.entries(merged).filter(([, value]) => value !== null)), ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, headers: response.headers, text: await response.text(), get data() { return JSON.parse(this.text); } };
  };
  const walk = accountStore.createWalk("anna", { title: "Аннина прогулка", idempotencyKey: "improvement-api-walk", snapshot });
  const shared = accountStore.setWalkVisibility("anna", walk.id, walk.revision, "shared");
  return { call, as, accountStore, walk: shared, advance: ms => { clock += ms; } };
}

test("guest requests need same origin, a device key and a strict body", async t => {
  const { call } = await fixture(t);
  const path = `/api/story-walks/${CATALOG}/improvements/mine`, body = { issues: ["voiceover"] };
  assert.equal((await call(path, { method: "PUT", body, headers: { Origin: "https://evil.test" } })).status, 403);
  assert.equal((await call(path, { method: "PUT", body, headers: { "Sec-Fetch-Site": "cross-site" } })).status, 403);
  assert.equal((await call(path, { method: "PUT", body, headers: { "X-Review-Key": "short" } })).status, 400);
  const missingKey = await call(path, { method: "PUT", body, headers: { "X-Review-Key": null } });
  assert.equal(missingKey.status, 400);
  assert.equal(missingKey.data.error.code, "REVIEW_KEY_REQUIRED");
  for (const bad of [{}, { issues: ["voiceover"], text: "x" }, { issues: ["loud"] }, { issues: "voiceover" }]) {
    assert.equal((await call(path, { method: "PUT", body: bad })).status, 400, JSON.stringify(bad));
  }
  assert.equal((await call(`${path}?x=1`)).status, 400);
  const wrongMethod = await call(path, { method: "DELETE" });
  assert.equal(wrongMethod.status, 405); assert.equal(wrongMethod.headers.get("allow"), "GET, PUT");
  assert.deepEqual((await call(path, { headers: { "X-Review-Key": null } })).data, { mine: null });
  const saved = await call(path, { method: "PUT", body: { issues: ["voiceover", "short_text"] } });
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.data.mine.issues, ["short_text", "voiceover"]);
  assert.deepEqual((await call(path)).data.mine.issues, ["short_text", "voiceover"]);
  assert.deepEqual((await call(path, { method: "PUT", body: { issues: [] } })).data, { mine: null });
});

test("signed-in requests need CSRF and reach the editors, who resolve them per walk", async t => {
  const { call, as } = await fixture(t);
  await call(`/api/story-walks/${CATALOG}/improvements/mine`, { method: "PUT", body: { issues: ["no_images"] } });
  as("anna");
  const path = `/api/story-walks/${CATALOG}/improvements/mine`;
  assert.equal((await call(path, { method: "PUT", body: { issues: ["voiceover"] }, headers: { "X-CSRF-Token": "forged" } })).status, 403);
  assert.equal((await call(path, { method: "PUT", body: { issues: ["voiceover", "no_images"] } })).status, 200);
  as("editor");
  const queue = await call("/api/story-admin/improvements");
  assert.equal(queue.status, 200);
  assert.equal(queue.data.open, 2);
  assert.deepEqual(queue.data.walks.map(item => [item.walk.url, item.total, item.issues]), [
    [`/walk?catalog=${CATALOG}`, 2, { short_text: 0, no_images: 2, voiceover: 1 }],
  ]);
  assert.equal(queue.text.includes("anna"), false, "the overview names no requesters");
  const resolved = await call("/api/story-admin/improvements/resolve", { method: "POST", body: { kind: "catalog", id: CATALOG } });
  assert.deepEqual(resolved.data, { resolved: 2 });
  assert.equal((await call("/api/story-admin/improvements")).data.total, 0);
  as("anna");
  assert.equal((await call(path)).data.mine.status, "resolved");
});

test("unknown, revoked and foreign walks all answer the same 404; owners use the account route", async t => {
  const { call, as, accountStore, walk } = await fixture(t);
  const shared = `/api/story-walks/shared/${walk.shareToken}/improvements/mine`;
  assert.equal((await call(shared, { method: "PUT", body: { issues: ["short_text"] } })).status, 200);
  as("boris");
  const responses = [
    await call("/api/story-walks/no-such-walk/improvements/mine"),
    await call(`/api/story-walks/shared/${crypto.randomUUID()}/improvements/mine`),
    await call(`/api/me/walks/${walk.id}/improvements/mine`),
  ];
  accountStore.setWalkVisibility("anna", walk.id, walk.revision, "private");
  responses.push(await call(shared));
  for (const response of responses) {
    assert.equal(response.status, 404);
    assert.deepEqual(response.data, { error: { code: "NOT_FOUND", message: "Прогулка не найдена." } });
  }
  as("anna");
  const own = await call(`/api/me/walks/${walk.id}/improvements/mine`, { method: "PUT", body: { issues: ["voiceover"] } });
  assert.equal(own.status, 200);
  as("editor");
  const listed = await call("/api/story-admin/improvements");
  assert.deepEqual(listed.data.walks.map(item => [item.walk.title, item.walk.url, item.total]), [["Аннина прогулка", null, 2]], "a revoked walk has no public link");
});

test("improvement writes are limited to 20 per hour per client", async t => {
  const { call, advance } = await fixture(t);
  const path = `/api/story-walks/${CATALOG}/improvements/mine`;
  for (let index = 0; index < 20; index++) {
    assert.equal((await call(path, { method: "PUT", body: { issues: index % 2 ? [] : ["voiceover"] } })).status, 200, `write ${index}`);
  }
  const limited = await call(path, { method: "PUT", body: { issues: ["voiceover"] } });
  assert.equal(limited.status, 429);
  assert.equal(limited.data.error.code, "RATE_LIMITED");
  assert.equal(limited.headers.get("retry-after"), "3600");
  assert.equal((await call(path)).status, 200, "reads are not limited");
  advance(3_600_001);
  assert.equal((await call(path, { method: "PUT", body: { issues: ["voiceover"] } })).status, 200);
});

test("the editor overview rejects non-editors and malformed input", async t => {
  const { call, as } = await fixture(t);
  for (const role of [null, "anna"]) {
    as(role);
    assert.equal((await call("/api/story-admin/improvements")).status, 401);
  }
  as("editor");
  for (const query of ["status=bad", "issue=loud", "limit=51", "limit=x", "offset=-1", "q=a&q=b", "unknown=1", "q=" + "x".repeat(121)]) {
    assert.equal((await call(`/api/story-admin/improvements?${query}`)).status, 400, query);
  }
  for (const body of [{ kind: "route", id: CATALOG }, { kind: "catalog" }, { kind: "catalog", id: CATALOG, extra: 1 }]) {
    assert.equal((await call("/api/story-admin/improvements/resolve", { method: "POST", body })).status, 400, JSON.stringify(body));
  }
  assert.equal((await call("/api/story-admin/improvements/resolve")).status, 405);
});
