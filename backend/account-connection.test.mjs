import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAuth } from "./auth.mjs";
import { createAccountStore, MAX_WALKS_PER_USER, MAX_FAVORITES_PER_USER } from "./account-store.mjs";

const draft = { version: 1, title: "Арбат", start: null, stops: [], mode: "loop", minutes: 30, route: null, jobs: [], submitting: null };

async function runtimeOnDisk(t) {
  const directory = await mkdtemp(join(tmpdir(), "otg-account-connection-"));
  const runtime = await createAuth({ databasePath: join(directory, "auth.sqlite"), baseURL: "http://localhost", secret: "connection-test-secret-with-more-than-32-chars", production: false });
  // node:test runs after-hooks in registration order: close SQLite before deleting its directory.
  t.after(() => runtime.close());
  t.after(() => rm(directory, { recursive: true, force: true }));
  const time = new Date().toISOString();
  runtime.database.prepare("INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt) VALUES(?,?,?,?,?,?)").run("u1", "Один", "one@example.com", 1, time, time);
  return runtime;
}

// Better Auth keeps its own transaction open across awaits (sign-up hashes the
// password inside `runWithTransaction`). The account store must not share that
// connection, otherwise it either fails to BEGIN or writes into Better Auth's
// transaction and loses the write on rollback.
test("account writes succeed while Better Auth holds an open transaction", async t => {
  const runtime = await runtimeOnDisk(t);
  const store = createAccountStore(runtime.accountDatabase);
  runtime.database.exec("BEGIN");
  try {
    const walk = store.createWalk("u1", { title: "Арбат", snapshot: draft, idempotencyKey: "walk-during-signup" });
    assert.ok(walk.id);
    const intent = store.beginGeneration("u1", "generation-during-signup", "create", "fingerprint", 1, 6);
    assert.deepEqual(intent, { created: true, jobId: null });
    store.setFavorite("u1", "walk", "paveletskaya");
  } finally {
    runtime.database.exec("ROLLBACK");
  }
  assert.equal(store.listWalks("u1").walks.length, 1);
  assert.equal(store.listFavorites("u1").favorites.length, 1);
});

test("the account store gets its own connection to the auth database", async t => {
  const runtime = await runtimeOnDisk(t);
  assert.notEqual(runtime.accountDatabase, runtime.database);
  assert.equal(runtime.accountDatabase.prepare("PRAGMA journal_mode").get().journal_mode, "wal");
  assert.equal(runtime.accountDatabase.prepare("PRAGMA foreign_keys").get().foreign_keys, 1);
});

async function memoryStore(t, users = ["u1"]) {
  const runtime = await createAuth({ databasePath: ":memory:", baseURL: "http://localhost", secret: "storage-limit-test-secret-with-more-than-32-chars", production: false });
  t.after(() => runtime.close());
  const time = new Date().toISOString();
  for (const id of users) runtime.database.prepare("INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt) VALUES(?,?,?,?,?,?)").run(id, id, `${id}@example.com`, 1, time, time);
  return { runtime, store: createAccountStore(runtime.accountDatabase) };
}

const fill = (db, table, userId, count) => {
  const time = new Date().toISOString();
  const insert = table === "user_walks"
    ? db.prepare("INSERT INTO user_walks(id,user_id,title,snapshot_json,revision,created_at,updated_at) VALUES(?,?,?,?,0,?,?)")
    : db.prepare("INSERT INTO user_favorites VALUES(?,?,?,?)");
  db.exec("BEGIN");
  for (let index = 0; index < count; index++) {
    if (table === "user_walks") insert.run(`seed-${userId}-${index}`, userId, `Прогулка ${index}`, "{}", time, time);
    else insert.run(userId, "story", `seed-${index}`, time);
  }
  db.exec("COMMIT");
};

test("saved walks are capped per account", async t => {
  const { runtime, store } = await memoryStore(t, ["u1", "u2"]);
  fill(runtime.accountDatabase, "user_walks", "u1", MAX_WALKS_PER_USER - 1);
  assert.ok(store.createWalk("u1", { title: "Последняя", snapshot: draft, idempotencyKey: "walk-at-limit" }).id);
  assert.throws(() => store.createWalk("u1", { title: "Лишняя", snapshot: draft, idempotencyKey: "walk-over-limit" }),
    error => error.code === "STORAGE_LIMIT" && /200 прогулок/.test(error.message));
  // A replay of an already stored request is not a new walk.
  assert.ok(store.createWalk("u1", { title: "Последняя", snapshot: draft, idempotencyKey: "walk-at-limit" }).id);
  assert.ok(store.createWalk("u2", { title: "Чужой лимит", snapshot: draft, idempotencyKey: "walk-other-user" }).id);
});

test("favorites are capped per account, re-adding an existing one is allowed", async t => {
  const { runtime, store } = await memoryStore(t);
  fill(runtime.accountDatabase, "user_favorites", "u1", MAX_FAVORITES_PER_USER - 1);
  store.setFavorite("u1", "walk", "last-one");
  assert.throws(() => store.setFavorite("u1", "walk", "one-too-many"), error => error.code === "STORAGE_LIMIT" && /1000/.test(error.message));
  store.setFavorite("u1", "walk", "last-one");
  store.setFavorite("u1", "story", "seed-0");
  assert.equal(runtime.accountDatabase.prepare("SELECT count(*) AS count FROM user_favorites WHERE user_id='u1'").get().count, MAX_FAVORITES_PER_USER);
});

test("an import that would cross a cap stores nothing", async t => {
  const { runtime, store } = await memoryStore(t);
  fill(runtime.accountDatabase, "user_favorites", "u1", MAX_FAVORITES_PER_USER - 1);
  const favorites = [{ type: "walk", id: "import-a" }, { type: "walk", id: "import-b" }];
  assert.throws(() => store.importLocal("u1", { importId: "import-over-cap", walk: { title: "С устройства", snapshot: draft }, favorites }), error => error.code === "STORAGE_LIMIT");
  assert.equal(store.listWalks("u1").walks.length, 0);
  assert.equal(runtime.accountDatabase.prepare("SELECT count(*) AS count FROM account_imports").get().count, 0);
  const imported = store.importLocal("u1", { importId: "import-fits", walk: { title: "С устройства", snapshot: draft }, favorites: favorites.slice(0, 1) });
  assert.equal(imported.favorites, 1);
  assert.ok(imported.walk.id);
});

test("a document ID owned by another account gets a fresh account ID instead of a conflict", async t => {
  const { store } = await memoryStore(t, ["u1", "u2"]);
  const document = { version: 2, id: "99999999-9999-4999-8999-999999999999", title: "Общий маршрут", description: "", city: "Москва", mode: "loop", minutes: 30,
    start: { address: "Москва, Арбат, 1", location: { lat: 55.75, lon: 37.6 } }, stops: [], route: null, fieldChecked: false };
  const first = store.createWalk("u1", { title: document.title, snapshot: document, idempotencyKey: "shared-doc-1" });
  const second = store.createWalk("u2", { title: document.title, snapshot: document, idempotencyKey: "shared-doc-2" });
  assert.equal(first.id, document.id);
  assert.notEqual(second.id, document.id);
  assert.equal(second.snapshot.id, second.id);
  assert.equal(store.getWalk("u1", first.id).title, document.title);
});
