import test from "node:test";
import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { startTtsApiWorker } from "./tts-api-worker.mjs";
import { createTtsApiClient } from "./tts-api-client.mjs";
import { sleep } from "./retry.mjs";

const claim = { id: "job-1", leaseGeneration: 1, leaseToken: "lease", spokenText: "Текст",
  profile: { id: "f5-ru-v1", engine: "f5", modelSha256: "m", configSha256: "c", referenceSha256: "r", textPreparation: { version: "v1" } } };

// One claim, then an empty queue; the outcome resolves when the attempt is accepted or failed.
function fakeStore() {
  let claimed = false, settle;
  const outcome = new Promise(resolve => { settle = resolve; });
  return { outcome, heartbeats: 0,
    claimExternalAudio() { if (claimed) return null; claimed = true; return claim; },
    heartbeatExternalAudio() { this.heartbeats++; },
    failExternalAudio(id, value) { settle({ failed: value.code }); },
    acceptExternalAudio(id, value) { settle({ accepted: value.uploadSha256 }); },
  };
}

const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json", "Retry-After": "0" } });

test("a remote synthesis that never finishes fails the attempt at the poll deadline", { timeout: 5000 }, async t => {
  const store = fakeStore();
  const client = { create: async () => ({ id: "remote-1" }), get: async () => ({ state: "running" }), audio: async () => assert.fail("no audio"), ack: async () => {} };
  const worker = startTtsApiWorker({ store, client, audioDirectory: "unused", profileId: "f5-ru-v1", pollMs: 5, pollDeadlineMs: 40 });
  t.after(() => worker.stop());
  assert.deepEqual(await store.outcome, { failed: "TTS_TIMEOUT" });
  assert.ok(store.heartbeats >= 1);
});

test("a transient poll failure does not fail the job", { timeout: 5000 }, async t => {
  const store = fakeStore();
  const replies = [json({ detail: "busy" }, 503), json({ job: { state: "succeeded", result: { sha256: "a".repeat(64), voice: "f5" } } })];
  const fetchImpl = async url => {
    if (url.endsWith("/v1/jobs")) return json({ id: "remote-1" }, 202);
    if (url.endsWith("/audio")) return new Response("mp3", { headers: { "x-content-sha256": "a".repeat(64) } });
    if (url.endsWith("/ack")) return json({});
    return replies.shift();
  };
  const client = createTtsApiClient({ baseUrl: "https://tts.test", token: "secret", fetchImpl, retry: { attempts: 3, baseMs: 0 } });
  const audioIngest = async (bytes, directory, { expectedSha256 }) => ({ artifact: { sha256: expectedSha256, bytes: bytes.length } });
  const worker = startTtsApiWorker({ store, client, audioDirectory: "unused", profileId: "f5-ru-v1", pollMs: 5, audioIngest });
  t.after(() => worker.stop());
  assert.deepEqual(await store.outcome, { accepted: "a".repeat(64) });
});

test("waiting between polls leaves no abort listeners behind", async () => {
  const controller = new AbortController();
  for (let index = 0; index < 50; index++) await sleep(0, controller.signal);
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
});
