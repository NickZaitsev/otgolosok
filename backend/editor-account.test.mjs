import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createAuth } from "./auth.mjs";
import { ensureEditor } from "./editor-account.mjs";
import { createApp } from "./server.mjs";
import { createStore } from "./store.mjs";

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "otg-editor-"));
  const databasePath = join(directory, "auth.sqlite");
  const runtime = await createAuth({ databasePath, baseURL: "http://localhost", production: false });
  t.after(async () => { runtime.close(); await rm(directory, { recursive: true, force: true }); });
  return { ...runtime, databasePath, directory };
}

function command(args, password = "") {
  return new Promise((resolveResult, reject) => {
    const child = spawn(process.execPath, [resolve("scripts/set-editor.mjs"), ...args], { stdio: "pipe" });
    let output = "";
    child.stdout.on("data", chunk => { output += chunk; });
    child.stderr.on("data", chunk => { output += chunk; });
    child.on("error", reject);
    child.on("close", code => resolveResult({ code, output }));
    child.stdin.on("error", error => { if (error.code !== "EPIPE") reject(error); });
    child.stdin.end(password);
  });
}

test("editor command creates a new account that can sign in with editor access", async t => {
  const f = await fixture(t), password = "editor-password-123";
  const result = await command(["Admin@Example.com", f.databasePath, "--password-stdin"], password + "\n");
  assert.equal(result.code, 0, result.output);
  assert.ok(!result.output.includes(password));
  const login = await f.auth.api.signInEmail({ body: { email: "admin@example.com", password } });
  assert.equal(login.user.role, "editor");
  assert.equal(login.user.name, "Редактор");
  const account = f.database.prepare("SELECT password FROM account WHERE userId=?").get(login.user.id);
  assert.notEqual(account.password, password);
  assert.equal(f.database.prepare("SELECT count(*) n FROM user").get().n, 1);
  await assert.rejects(f.auth.api.signInEmail({ body: { email: "admin@example.com", password: "wrong-password" } }));
  const store = createStore(":memory:");
  const app = createApp({ store, origin: "http://localhost", auth: f.auth, workerEnabled: false });
  await new Promise(done => app.server.listen(0, "127.0.0.1", done));
  t.after(async () => { await app.close(); store.close(); });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const response = await fetch(base + "/api/auth/sign-in/email", { method: "POST", headers: { Origin: "http://localhost", "Content-Type": "application/json" }, body: JSON.stringify({ email: "admin@example.com", password }) });
  assert.equal(response.status, 200);
  const cookie = response.headers.getSetCookie().map(value => value.split(";", 1)[0]).join("; ");
  assert.equal((await fetch(base + "/api/story-admin/jobs", { headers: { Cookie: cookie } })).status, 200);
  assert.equal((await fetch(base + "/api/story-admin/jobs")).status, 401);
});

test("existing users gain editor rights without changing their password, identity or sessions", async t => {
  const f = await fixture(t), password = "original-password";
  const { user } = await f.auth.api.signUpEmail({ body: { name: "Имя пользователя", email: "user@example.com", password } });
  const before = f.database.prepare("SELECT * FROM account WHERE userId=?").get(user.id);
  const sessions = f.database.prepare("SELECT count(*) n FROM session").get().n;
  for (let i = 0; i < 2; i++) {
    const result = await command(["--", "USER@example.com", f.databasePath, "--password-stdin"], password);
    assert.equal(result.code, 0, result.output);
  }
  assert.deepEqual(f.database.prepare("SELECT * FROM account WHERE userId=?").get(user.id), before);
  assert.equal(f.database.prepare("SELECT count(*) n FROM session").get().n, sessions);
  const login = await f.auth.api.signInEmail({ body: { email: user.email, password } });
  assert.equal(login.user.id, user.id);
  assert.equal(login.user.name, user.name);
  assert.equal(login.user.role, "editor");
  const replacement = await command([user.email, f.databasePath, "--password-stdin"], "replacement-password");
  assert.equal(replacement.code, 1);
  assert.ok(!replacement.output.includes("replacement-password"));
  assert.deepEqual(f.database.prepare("SELECT * FROM account WHERE userId=?").get(user.id), before);
});

