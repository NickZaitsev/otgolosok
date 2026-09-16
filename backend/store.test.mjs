import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createStore } from "./store.mjs";

function fixture(t, options = {}) {
  const directory = mkdtempSync(join(tmpdir(), "story-store-"));
  const databasePath = join(directory, "queue.sqlite");
  const store = createStore(databasePath, options);
  const connections = [store];

  t.after(() => {
    try {
      for (const connection of connections) connection.close();
    } catch {
      // It may already have been closed for a reopening test.
    }
    rmSync(directory, { recursive: true, force: true });
  }, { order: "after" });

  return { databasePath, store, track: connection => (connections.push(connection), connection) };
}

test("deduplicates by key across reopening", (t) => {
  const { databasePath, store, track } = fixture(t);
  const first = store.createOrGet({
    key: "normalized-address",
    address: "Москва, Тверская 1",
  });

  store.close();
  const reopened = track(createStore(databasePath));

  const second = reopened.createOrGet({
    key: "normalized-address",
    address: "Другой адрес не должен менять запись",
  });

  assert.equal(second.id, first.id);
  assert.equal(second.address, "Москва, Тверская 1");
});

test("enforces quotas but lets cache hits bypass them", (t) => {
  const { store } = fixture(t, { maxActive: 1, maxDaily: 1 });
  const first = store.createOrGet({ key: "one", address: "Адрес 1" });

  assert.equal(
    store.createOrGet({ key: "one", address: "Изменённый адрес" }).id,
    first.id,
  );

  assert.throws(
    () => store.createOrGet({ key: "two", address: "Адрес 2" }),
    (error) => error.code === "QUEUE_FULL",
  );
});

test("uses optimistic revision checks and replaces data", (t) => {
  const { store } = fixture(t);
  const created = store.createOrGet({ key: "cas", address: "Адрес" });

  const updated = store.update(
    created.id,
    { stage: "researching", data: { checkpoint: "search" }, attempts: 2 },
    0,
  );

  assert.equal(updated.revision, 1);
  assert.deepEqual(updated.data, { checkpoint: "search" });
  assert.equal(updated.attempts, 2);
  assert.equal(updated.key, created.key);

  assert.throws(
    () => store.update(created.id, { data: { stale: true } }, 0),
    (error) => error.code === "CONFLICT",
  );
});

test("claims oldest queued job and allows only one worker", (t) => {
  let tick = Date.UTC(2025, 0, 1, 10, 0, 0);
  const { store } = fixture(t, {
    maxActive: 5,
    now: () => tick,
  });

  const first = store.createOrGet({ key: "first", address: "Первый" });
  tick += 1;
  const second = store.createOrGet({ key: "second", address: "Второй" });

  const claimed = store.claimNext();
  assert.equal(claimed.id, first.id);
  assert.equal(claimed.stage, "researching");
  assert.equal(claimed.attempts, 1);
  assert.equal(store.claimNext(), null);

  store.update(first.id, { stage: "ready" }, claimed.revision);
  assert.equal(store.claimNext().id, second.id);
});

test("rejects invalid stages", (t) => {
  const { store } = fixture(t);
  const job = store.createOrGet({ key: "stage", address: "Адрес" });

  assert.throws(
    () => store.update(job.id, { stage: "invented" }, job.revision),
    /Invalid stage/,
  );
});

test("resets daily quota at the UTC date boundary", (t) => {
  let clock = Date.UTC(2025, 4, 1, 23, 59, 59);
  const { store } = fixture(t, {
    maxActive: 5,
    maxDaily: 1,
    now: () => clock,
  });

  store.createOrGet({ key: "day-one", address: "Адрес 1" });
  clock = Date.UTC(2025, 4, 2, 0, 0, 0);
  const nextDay = store.createOrGet({ key: "day-two", address: "Адрес 2" });

  assert.equal(nextDay.key, "day-two");
});

test("recovers interrupted work while preserving data", (t) => {
  const { databasePath, store, track } = fixture(t);
  const job = store.createOrGet({ key: "recovery", address: "Адрес" });
  const working = store.update(
    job.id,
    {
      stage: "writing",
      data: { researchId: "saved-checkpoint", draft: "Черновик" },
      error: null,
    },
    job.revision,
  );

  assert.equal(working.stage, "writing");
  store.close();

  const reopened = track(createStore(databasePath));

  reopened.recoverInterrupted();
  const recovered = reopened.get(job.id);
  assert.equal(recovered.stage, "failed");
  assert.equal(recovered.revision, 2);
  assert.deepEqual(recovered.data, {
    researchId: "saved-checkpoint",
    draft: "Черновик",
  });
  assert.deepEqual(recovered.error, {
    code: "INTERRUPTED",
    message: "Подготовка прервалась. Можно повторить.",
  });
});

test("returns recovery count for currently interrupted jobs", (t) => {
  const { store } = fixture(t);
  const job = store.createOrGet({ key: "manual-recovery", address: "Адрес" });

  store.update(job.id, { stage: "voicing", data: { voiceTask: "x" } }, 0);
  assert.equal(store.recoverInterrupted(), 1);
  assert.equal(store.get(job.id).stage, "failed");
  assert.equal(store.recoverInterrupted(), 0);
});

test("a second connection does not interrupt a live worker", (t) => {
  const { databasePath, store, track } = fixture(t);
  const job = store.createOrGet({key:"live",address:"Адрес"});
  store.claimNext();
  const other = track(createStore(databasePath));
  assert.equal(other.get(job.id).stage, "researching");
  assert.equal(other.claimNext(), null);
});

test("retries preserve checkpoints, deduplicate clicks and consume daily capacity", (t) => {
  const { store } = fixture(t, { maxDaily:2 });
  const job = store.createOrGet({key:"retry",address:"Адрес"});
  const working = store.claimNext();
  const failed = store.update(job.id,{stage:"failed",data:{story:{title:"Ready text"}}},working.revision);
  const retry = store.retry(job.id,failed.revision);
  assert.equal(store.retry(job.id,failed.revision).revision,retry.revision);
  assert.equal(retry.data.story.title,"Ready text");
  const resumed = store.claimNext();
  const failedAgain = store.update(job.id,{stage:"failed"},resumed.revision);
  assert.throws(() => store.retry(job.id,failedAgain.revision),error=>error.code==="DAILY_LIMIT");
  assert.throws(() => store.createOrGet({key:"new",address:"Другой"}),error=>error.code==="DAILY_LIMIT");
});
