import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, utimes, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "./server.mjs";
import { createStore } from "./store.mjs";
import { startWorker } from "./pipeline.mjs";
import { sweepAudioTemporaries } from "./audio-ingest.mjs";

const origin = "https://shutdown.test";
const walk = { start: { address: "Москва, Арбат, 1", location: { lat: 55.75, lon: 37.6 } }, mode: "loop", minutes: 30 };
const plan = { stops: [], geometry: [], distanceM: 100, walkingMinutes: 2, attribution: "test" };

async function listen(t, options) {
  const store = createStore(":memory:");
  const app = createApp({ store, provider: null, origin, audioDirectory: "unused", workerEnabled: false, ...options });
  await /** @type {Promise<void>} */ (new Promise(done => app.server.listen(0, "127.0.0.1", done)));
  t.after(() => store.close());
  const base = `http://127.0.0.1:${/** @type {import("node:net").AddressInfo} */ (app.server.address()).port}`;
  const planWalk = () => fetch(`${base}/api/walk-plan`, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(walk) });
  return { app, base, planWalk };
}

test("shutdown lets an in-flight request finish and then refuses new connections", { timeout: 10000 }, async t => {
  let started;
  const running = new Promise(resolve => { started = resolve; });
  const f = await listen(t, { planWalk: async () => { started(); await new Promise(done => setTimeout(done, 150)); return plan; } });
  const inFlight = f.planWalk();
  await running;
  const closed = f.app.close();
  const response = await inFlight;
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), plan);
  await closed;
  await assert.rejects(fetch(`${f.base}/api/story-service`));
});

test("a request still running after the grace period is cut off instead of blocking shutdown", { timeout: 10000 }, async t => {
  let started;
  const running = new Promise(resolve => { started = resolve; });
  const f = await listen(t, { shutdownGraceMs: 50, planWalk: () => { started(); return new Promise(() => {}); } });
  const inFlight = f.planWalk().catch(error => error);
  await running;
  const began = Date.now();
  await f.app.close();
  assert.ok(Date.now() - began < 2000);
  assert.ok(await inFlight instanceof Error);
});

test("a job aborted by worker shutdown is requeued without using up an attempt", { timeout: 10000 }, async t => {
  const store = createStore(":memory:");
  t.after(() => store.close());
  const job = store.createOrGet({ key: "shutdown", address: "Москва, Арбат, 1" });
  // The research call waits until the worker is stopped.
  const provider = { response: (prompt, { signal }) => new Promise((resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true })) };
  const worker = startWorker({ store, provider, audioDirectory: "unused" });
  assert.equal(store.get(job.id).stage, "researching");
  assert.equal(store.get(job.id).attempts, 1);
  await worker.stop();
  const requeued = store.get(job.id);
  assert.equal(requeued.stage, "queued");
  assert.equal(requeued.attempts, 0);
  assert.equal(requeued.error, null);
  assert.equal(store.claimNext().id, job.id);
});

test("the startup sweep removes only abandoned temporary audio files", async t => {
  const directory = await mkdtemp(join(tmpdir(), "otg-sweep-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
  const files = { ".upload-1-a": true, ".encoded-1-a.mp3": true, "key.source.tmp": true, "key.encoded.tmp.mp3": true, "key.json.tmp": true,
    [`${"a".repeat(64)}.mp3`]: false, "key.json": false, "notes.txt": false };
  for (const [name] of Object.entries(files)) { await writeFile(join(directory, name), "x"); await utimes(join(directory, name), old, old); }
  await writeFile(join(directory, ".upload-2-fresh"), "x");
  assert.equal(await sweepAudioTemporaries(directory), 5);
  const kept = (await readdir(directory)).sort();
  assert.deepEqual(kept, [".upload-2-fresh", ...Object.entries(files).filter(([, removed]) => !removed).map(([name]) => name)].sort());
  assert.equal(await sweepAudioTemporaries(join(directory, "missing")), 0);
});
