import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, writeFile, readFile, access, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), "otg-admin-make-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const capture = join(dir, "args.json");
  // Execute the SSH command through a real second shell, without contacting production.
  await writeFile(join(dir, "ssh"), `#!/usr/bin/env node
import {spawnSync} from 'node:child_process';
const args=process.argv.slice(2);
if(args[0]!=='-t'||args[1]!=='--')process.exit(90);
const result=spawnSync('/bin/sh',['-c',args[3]],{stdio:'inherit'});
process.exit(result.status??91);
`, { mode: 0o755 });
  await writeFile(join(dir, "docker"), `#!/usr/bin/env node
import {writeFileSync} from 'node:fs';
writeFileSync(process.env.TEST_CAPTURE,JSON.stringify(process.argv.slice(2)));
process.exit(Number(process.env.TEST_EXIT??0));
`, { mode: 0o755 });
  const run = (target, variables = [], extra = {}) => spawnSync("make", ["-s", target, ...variables], {
    cwd: resolve(import.meta.dirname, ".."), encoding: "utf8",
    env: { ...process.env, EMAIL: "", PATH: `${dir}:${process.env.PATH}`, TEST_CAPTURE: capture, ...extra },
  });
  return { dir, capture, run };
}

test("deployed Makefile runs on the server without a checkout or SSH back to itself", async t => {
  const f = await fixture(t);
  const { copyFile } = await import("node:fs/promises");
  await copyFile(resolve(import.meta.dirname, "../docker/production.Makefile"), join(f.dir, "Makefile"));
  await writeFile(join(f.dir, "ssh"), "#!/bin/sh\nexit 99\n", { mode: 0o755 });
  const run = (target, variables = [], extra = {}) => spawnSync("make", ["-s", target, ...variables], {
    cwd: f.dir, encoding: "utf8",
    env: { ...process.env, EMAIL: "", PATH: `${f.dir}:${process.env.PATH}`, TEST_CAPTURE: f.capture, ...extra },
  });
  assert.match(run("help").stdout, /admin-create-prod/);
  assert.notEqual(run("admin-create-prod").status, 0);
  await assert.rejects(access(f.capture), { code: "ENOENT" });
  for (const target of ["admin-create", "admin-create-prod"]) {
    const email = "o'brien@example.com";
    const result = run(target, [`EMAIL=${email}`]);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(await readFile(f.capture, "utf8")), ["exec", "-it", "--", "otgolosok-generator-generator-1", "node", "/app/editor-account.mjs", email, "/data/auth.sqlite"]);
  }
  assert.notEqual(run("admin-create-prod", ["EMAIL=admin@example.com"], { TEST_EXIT: "17" }).status, 0);
});

test("Makefile editor commands reject missing email before opening SSH or a database", async t => {
  const f = await fixture(t);
  for (const target of ["admin-create", "admin-create-prod"]) {
    const result = f.run(target);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Укажите EMAIL/);
  }
  await assert.rejects(access(f.capture), { code: "ENOENT" });
});

test("production Makefile command preserves argument boundaries across both shells", async t => {
  const f = await fixture(t);
  for (const email of ["admin@example.com", "o'brien@example.com", `admin; touch ${f.dir}/injected; #`, `admin\`touch ${f.dir}/injected\`@example.com`]) {
    const result = f.run("admin-create-prod", [`EMAIL=${email}`, "GENERATOR_CONTAINER=generator-test"]);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(await readFile(f.capture, "utf8")), ["exec", "-it", "--", "generator-test", "node", "/app/editor-account.mjs", email, "/data/auth.sqlite"]);
    await assert.rejects(access(join(f.dir, "injected")), { code: "ENOENT" });
  }
  assert.notEqual(f.run("admin-create-prod", ["EMAIL=admin@example.com"], { TEST_EXIT: "17" }).status, 0);
});

test("local Makefile command passes an explicit database path including spaces", async t => {
  const f = await fixture(t);
  const result = f.run("admin-create", ["EMAIL=admin@example.com", `AUTH_DB_PATH=${f.dir}/missing database.sqlite`]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Не удалось открыть базу авторизации/);
  await assert.rejects(access(join(f.dir, "missing database.sqlite")), { code: "ENOENT" });
});
