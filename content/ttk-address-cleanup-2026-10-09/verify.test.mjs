import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const load = (name) => JSON.parse(readFileSync(new URL(name, import.meta.url), "utf8"));
const bundle = load("./changes.json");
const selection = load("../ttk-f5-stats-2026-10-09/selection.json");
const script = (story) => story.paragraphs.map((p) => p.text).join("\n\n");
const hash = (text) => createHash("sha256").update(text).digest("hex");
const words = (story) => script(story).split(/\s+/u).filter((t) => /[\p{L}\p{N}]/u.test(t)).length;

test("Все 703 точки отнесены к изменённым, оставленным или требующим исследования", () => {
  const ids = selection.points.map((p) => p.placeId).sort();
  assert.equal(new Set(ids).size, 703);
  assert.deepEqual(bundle.baselineGuards.map((g) => g.placeId).sort(), ids);
  assert.equal(new Set(bundle.baselineGuards.map((g) => g.placeId)).size, 703);
  for (const g of bundle.baselineGuards) {
    assert.equal(g.expectedTextId, bundle.reviewed.find((e) => e.placeId === g.placeId).expectedTextId, g.placeId);
    for (const field of ["storyHash", "audioHash", "cardHash"]) assert.match(g[field], /^[a-f0-9]{64}$/u, g.placeId);
  }
  assert.deepEqual(bundle.reviewed.map((e) => e.placeId).sort(), ids);
  assert.equal(new Set(bundle.reviewed.map((e) => e.placeId)).size, 703);
  const changed = bundle.reviewed.filter((e) => e.status === "changed").map((e) => e.placeId).sort();
  assert.deepEqual(bundle.entries.map((e) => e.placeId).sort(), changed);
  for (const e of bundle.reviewed) {
    assert.ok(["changed", "unchanged", "needs_research"].includes(e.status), e.placeId);
    assert.ok(e.reason?.length, e.placeId);
    if (e.status !== "needs_research") {
      assert.ok(e.wordCount >= 100 && e.wordCount <= 500, e.placeId);
      assert.equal(e.review.approved, true, e.placeId);
      assert.deepEqual(e.review.issues, [], e.placeId);
      for (const check of ["noReferenceAddresses", "supported", "subjectAligned", "substantive", "coherent", "sourceChains"]) {
        assert.equal(e.review.checks[check], true, `${e.placeId}: ${check}`);
      }
    }
  }
});

test("Новая редакция содержит минимум 100 реальных слов и сохраняет название с адресом", () => {
  const original = new Map(selection.points.map((p) => [p.placeId, p]));
  for (const e of bundle.entries) {
    const update = bundle.baselineUpdates.find((u) => u.placeId === e.placeId);
    if (update) {
      assert.equal(update.initialTextId, original.get(e.placeId).textId, e.placeId);
      assert.equal(update.initialSourceTextSha256, original.get(e.placeId).sourceTextSha256, e.placeId);
      assert.equal(e.expectedTextId, update.currentTextId, e.placeId);
      assert.equal(hash(script(e.expectedStory)), update.currentSourceTextSha256, e.placeId);
    } else {
      assert.equal(e.expectedTextId, original.get(e.placeId).textId, e.placeId);
      assert.equal(hash(script(e.expectedStory)), original.get(e.placeId).sourceTextSha256, e.placeId);
    }
    assert.equal(e.story.title, e.expectedStory.title, e.placeId);
    assert.equal(e.story.address, e.expectedStory.address, e.placeId);
    assert.notDeepEqual(e.story, e.expectedStory, e.placeId);
    assert.ok(words(e.story) >= 100 && words(e.story) <= 500, e.placeId);
    assert.equal(e.story.wordCount, script(e.story).split(/\s+/u).filter(Boolean).length, e.placeId);
    assert.equal(e.story.verification, "editorial", e.placeId);
    assert.equal(e.story.audioDisposition, "eligible", e.placeId);
  }
});

