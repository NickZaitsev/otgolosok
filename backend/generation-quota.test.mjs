import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp, parseUserDailyLimit } from "./server.mjs";
import { createStore } from "./store.mjs";
import { createAuth } from "./auth.mjs";
import { createAccountStore } from "./account-store.mjs";

const origin = "https://quota.test";
const walkInput = { start: { address: "Москва, Арбат, 1", location: { lat: 55.75, lon: 37.61 } }, mode: "loop", minutes: 30, consent: true, recoveryToken: "12345678-1234-4234-8234-123456789abc" };

// The test session is chosen per request, so one server can serve several users.
const sessionFromHeader = { api: { getSession: async ({ headers }) => {
  const id = headers.get("x-test-user");
  return id ? { user: { id, email: `${id}@example.test`, name: id, role: "user" }, session: { id: `${id}-session`, createdAt: new Date() } } : null;
} } };

async function listen(t, options) {
  const directory = await mkdtemp(join(tmpdir(), "otg-quota-"));
  const store = createStore(":memory:", { maxActive: 100 });
  const app = createApp({ store, provider: /** @type {any} */ ({}), origin, audioDirectory: directory, workerEnabled: false, ...options });
  await /** @type {Promise<void>} */ (new Promise(done => app.server.listen(0, "127.0.0.1", done)));
  t.after(async () => { await app.close(); store.close(); await rm(directory, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${/** @type {import("node:net").AddressInfo} */ (app.server.address()).port}`;
  const post = (path, value, user) => fetch(base + path, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json", ...(user ? { "X-Test-User": user } : {}) }, body: JSON.stringify(value) });
  return { base, store, post };
}

async function accounts(t, users) {
  const runtime = await createAuth({ databasePath: ":memory:", baseURL: origin, secret: "generation-quota-secret-longer-than-32-characters", production: false });
  t.after(() => runtime.close());
  const time = new Date().toISOString();
  for (const id of users) runtime.database.prepare("INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt) VALUES(?,?,?,?,?,?)").run(id, id, `${id}@example.test`, 1, time, time);
  const units = user => runtime.accountDatabase.prepare("SELECT COALESCE(SUM(units),0) AS value FROM user_generation_quota WHERE user_id=?").get(user).value;
  return { accountStore: createAccountStore(runtime.accountDatabase), units };
}

test("without authentication paid generation is refused and existing jobs stay readable", async t => {
  const f = await listen(t, {});
  const job = f.store.createOrGet({ key: "existing", address: "Москва, Арбат, 2" });
  for (const [path, value] of /** @type {[string, object][]} */ ([["/api/story-jobs", { address: "Москва, Арбат, 3", idempotencyKey: "anonymous-story-1" }], [`/api/story-jobs/${job.id}/retry`, { revision: 0 }], ["/api/walk-research-jobs", walkInput]])) {
    const response = await f.post(path, value);
    assert.equal(response.status, 503, path);
    assert.deepEqual(/** @type {any} */ (await response.json()).error, { code: "AUTH_REQUIRED", message: "Генерация доступна только после входа." });
  }
  assert.equal((await fetch(`${f.base}/api/story-jobs/${job.id}`)).status, 200);
  assert.equal(f.store.listAdmin().jobs.length, 1);
});

test("each user has an own daily allowance; a spent quota is a readable 429", async t => {
  const { accountStore, units } = await accounts(t, ["alice", "bob"]);
  const f = await listen(t, { auth: sessionFromHeader, accountStore, userDailyLimit: 2 });
  const story = (user, index) => f.post("/api/story-jobs", { address: `Москва, Арбат, ${index}`, idempotencyKey: `${user}-story-${index}` }, user);
  assert.equal((await story("alice", 1)).status, 200);
  assert.equal((await story("alice", 2)).status, 200);
  const spent = await story("alice", 3);
  assert.equal(spent.status, 429);
  assert.equal(/** @type {any} */ (await spent.json()).error.code, "QUOTA_EXCEEDED");
  assert.equal((await story("bob", 4)).status, 200);
  // A story that already exists costs nothing even for a user whose quota is spent.
  assert.equal((await f.post("/api/story-jobs", { address: "Москва, Арбат, 1", idempotencyKey: "alice-existing" }, "alice")).status, 200);
  assert.deepEqual([units("alice"), units("bob")], [2, 1]);
});

test("a stale repeated retry is refused without refunding the retry it repeats", async t => {
  const { accountStore, units } = await accounts(t, ["alice"]);
  const f = await listen(t, { auth: sessionFromHeader, accountStore });
  const created = /** @type {any} */ (await (await f.post("/api/story-jobs", { address: "Москва, Арбат, 5", idempotencyKey: "retry-story" }, "alice")).json());
  let job = f.store.update(created.id, { stage: "failed" }, created.revision);
  const retried = await f.post(`/api/story-jobs/${job.id}/retry`, { revision: job.revision }, "alice");
  assert.equal(retried.status, 200);
  const staleRevision = job.revision;
  job = f.store.update(job.id, { stage: "failed" }, /** @type {any} */ (await retried.json()).revision);
  assert.equal(units("alice"), 2);
  assert.equal((await f.post(`/api/story-jobs/${job.id}/retry`, { revision: staleRevision }, "alice")).status, 409);
  assert.equal(units("alice"), 2);
  // A retry that fails on its own charge gives that charge back.
  assert.equal((await f.post(`/api/story-jobs/${job.id}/retry`, { revision: job.revision + 7 }, "alice")).status, 409);
  assert.equal(units("alice"), 2);
});

test("the user daily limit is a positive integer read from the environment", () => {
  for (const [value, expected] of [[undefined, 6], ["", 6], ["1", 1], ["12", 12]]) assert.equal(parseUserDailyLimit(value), expected);
  for (const value of ["0", "-1", "1.5", "six", " 6", "99999999999999999999"]) assert.throws(() => parseUserDailyLimit(value), /USER_DAILY_GENERATION_LIMIT/);
});
