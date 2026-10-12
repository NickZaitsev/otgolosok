import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createAccountStore } from "./account-store.mjs";
import { createStore } from "./store.mjs";
import { createApp } from "./server.mjs";

const origin = "https://walk-map.test", secret = "walk-map-api-secret-longer-than-32-chars";
const start = { address: "Москва, Арбат, 1", location: { lat: 55.75, lon: 37.6 } }, stop = { address: "Москва, Арбат, 10", location: { lat: 55.751, lon: 37.601 } };
let ids = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++ids).padStart(12, "0")}`;
const routed = () => ({ version: 2, id: uuid(), title: "Арбат", description: "", city: "Москва", mode: "open", minutes: 30, start,
  stops: [{ id: uuid(), place: stop, storyRef: null, transition: "", nextHint: "" }],
  route: { geometry: [start.location, stop.location], distanceM: 3200, walkingMinutes: 45, attribution: "OSM" }, fieldChecked: false });
const AREA = "/api/walks/map?west=37.5&south=55.7&east=37.7&north=55.8";

/** @param {any} t @param {{ withAccounts?: boolean }} [options] */
async function fixture(t, { withAccounts = true } = {}) {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE user (id TEXT PRIMARY KEY, name TEXT, email TEXT); INSERT INTO user VALUES ('anna','Анна','anna@example.test')");
  const accountStore = createAccountStore(db), store = createStore(":memory:");
  const auth = /** @type {any} */ ({ api: { getSession: async () => null } });
  const app = createApp({ store, accountStore: withAccounts ? accountStore : undefined, auth, authSecret: secret, provider: null, origin, audioDirectory: "/tmp", workerEnabled: false, allowLegacyAdminToken: false });
  await new Promise(resolve => app.server.listen(0, "127.0.0.1", () => resolve(null)));
  t.after(async () => { await app.close(); store.close(); db.close(); });
  const base = `http://127.0.0.1:${/** @type {import("node:net").AddressInfo} */ (app.server.address()).port}`;
  /** @param {string} path @param {RequestInit} [init] */
  const call = async (path, init = {}) => {
    const response = await fetch(base + path, init);
    return { status: response.status, headers: response.headers, text: await response.text(), get data() { return JSON.parse(this.text); } };
  };
  return { call, accountStore };
}

test("bad areas are rejected", async t => {
  const { call } = await fixture(t);
  const cases = ["", "?west=37.5&south=55.7&east=37.7", "?west=37.5&south=55.7&east=37.7&north=55.8&zoom=12",
    "?west=37.5&west=37.6&south=55.7&east=37.7", "?west=abc&south=55.7&east=37.7&north=55.8", "?west=1e1&south=55.7&east=37.7&north=55.8",
    "?west=37.5&south=55.7&east=37.7&north=55.1234567", "?west=37.7&south=55.7&east=37.5&north=55.8", "?west=37.5&south=55.8&east=37.7&north=55.8",
    "?west=35.5&south=55.7&east=37.7&north=55.8", "?west=37.5&south=55.7&east=37.7&north=95"];
  for (const query of cases) await t.test(query || "(none)", async () => assert.equal((await call(`/api/walks/map${query}`)).status, 400));
});

test("other methods answer 405 with Allow", async t => {
  const { call } = await fixture(t);
  const response = await call(AREA, { method: "POST" });
  assert.equal(response.status, 405);
  assert.equal(response.headers.get("allow"), "GET, HEAD");
});

test("without the account store the map layer is unavailable", async t => {
  const { call } = await fixture(t, { withAccounts: false });
  const response = await call(AREA);
  assert.equal(response.status, 503);
  assert.equal(response.data.error.code, "UNAVAILABLE");
});

test("an approved public walk in the area comes with its line, compressed and never cached", async t => {
  const { call, accountStore } = await fixture(t);
  const created = accountStore.createWalk("anna", { title: "Арбат", snapshot: routed(), idempotencyKey: "map-api-walk" });
  const shared = accountStore.setWalkVisibility("anna", created.id, created.revision, "public");
  accountStore.moderateWalkListing(shared.id, { action: "approve", revision: shared.revision });
  const response = await call(AREA);
  assert.equal(response.status, 200);
  assert.deepEqual(response.data.walks.map((/** @type {any} */ walk) => [walk.id, walk.line]), [[shared.shareToken, [[55.75, 37.6], [55.751, 37.601]]]]);
  // The area tells where someone looks at the map: no cache may keep it, and no ETag invites one to.
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("etag"), null);
  const compressed = await call(AREA, { headers: { "Accept-Encoding": "gzip" } });
  assert.equal(compressed.headers.get("content-encoding"), "gzip");
  assert.deepEqual(JSON.parse(compressed.text), response.data);
  assert.deepEqual((await call("/api/walks/map?west=37.3&south=55.5&east=37.4&north=55.6")).data, { walks: [], complete: true });
});