test("Факты каждого абзаца связаны с источниками, проверка новых цитат зафиксирована без публикации исходных отрывков", () => {
  for (const e of bundle.entries) {
    const sources = new Map(e.story.sources.map((s) => [s.id, s]));
    const facts = new Map(e.story.facts.map((f) => [f.id, f]));
    const originalFacts = new Map(e.expectedStory.facts.map((f) => [f.id, f]));
    assert.equal(sources.size, e.story.sources.length, e.placeId);
    assert.equal(facts.size, e.story.facts.length, e.placeId);
    for (const p of e.story.paragraphs) {
      assert.ok(p.factIds.length > 0, e.placeId);
      for (const id of p.factIds) assert.ok(facts.has(id), `${e.placeId}: ${id}`);
    }
    for (const f of facts.values()) {
      assert.equal(f.evidence, undefined, `${e.placeId}: исходная цитата опубликована`);
      assert.ok(f.sourceIds.length > 0, `${e.placeId}: ${f.id}`);
      for (const id of f.sourceIds) assert.ok(sources.has(id), `${e.placeId}: ${id}`);
      if (JSON.stringify(originalFacts.get(f.id)) === JSON.stringify(f)) continue;
      for (const id of f.sourceIds) {
        const proof = e.sourceProofs.find((p) => p.factId === f.id && p.sourceId === id);
        assert.ok(proof, `${e.placeId}: ${f.id}/${id}`);
        assert.equal(proof.url, sources.get(id).url, e.placeId);
        assert.match(proof.sourceTextSha256, /^[a-f0-9]{64}$/u, e.placeId);
        assert.match(proof.quoteSha256, /^[a-f0-9]{64}$/u, e.placeId);
        assert.equal(proof.quoteMatchesSource, true, `${e.placeId}: ${f.id}/${id}`);
      }
    }
  }
});

test("Публичные карточки соответствуют партии, старые MP3 доступны, конфликты не скрыты", () => {
  const receipt = load("./publication-receipt.json");
  const verification = load("./verification.json");
  assert.deepEqual(verification.errors, []);
  assert.equal(verification.checked, 703);
  assert.equal(new Set(verification.entries.map((e) => e.placeId)).size, 703);
  assert.deepEqual(receipt.conflicts, []);
  assert.deepEqual(receipt.results.map((r) => r.placeId).sort(), bundle.entries.map((e) => e.placeId).sort());
  const actual = new Map(verification.entries.map((e) => [e.placeId, e]));
  const expected = new Map(bundle.reviewed.map((e) => [e.placeId, e]));
  for (const [id, e] of expected) {
    assert.equal(actual.get(id).sourceTextSha256, e.sourceTextSha256, id);
    assert.equal(actual.get(id).wordCount, e.wordCount, id);
    assert.equal(actual.get(id).cardFieldsMatch, true, id);
    assert.equal(actual.get(id).previousAudioAvailable, true, id);
  }
  for (const r of receipt.results) {
    assert.equal(r.photoPreserved, true, r.placeId);
    assert.equal(actual.get(r.placeId).textId, r.textId, r.placeId);
    assert.equal(actual.get(r.placeId).sourceTextSha256, r.sourceTextSha256, r.placeId);
  }
});

test("Серверные SHA-256 и размеры исходных и выбранных MP3 совпадают с сохранёнными артефактами", () => {
  const integrity = load("./server-audio-verification.json");
  const verification = load("./verification.json");
  assert.deepEqual(integrity.errors, []);
  assert.equal(integrity.checked, integrity.entries.length);
  const files = new Map(integrity.entries.map((e) => [e.sha256, e]));
  assert.equal(files.size, integrity.entries.length);
  for (const p of selection.points) {
    const file = files.get(p.audioSha256);
    assert.ok(file, p.placeId);
    assert.equal(file.actualSha256, p.audioSha256, p.placeId);
    assert.equal(file.actualBytes, p.audioBytes, p.placeId);
  }
  for (const p of verification.entries) {
    const file = files.get(p.audio.sha256);
    assert.ok(file, p.placeId);
    assert.equal(file.actualSha256, p.audio.sha256, p.placeId);
    assert.equal(file.actualBytes, p.audio.bytes, p.placeId);
  }
});
