import test from "node:test";
import assert from "node:assert/strict";
import { createStore } from "./store.mjs";
import { createApp } from "./server.mjs";
import { adminAuth } from "./admin.mjs";
import { validateDraft, validateFacts, sha256 } from "./domain.mjs";
import { runJob } from "./pipeline.mjs";

async function fixture(t, { provider = {}, maxDaily = 100, maxActive = 2, adminToken = "test-secret" } = {}) {
  const store = createStore(":memory:", { maxDaily, maxActive });
  const app = createApp({ store, provider, adminToken, origin: "https://site.test", workerEnabled: false });
  await new Promise(done => app.server.listen(0, "127.0.0.1", done));
  t.after(async () => { await app.close(); store.close(); });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const request = (path = "", value, headers = {}) => fetch(base + "/api/story-admin/jobs" + path, {
    method: value === undefined ? "GET" : "POST",
    headers: { Authorization: "Bearer test-secret", Origin: "https://site.test", "Content-Type": "application/json", ...headers },
    ...(value === undefined ? {} : { body: JSON.stringify(value) }),
  });
  const quote = "A checked source quotation with enough characters.";
  const sources = [1, 2].map(i => ({ id: `s${i}`, url: `https://source${i}.example/history`, publisher: `source${i}.example`, title: "Source", text: quote + " PRIVATE_PAGE", secret: "PRIVATE_SOURCE" }));
  const factReview = { addressConfirmed: true, placeName: "House", resolvedAddress: "Address 1", identityNote: "<script>bad()</script>Identity", facts: Array.from({ length: 5 }, (_, i) => ({ id: `f${i + 1}`, claim: "Checked fact", evidence: [{ sourceId: `s${i % 2 + 1}`, quote }] })) };
  const evidence = validateFacts(factReview, sources);
  const draft = { title: "House", paragraphs: [ { text: "word ".repeat(55).trim(), factIds: ["f1", "f2", "f3"] }, { text: "word ".repeat(55).trim(), factIds: ["f4", "f5"] } ] };
  const seed = (key = "one", data = {}) => {
    const job = store.createOrGet({ key, address: "Address 1" });
    return store.update(job.id, { stage: "review_required", error: { code: "REVIEW_REQUIRED", message: "PRIVATE_ERROR" }, data: {
      sources, evidence, factReview, draft, draftCandidate: { ...draft, secret: "PRIVATE_CANDIDATE" },
      review: { approved: false, issues: ["<img src=x onerror=bad()>Check this", { secret: "PRIVATE_ISSUE" }], secret: "PRIVATE_REVIEW" },
      usage: "PRIVATE_USAGE", ...data,
    } }, job.revision);
  };
  return { store, request, seed, draft, base };
}

test("admin auth fails closed, accepts only bearer credentials, throttles with fixed memory and expires", async t => {
  const f = await fixture(t, { adminToken: "" });
  assert.equal((await f.request()).status, 401);
  let now = 0;
  const auth = adminAuth("secret", () => now);
  assert.equal(auth("Bearer secret"), 200);
  for (let i = 0; i < 20; i++) assert.equal(auth(i % 2 ? "Basic secret" : "Bearer wrong"), 401);
  assert.equal(auth("Bearer wrong"), 429);
  assert.equal(auth("Bearer secret"), 200);
  assert.equal(auth("Bearer wrong"), 429);
  now = 60_000;
  assert.equal(auth("Bearer wrong"), 401);
  assert.equal(auth("Bearer secret"), 200);
});

test("admin routes authenticate before lookup, never cache, and project only safe UI fields", async t => {
  const f = await fixture(t); const job = f.seed();
  for (const path of ["", `/${job.id}`, "/not-a-job"]) {
    const res = await f.request(path, undefined, { Authorization: "Bearer wrong" });
    assert.equal(res.status, 401); assert.equal(res.headers.get("cache-control"), "no-store");
    assert.equal((await res.text()).includes(job.id), false);
  }
  const res = await f.request(`/${job.id}`); const value = await res.json();
  assert.deepEqual(Object.keys(value), ["job"]);
  assert.deepEqual(Object.keys(value.job).sort(), ["id", "address", "stage", "revision", "updatedAt", "error", "data", "canApprove"].sort());
  assert.deepEqual(Object.keys(value.job.data), ["editorDraft", "draft", "draftCandidate", "evidence", "review", "factReview"]);
  assert.equal(value.job.canApprove, false);
  assert.equal(JSON.stringify(value).includes("PRIVATE_"), false);
  assert.equal(JSON.stringify(value).includes("<"), false);
  assert.equal(value.job.data.evidence.sources[0].text, undefined);
  const publicValue = await (await fetch(`${f.base}/api/story-jobs/${job.id}`)).json();
  assert.equal(publicValue.data, undefined);
  const list = await (await f.request()).json();
  assert.deepEqual(Object.keys(list), ["jobs", "hasMore"]);
  assert.equal(list.jobs[0].data, undefined);
  assert.equal(list.hasMore, false);
});