test("an unverified pre-registered email cannot gain editor rights without its current password", async t => {
  const f = await fixture(t);
  const { user } = await f.auth.api.signUpEmail({ body: { name: "Existing", email: "admin@example.com", password: "existing-password" } });
  const before = f.database.prepare("SELECT * FROM user WHERE id=?").get(user.id);
  const denied = await command([user.email, f.databasePath, "--password-stdin"], "operator-password");
  assert.equal(denied.code, 1);
  assert.match(denied.output, /Права не изменены/);
  assert.deepEqual(f.database.prepare("SELECT * FROM user WHERE id=?").get(user.id), before);
  assert.equal((await command([user.email, f.databasePath])).code, 1);
  assert.equal(f.database.prepare("SELECT role FROM user WHERE id=?").get(user.id).role, "user");
});

test("validation rejects invalid input without creating accounts or leaking passwords", async t => {
  const f = await fixture(t);
  for (const [email, password] of [["admin", "valid-password"], ["a..b@example.com", "valid-password"], ["a!b@example.com", "valid-password"], ["admin'@example.com", "valid-password"], ["admin@example.com", "short"], ["admin@example.com", "x".repeat(129)], ["admin@example.com", "password\nsecond-line"], ["admin@example.com", "x".repeat(1100)]]) {
    const result = await command([email, f.databasePath, "--password-stdin"], password);
    assert.equal(result.code, 1);
    assert.ok(!result.output.includes(password));
    assert.equal(f.database.prepare("SELECT count(*) n FROM user").get().n, 0);
    assert.equal(f.database.prepare("SELECT count(*) n FROM account").get().n, 0);
  }
  const noPassword = await command(["admin@example.com", f.databasePath]);
  assert.equal(noPassword.code, 1);
  assert.match(noPassword.output, /--password-stdin/);
  const missing = join(f.directory, "missing.sqlite");
  assert.equal((await command(["admin@example.com", missing])).code, 1);
  await assert.rejects(access(missing), { code: "ENOENT" });
});

test("password length boundaries work with Better Auth", async t => {
  const f = await fixture(t);
  for (const length of [10, 128]) {
    const email = `editor+length${length}@example.com`, password = "я".repeat(length);
    await ensureEditor(f.database, { email, password });
    const result = await f.auth.api.signInEmail({ body: { email, password } });
    assert.equal(result.user.role, "editor");
  }
});

test("credential insertion failure rolls back the user and does not leak the underlying error", async t => {
  const f = await fixture(t);
  f.database.exec("CREATE TRIGGER reject_account BEFORE INSERT ON account BEGIN SELECT RAISE(ABORT,'private-database-detail'); END");
  const result = await command(["admin@example.com", f.databasePath, "--password-stdin"], "private-password");
  assert.equal(result.code, 1);
  assert.ok(!result.output.includes("private-password"));
  assert.ok(!result.output.includes("private-database-detail"));
  assert.equal(f.database.prepare("SELECT count(*) n FROM user").get().n, 0);
  assert.equal(f.database.prepare("SELECT count(*) n FROM account").get().n, 0);
});

test("concurrent creation leaves one consistent editor account", async t => {
  const f = await fixture(t), args = ["admin@example.com", f.databasePath, "--password-stdin"];
  const results = await Promise.all([command(args, "first-password"), command(args, "second-password")]);
  assert.deepEqual(results.map(result => result.code).sort(), [0, 1]);
  assert.equal(f.database.prepare("SELECT count(*) n FROM user WHERE role='editor'").get().n, 1);
  assert.equal(f.database.prepare("SELECT count(*) n FROM account").get().n, 1);
  const password = results[0].code === 0 ? "first-password" : "second-password";
  assert.equal((await f.auth.api.signInEmail({ body: { email: args[0], password } })).user.role, "editor");
});
