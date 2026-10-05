import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createAccountStore } from "./account-store.mjs";
import { createStore } from "./store.mjs";
import { createApp } from "./server.mjs";
import { sessionCsrfToken } from "./auth.mjs";
import { createReviewRateLimiter } from "./walk-reviews.mjs";

const origin = "https://place-feedback.test", secret = "place-feedback-api-secret-longer-than-32";
const GUEST_KEY = "g".repeat(43);

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
  store.importPlaces({ source: "fixture", sourceSha256: "a".repeat(64), rulesVersion: "v1", coverage: "fixture", places: [{ placeId: "osm:node:7", osmType: "node", osmId: 7, name: "Парк", location: { lat: 55.75, lon: 37.61 }, tags: { leisure: "park" } }] });
  const paragraph = "Проверенный рассказ о московском парке, его истории, архитектуре и людях. ".repeat(9).trim();
  store.createBatch({ requestKey: "place-feedback-fixture", placeIds: ["osm:node:7"], limit: 1, mode: "text-only" });
  const job = store.claimContentJob();
  const story = { title: "Парк", paragraphs: [{ text: paragraph, factIds: ["f1", "f2", "f3"] }, { text: paragraph, factIds: ["f4", "f5"] }] };
  store.completeContentJob(job.id, { story, evidence: { facts: [] } });
  store.approvePlaceText("osm:node:7", story);
  return { call, as, advance: ms => { clock += ms; } };
}

const path = "/api/content/places/osm:node:7/feedback/mine";
const input = { rating: -1, issues: ["voiceover"], text: "Подробнее о парке" };

test("place feedback HTTP flow: guest identity, same-origin protection, strict input and persistence", async t => {
  const { call } = await fixture(t);
  assert.equal((await call(path, { method: "PUT", body: input, headers: { Origin: "https://evil.test" } })).status, 403);
  assert.equal((await call(path, { method: "PUT", body: input, headers: { "Sec-Fetch-Site": "cross-site" } })).status, 403);
  assert.equal((await call(path, { method: "PUT", body: input, headers: { "X-Review-Key": null } })).status, 400);
  assert.equal((await call(path, { method: "PUT", body: input, headers: { "X-Review-Key": "short" } })).status, 400);
  for (const body of [{}, { ...input, rating: 0 }, { ...input, extra: true }, { ...input, text: "я".repeat(1001) }]) {
    assert.equal((await call(path, { method: "PUT", body })).status, 400);
  }
  assert.equal((await call(path + "?unknown=1")).status, 400);
  assert.equal((await call(path, { method: "DELETE" })).status, 405);
  assert.equal((await call(path.replace("node:7", "node:8"))).status, 404);
  assert.equal((await call(path, { method: "PUT", body: input })).status, 200);
  assert.equal((await call(path)).data.mine.text, input.text);
  assert.equal((await call(path, { headers: { "X-Review-Key": "b".repeat(43) } })).data.mine, null);
  assert.equal((await call(path, { method: "PUT", body: { rating: 1, issues: [], text: "" } })).data.mine.rating, 1);
  assert.deepEqual((await call(path, { method: "PUT", body: { rating: null, issues: [], text: "" } })).data, { mine: null });
});

test("signed-in votes require CSRF; only editors can read comments and resolve requests", async t => {
  const { call, as } = await fixture(t);
  assert.equal((await call("/api/story-admin/place-feedback")).status, 401);
  as("anna");
  assert.equal((await call(path, { method: "PUT", body: input, headers: { "X-CSRF-Token": "forged" } })).status, 403);
  assert.equal((await call(path, { method: "PUT", body: input })).status, 200);
  assert.equal((await call("/api/story-admin/place-feedback")).status, 401);
  as("boris");
  assert.equal((await call(path)).data.mine, null);
  as("editor");
  const page = await call("/api/story-admin/place-feedback");
  assert.equal(page.status, 200);
  assert.equal(page.data.total, 1);
  assert.deepEqual(page.data.items[0].place, { id: "osm:node:7", title: "Парк" });
  assert.equal(page.data.items[0].text, input.text);
  assert.equal(page.text.includes("anna"), false);
  assert.deepEqual((await call("/api/story-admin/place-feedback/resolve", { method: "POST", body: { id: page.data.items[0].id } })).data, { resolved: 1 });
  assert.equal((await call("/api/story-admin/place-feedback")).data.total, 0);
  for (const query of ["limit=51", "offset=-1", "limit=x", "limit=1&limit=2", "unknown=1"]) {
    assert.equal((await call("/api/story-admin/place-feedback?" + query)).status, 400);
  }
});

test("place writes share the bounded feedback limiter; reads remain available", async t => {
  const { call, advance } = await fixture(t);
  for (let i = 0; i < 20; i++) assert.equal((await call(path, { method: "PUT", body: input })).status, 200);
  const limited = await call(path, { method: "PUT", body: input });
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get("retry-after"), "3600");
  assert.equal((await call(path)).status, 200);
  advance(3600001);
  assert.equal((await call(path, { method: "PUT", body: input })).status, 200);
});