test("pagination is deterministic and bounded to 50 with validated offsets", async t => {
  const f = await fixture(t);
  for (let i = 0; i < 51; i++) f.seed(String(i));
  const first = await (await f.request()).json();
  const last = await (await f.request("?offset=50")).json();
  assert.equal(first.jobs.length, 50); assert.equal(first.hasMore, true);
  assert.equal(last.jobs.length, 1); assert.equal(last.hasMore, false);
  assert.equal(first.jobs.some(job => job.id === last.jobs[0].id), false);
  for (const query of ["?limit=51", "?limit=0", "?offset=-1", "?offset=1.5", "?offset=9007199254740992", "?limit=1&limit=2", "?secret=1"]) assert.equal((await f.request(query)).status, 400);
});

test("edits validate origin, schema, byte limit and revision, preserving all model checkpoints", async t => {
  const f = await fixture(t); const job = f.seed(); const path = `/${job.id}/edit`;
  const input = { revision: job.revision, draft: f.draft };
  for (const headers of [{ Origin: "https://evil.test" }, { "Sec-Fetch-Site": "cross-site" }]) assert.equal((await f.request(path, input, headers)).status, 403);
  for (const value of [{ ...input, revision: -1 }, { ...input, secret: true }, { ...input, draft: null }, { ...input, draft: { ...f.draft, verification: "editorial" } }, { ...input, draft: { ...f.draft, title: "я".repeat(17000) } }, { ...input, draft: { ...f.draft, paragraphs: [] } }]) assert.equal((await f.request(path, value)).status, 400);
  const results = await Promise.all([f.request(path, input), f.request(path, input)]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
  const saved = f.store.get(job.id);
  assert.deepEqual(saved.data, { ...job.data, editorDraft: f.draft });
  assert.equal(saved.revision, job.revision + 1);
  assert.equal((await (await f.request(`/${job.id}`)).json()).job.canApprove, true);
  const moved = f.store.update(job.id, { stage: "failed" }, saved.revision);
  assert.equal((await f.request(path, { ...input, revision: moved.revision })).status, 409);
});

test("editor draft text roundtrips exactly through editing, review and publication", async t => {
  const f = await fixture(t); const job = f.seed();
  const draft = { title: "House <old>\u0001 title", paragraphs: f.draft.paragraphs.map(p => ({
    ...p, text: "Before <arch>\u0007 after " + p.text,
  })) };
  const valid = validateDraft(draft, job.data.evidence);
  assert.deepEqual({ title: valid.title, paragraphs: valid.paragraphs }, draft);
  const response = await f.request(`/${job.id}/edit`, { revision: job.revision, draft });
  assert.equal(response.status, 200);
  const { job: saved } = await response.json();
  assert.deepEqual(saved.data.editorDraft, draft);
  assert.deepEqual(f.store.get(job.id).data.editorDraft, draft);
  const { job: detail } = await (await f.request(`/${job.id}`)).json();
  assert.equal(detail.canApprove, true);
  assert.deepEqual(detail.data.editorDraft, draft);
  assert.equal((await f.request(`/${job.id}/approve`, { revision: detail.revision })).status, 200);
  const ready = await runJob(f.store.claimNext(), { store: f.store, provider: {},
    narrate: async story => {
      assert.deepEqual({ title: story.title, paragraphs: story.paragraphs }, draft);
      return { url: "audio", durationSec: 100 };
    },
  });
  assert.equal(ready.stage, "ready");
  const published = await (await fetch(`${f.base}/api/story-jobs/${job.id}`)).json();
  assert.deepEqual({ title: published.story.title, paragraphs: published.story.paragraphs }, draft);
});

test("provider unavailable permits reads and edits but rejects approval without state changes", async t => {
  const f = await fixture(t, { provider: null }); const job = f.seed();
  const response = await f.request(`/${job.id}/edit`, { revision: job.revision, draft: f.draft });
  assert.equal(response.status, 200); const { job: saved } = await response.json();
  assert.equal(saved.canApprove, false);
  const before = f.store.get(job.id);
  assert.equal((await f.request(`/${job.id}/approve`, { revision: saved.revision })).status, 503);
  assert.deepEqual(f.store.get(job.id), before);
});

test("approval requires a saved valid draft and revalidated evidence", async t => {
  const f = await fixture(t); const job = f.seed();
  assert.equal((await f.request(`/${job.id}/approve`, { revision: job.revision })).status, 400);
  let saved = f.store.editAdmin(job.id, job.revision, f.draft);
  saved = f.store.update(job.id, { data: { ...saved.data, sources: saved.data.sources.map(s => ({ ...s, text: "no matching quote" })) } }, saved.revision);
  assert.equal((await (await f.request(`/${job.id}`)).json()).job.canApprove, false);
  assert.equal((await f.request(`/${job.id}/approve`, { revision: saved.revision })).status, 400);
  assert.deepEqual(f.store.get(job.id), saved);
});

test("approval is atomic, consumes retry quota, audits the draft, and continues with audio only", async t => {
  const f = await fixture(t, { maxDaily: 2 }); const original = f.seed();
  const saved = f.store.editAdmin(original.id, original.revision, f.draft);
  const path = `/${saved.id}/approve`;
  const results = await Promise.all([f.request(path, { revision: saved.revision }), f.request(path, { revision: saved.revision })]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
  const response = await results.find(r => r.status === 200).json();
  assert.equal(response.job.stage, "queued"); assert.equal(response.job.canApprove, false);
  const approved = f.store.get(saved.id);
  assert.deepEqual(approved.data.draft, original.data.draft);
  assert.deepEqual(approved.data.review, original.data.review);
  assert.equal(approved.data.story.verification, "editorial");
  assert.equal(approved.data.editorialApproval.draftHash, sha256(JSON.stringify(saved.data.editorDraft)));
  assert.equal(approved.data.editorialApproval.approvedAt, approved.updatedAt);
  let modelCalls = 0, fetches = 0, voices = 0;
  const ready = await runJob(f.store.claimNext(), { store: f.store,
    provider: { response: async () => { modelCalls++; throw new Error("Must not call model"); } },
    fetchPage: async () => { fetches++; throw new Error("Must not fetch"); },
    narrate: async story => { voices++; assert.equal(story.verification, "editorial"); return { url: "audio", durationSec: 100 }; },
  });
  assert.equal(ready.stage, "ready"); assert.equal(modelCalls, 0); assert.equal(fetches, 0); assert.equal(voices, 1);
  assert.throws(() => f.store.createOrGet({ key: "next", address: "Address 2" }), { code: "DAILY_LIMIT" });
});

test("queue and daily quota failures roll back approval and its revision", async t => {
  for (const daily of [true, false]) {
    const f = await fixture(t, { maxDaily: daily ? 1 : 10, maxActive: 1 });
    const job = f.seed(); const saved = f.store.editAdmin(job.id, job.revision, f.draft);
    const blocker = daily ? null : f.store.createOrGet({ key: "blocker", address: "Address 2" });
    const response = await f.request(`/${job.id}/approve`, { revision: saved.revision });
    assert.equal(response.status, 429);
    assert.equal((await response.json()).error.code, daily ? "DAILY_LIMIT" : "QUEUE_FULL");
    assert.deepEqual(f.store.get(job.id), saved);
    if (blocker) {
      f.store.update(blocker.id, { stage: "failed" }, blocker.revision);
      assert.equal((await f.request(`/${job.id}/approve`, { revision: saved.revision })).status, 200);
    }
  }
});

test("malformed raw findings stay readable and unsafe source URLs are removed", async t => {
  const f = await fixture(t);
  const job = f.seed({}.toString(), { evidence: { facts: [null, 42, { evidence: [null] }], sources: [null, { url: "javascript:alert(1)" }, { url: "https://user:secret@example.com" }] }, draftCandidate: { paragraphs: [null, false] }, factReview: { facts: [null] }, review: { issues: [null, {}] } });
  const response = await f.request(`/${job.id}`);
  assert.equal(response.status, 200);
  const { job: detail } = await response.json();
  assert.equal(detail.canApprove, false);
  assert.ok(detail.data.evidence.sources.every(source => source.url === null));
  assert.equal(JSON.stringify(detail).includes("secret"), false);
});

test("HTTP auth throttle covers mutation routes without modifying jobs", async t => {
  const f = await fixture(t); const job = f.seed();
  for (let i = 0; i < 20; i++) {
    assert.equal((await f.request(`/${job.id}/approve`, { revision: job.revision }, { Authorization: "Bearer invalid" })).status, 401);
  }
  assert.equal((await f.request()).status, 200);
  const response = await f.request(`/${job.id}/approve`, { revision: job.revision }, { Authorization: "Bearer invalid" });
  assert.equal(response.status, 429); assert.equal(response.headers.get("retry-after"), "60");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(f.store.get(job.id), job);
});

test("editorial audio failure and retry never call models or alter the approved text", async t => {
  const f = await fixture(t); const job = f.seed();
  const edited = f.store.editAdmin(job.id, job.revision, f.draft);
  const approved = f.store.approveAdmin(job.id, edited.revision);
  let calls = 0;
  const options = { store: f.store, provider: { response: async () => { calls++; throw new Error("Unexpected model call"); } },
    narrate: async () => { throw new Error("Private TTS failure"); } };
  const failed = await runJob(f.store.claimNext(), options);
  assert.equal(failed.stage, "failed"); assert.equal(failed.error.code, "TTS_FAILED");
  assert.deepEqual(failed.data.story, approved.data.story);
  f.store.retry(job.id, failed.revision);
  const ready = await runJob(f.store.claimNext(), { ...options, narrate: async () => ({ url: "audio", durationSec: 100 }) });
  assert.equal(ready.stage, "ready"); assert.equal(calls, 0);
  assert.deepEqual(ready.data.editorialApproval, approved.data.editorialApproval);
  assert.deepEqual(ready.data.story, approved.data.story);
});
