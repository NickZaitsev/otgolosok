import test from "node:test";
import assert from "node:assert/strict";
import { createStore } from "./store.mjs";
import { createApp } from "./server.mjs";
import { runJob } from "./pipeline.mjs";

async function fixture(t, options = {}) {
  const store = createStore(":memory:", { maxDaily: 100 });
  const app = createApp({ store, provider: {}, yandexTts: { voice: "marina" }, origin: "https://site.test", adminToken: "test-only", workerEnabled: false, ...options });
  await new Promise(done => app.server.listen(0, "127.0.0.1", done));
  t.after(async () => { await app.close(); store.close(); });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const request = (path = "", input, headers = {}) => fetch(`${base}/api/story-admin/jobs${path}`, {
    method: input === undefined ? "GET" : "POST",
    headers: { Authorization: "Bearer test-only", Origin: "https://site.test", "Content-Type": "application/json", ...headers },
    body: input === undefined ? undefined : JSON.stringify(input),
  });
  return { store, base, request };
}

test("irrelevant addresses stay hidden through updates, duplicate creation and filtered pagination", async t => {
  const { store, request } = await fixture(t, { provider: null });
  const jobs = [];
  for (let i = 0; i < 4; i++) {
    const queued = store.createOrGet({ key: String(i), address: `Москва, Кожевническая улица, ${i + 1}` });
    jobs.push(store.update(queued.id, { stage: "failed" }, queued.revision));
  }
  const ordered = (await (await request()).json()).jobs;
  const hidden = jobs.find(job => job.id === ordered[0].id);
  const input = { revision: hidden.revision, irrelevant: true };
  const response = await request(`/${hidden.id}/relevance`, input);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).job.irrelevant, true);
  assert.equal(store.createOrGet({ key: hidden.key, address: hidden.address }).irrelevant, true);
  store.update(hidden.id, { stage: "review_required" }, hidden.revision);
  const first = await (await request("?limit=2&q=КОЖЕВНИЧЕСКАЯ")).json();
  const last = await (await request("?limit=2&offset=2")).json();
  assert.equal(first.jobs.length, 2);
  assert.equal(first.hasMore, true);
  assert.equal(last.jobs.length, 1);
  assert.equal(last.hasMore, false);
  assert.equal([...first.jobs, ...last.jobs].some(job => job.id === hidden.id), false);
  const irrelevant = await (await request("?relevance=irrelevant")).json();
  assert.deepEqual(irrelevant.jobs.map(job => job.id), [hidden.id]);
  assert.equal((await request(`/${hidden.id}/relevance`, { revision: store.get(hidden.id).revision, irrelevant: false })).status, 200);
  assert.equal((await (await request()).json()).jobs.length, 4);
});

test("relevance actions validate credentials, origin, schema and revision", async t => {
  const { store, request } = await fixture(t);
  const job = store.createOrGet({ key: "one", address: "Москва, Арбат, 1" });
  const path = `/${job.id}/relevance`;
  const input = { revision: job.revision, irrelevant: true };
  assert.equal((await request(path, input, { Authorization: "Bearer wrong" })).status, 401);
  assert.equal((await request(path, input, { Origin: "https://other.test" })).status, 403);
  for (const invalid of [{ revision: 0 }, { ...input, irrelevant: "true" }, { ...input, extra: true }, { ...input, revision: -1 }]) {
    assert.equal((await request(path, invalid)).status, 400);
  }
  assert.equal((await request(path, { ...input, revision: 10 })).status, 409);
  assert.equal((await request("/00000000-0000-0000-0000-000000000000/relevance", input)).status, 404);
  assert.deepEqual(store.get(job.id), job);
});

test("failed research can be resumed from admin with a new narration service and voice", async t => {
  const { store, request } = await fixture(t);
  const queued = store.createOrGet({ key: "one", address: "Москва, Арбат, 1" });
  const failed = store.update(queued.id, { stage: "failed", attempts: 1, error: { code: "TIMEOUT" } }, queued.revision);
  const detail = (await (await request(`/${failed.id}`)).json()).job;
  assert.equal(detail.canRetry, true);
  assert.equal(detail.canRevoice, false);
  const response = await request(`/${failed.id}/retry`, { revision: failed.revision, ttsProvider: "yandex", ttsVoice: "kirill" });
  assert.equal(response.status, 200);
  const updated = store.get(failed.id);
  assert.equal(updated.stage, "queued");
  assert.equal(updated.data.ttsProvider, "yandex");
  assert.equal(updated.data.ttsVoice, "kirill");
  assert.equal((await request(`/${failed.id}/retry`, { revision: failed.revision })).status, 409);
});

test("review-required research can be fully regenerated from admin", async t => {
  const { store, request } = await fixture(t);
  const queued = store.createOrGet({ key: "regenerate", address: "Москва, Арбат, 1" });
  const reviewRequired = store.update(queued.id, { stage: "review_required", attempts: 1, error: { code: "REVIEW_REQUIRED" }, data: {
    research: { sources: [{ url: "https://example.test" }] }, evidence: { facts: [] }, draft: { title: "Старый текст", paragraphs: [] },
  } }, queued.revision);
  const detail = (await (await request(`/${reviewRequired.id}`)).json()).job;
  assert.equal(detail.canRegenerate, true);
  const response = await request(`/${reviewRequired.id}/regenerate`, { revision: reviewRequired.revision, ttsProvider: "yandex", ttsVoice: "kirill" });
  assert.equal(response.status, 200);
  const updated = store.get(reviewRequired.id);
  assert.equal(updated.stage, "queued");
  assert.equal(updated.error, null);
  assert.deepEqual(updated.data, { ttsProvider: "yandex", ttsVoice: "kirill" });
  assert.equal((await request(`/${reviewRequired.id}/regenerate`, { revision: reviewRequired.revision })).status, 409);
});

test("review-required research cannot be regenerated without a research provider", async t => {
  const { store, request } = await fixture(t, { provider: null });
  const queued = store.createOrGet({ key: "regenerate-unavailable", address: "Москва, Арбат, 1" });
  const reviewRequired = store.update(queued.id, { stage: "review_required", attempts: 1 }, queued.revision);
  const detail = (await (await request(`/${reviewRequired.id}`)).json()).job;
  assert.equal(detail.canRegenerate, false);
  assert.equal((await request(`/${reviewRequired.id}/regenerate`, { revision: reviewRequired.revision, ttsProvider: "yandex", ttsVoice: "kirill" })).status, 503);
  assert.equal(store.get(reviewRequired.id).stage, "review_required");
});

test("revoicing preserves public audio on failure and publishes the selected new recording", async t => {
  const { store, request, base } = await fixture(t);
  const queued = store.createOrGet({ key: "one", address: "Москва, Арбат, 1" });
  const story = { title: "История", paragraphs: [{ text: "word ".repeat(55), factIds: ["f1", "f2", "f3"] }, { text: "word ".repeat(55), factIds: ["f4", "f5"] }], verification: "automatic" };
  const oldAudio = { url: `/api/story-audio/${"a".repeat(64)}.mp3`, durationSec: 70, sha256: "a".repeat(64), voice: "marin" };
  const ready = store.update(queued.id, { stage: "ready", data: { story, audio: oldAudio } }, queued.revision);
  const path = `/${ready.id}/revoice`;
  const input = { revision: ready.revision, ttsProvider: "yandex", ttsVoice: "kirill" };
  assert.equal((await request(path, { ...input, ttsVoice: "marin" })).status, 400);
  assert.equal((await request(path, input)).status, 200);
  assert.equal((await request(path, input)).status, 409);
  const readPublic = async () => (await fetch(`${base}/api/story-jobs/${ready.id}`)).json();
  assert.deepEqual((await readPublic()).audio, oldAudio);
  const provider = { response: async () => assert.fail("Revoice must not repeat research") };
  const failed = await runJob(store.claimNext(), { store, provider, speechProviders: { yandex: { ttsProvider: "yandex" } }, narrate: async () => { throw new Error("Synthesis failed"); } });
  assert.equal(failed.stage, "failed");
  assert.deepEqual((await readPublic()).audio, oldAudio);
  assert.equal((await request(path, { ...input, revision: failed.revision })).status, 200);
  const newAudio = { ...oldAudio, voice: "kirill", url: `/api/story-audio/${"b".repeat(64)}.mp3`, sha256: "b".repeat(64) };
  const done = await runJob(store.claimNext(), { store, provider, speechProviders: { yandex: { ttsProvider: "yandex" } }, narrate: async (text, selected) => {
    assert.deepEqual(text, story); assert.equal(selected.voice, "kirill"); return newAudio;
  } });
  assert.equal(done.stage, "ready");
  assert.deepEqual((await readPublic()).audio, newAudio);
});

test("walk admin endpoints protect drafts and publish only completed narration without a research provider", async t => {
  const { store, base } = await fixture(t, { provider: null });
  const call = (path, input, extraHeaders = {}) => fetch(`${base}/api/story-admin/walks${path}`, {
    method: input === undefined ? "GET" : "POST",
    headers: { Authorization: "Bearer test-only", Origin: "https://site.test", "Content-Type": "application/json", ...extraHeaders },
    body: input === undefined ? undefined : JSON.stringify(input),
  });
  assert.equal((await call("", undefined, { Authorization: "Bearer wrong" })).status, 401);
  const list = await (await call("")).json();
  assert.ok(list.walks.length > 0);
  const id = list.walks[0].id;
  const publicUrl = `${base}/api/story-walks/${id}`;
  const initial = await (await fetch(publicUrl)).json();
  const detail = (await (await call(`/${id}`)).json()).walk;
  assert.ok(detail.ttsProviders.find(provider => provider.id === "yandex").voices.some(voice => voice.id === "kirill"));
  const chapter = detail.chapters[0];
  const editPath = `/${id}/chapters/${chapter.id}/edit`;
  const draft = { ...chapter.draft, transition: "Новая вступительная фраза." };
  const input = { revision: chapter.revision, draft };
  assert.equal((await call(editPath, input, { Origin: "https://other.test" })).status, 403);
  assert.equal((await call(editPath, { ...input, unknown: true })).status, 400);
  const edited = await call(editPath, input);
  assert.equal(edited.status, 200);
  const saved = (await edited.json()).walk.chapters[0];
  assert.equal(saved.draft.transition, draft.transition);
  assert.deepEqual(await (await fetch(publicUrl)).json(), initial);
  assert.equal((await call(editPath, input)).status, 409);
  const revoicePath = `/${id}/chapters/${chapter.id}/revoice`;
  const selection = { revision: saved.revision, ttsProvider: "yandex", ttsVoice: "kirill" };
  assert.equal((await call(revoicePath, { ...selection, ttsVoice: "marin" })).status, 400);
  assert.equal((await call(revoicePath, selection)).status, 200);
  assert.equal((await call(revoicePath, selection)).status, 409);
  assert.deepEqual(store.listAdmin().jobs, []);
  assert.deepEqual(await (await fetch(publicUrl)).json(), initial);
  const job = store.claimNext();
  assert.equal((await fetch(`${base}/api/story-jobs/${job.id}`)).status, 404);
  assert.equal((await fetch(`${base}/api/story-admin/jobs/${job.id}`, { headers: { Authorization: "Bearer test-only" } })).status, 404);
  await runJob(job, { store, provider: {}, speechProviders: { yandex: { ttsProvider: "yandex" } }, narrate: async (story, provider) => {
    assert.equal(story.paragraphs[0].text, draft.transition);
    assert.equal(provider.voice, "kirill");
    return { url: `/api/story-audio/${"c".repeat(64)}.mp3`, sha256: "c".repeat(64), durationSec: 65, model: "speechkit-v3", voice: "kirill", provider: "yandex", synthetic: true };
  } });
  const published = await (await fetch(publicUrl)).json();
  assert.equal(published.walk.steps[0].transition, draft.transition);
  assert.equal(published.walk.steps[0].audio.voice, "kirill");
  assert.deepEqual(published.walk.path, initial.walk.path);
});

test("Yandex can revoice ready text without an OpenAI provider and leaves queued research untouched", async t => {
  const { store, request } = await fixture(t, { provider: null });
  const research = store.createOrGet({ key: "research", address: "Москва, Арбат, 1" });
  const queued = store.createOrGet({ key: "ready", address: "Москва, Арбат, 2" });
  const ready = store.update(queued.id, { stage: "ready", data: { story: {
    title: "Готовый рассказ", paragraphs: [{ text: "word ".repeat(55), factIds: [] }, { text: "word ".repeat(55), factIds: [] }],
  } } }, queued.revision);
  const detail = (await (await request(`/${ready.id}`)).json()).job;
  assert.equal(detail.canRevoice, true);
  assert.equal(detail.ttsProviders.find(option => option.id === "yandex").available, true);
  assert.equal((await request(`/${ready.id}/revoice`, { revision: ready.revision, ttsProvider: "yandex", ttsVoice: "kirill" })).status, 200);
  const claimed = store.claimNext({ audioOnly: true });
  assert.equal(claimed.id, ready.id);
  assert.deepEqual(store.get(research.id), research);
});

test("walk admin regenerates every chapter atomically with the selected voice", async t => {
  const { store, base } = await fixture(t, { provider: null });
  const call = (path, input, extraHeaders = {}) => fetch(`${base}/api/story-admin/walks${path}`, {
    method: "POST",
    headers: { Authorization: "Bearer test-only", Origin: "https://site.test", "Content-Type": "application/json", ...extraHeaders },
    body: JSON.stringify(input),
  });
  const list = await (await fetch(`${base}/api/story-admin/walks`, {
    headers: { Authorization: "Bearer test-only" },
  })).json();
  const routeId = list.walks[0].id;
  const before = (await (await fetch(`${base}/api/story-admin/walks/${routeId}`, {
    headers: { Authorization: "Bearer test-only" },
  })).json()).walk;

  assert.equal((await call(`/${routeId}/regenerate`, { ttsProvider: "yandex", ttsVoice: "kirill" }, { Origin: "https://other.test" })).status, 403);
  const response = await call(`/${routeId}/regenerate`, { ttsProvider: "yandex", ttsVoice: "kirill" });
  assert.equal(response.status, 200);
  const updated = (await response.json()).walk;
  assert.ok(updated.chapters.every(chapter => chapter.status === "queued"));
  assert.ok(updated.chapters.every(chapter => chapter.revision === 1));
  assert.equal(store.claimNext().kind, "walk_chapter");
  assert.equal((await call(`/${routeId}/regenerate`, { ttsProvider: "yandex", ttsVoice: "kirill" })).status, 409);
  assert.equal(before.chapters.length, updated.chapters.length);
});
