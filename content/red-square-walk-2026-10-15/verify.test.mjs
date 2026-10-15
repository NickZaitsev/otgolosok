import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import test from "node:test";
import { validateWalkDocument } from "../../backend/walk-document.mjs";
const load = (n) =>
  JSON.parse(readFileSync(new URL(`./${n}.json`, import.meta.url)));
const hash = (s) => createHash("sha256").update(s).digest("hex");
test("10 разных остановок с источниками и точными текстами", () => {
  const b = load("texts");
  assert.equal(b.entries.length, 10);
  assert.equal(new Set(b.entries.map((e) => e.placeId)).size, 10);
  for (const e of b.entries) {
    const s = e.story;
    assert(s.wordCount >= 300);
    assert.equal(
      s.wordCount,
      s.paragraphs
        .flatMap((p) => p.text.split(/\s+/u))
        .filter((w) => /[\p{L}\p{N}]/u.test(w)).length,
    );
    assert(s.sources.length >= 2);
    for (const p of s.paragraphs) {
      assert(p.factIds.length);
      assert.doesNotMatch(p.text, /(?<![\p{L}])[А-ЯЁ]\.\s*[А-ЯЁ]/u);
      for (const id of p.factIds) assert(s.facts.some((f) => f.id === id));
    }
    for (const f of s.facts)
      for (const id of f.sourceIds) assert(s.sources.some((x) => x.id === id));
  }
});
test("готовый звук v4 от 120 секунд совпадает с текстом и квитанцией", () => {
  const b = load("texts"),
    v = load("verification"),
    p = load("audio-provenance");
  assert.equal(v.checked, 10);
  assert.deepEqual(v.errors, []);
  assert.equal(p.checked, 10);
  for (const e of b.entries) {
    const a = v.entries.find((x) => x.placeId === e.placeId),
      proof = p.entries.find((x) => x.placeId === e.placeId);
    assert.equal(
      a.sourceTextSha256,
      hash(e.story.paragraphs.map((p) => p.text).join("\n\n")),
    );
    assert.equal(proof.sourceTextSha256, a.sourceTextSha256);
    assert.equal(proof.sha256, a.audio.sha256);
    assert.equal(a.audio.provider, "elevenlabs");
    assert.equal(a.audio.model, "eleven_v4");
    assert.equal(a.audio.voice, "9ivxhQ6xIsHd6R3Xc635");
    assert(a.files[0].durationSec >= 120);
    assert(a.files.every((f) => f.decoded));
    assert.equal(a.files.length, e.operation === "update" ? 2 : 1);
    assert.equal(a.images.length, 2);
    assert(proof.uploadAndReceiptMatch && proof.approvedSourceTextMatch);
  }
});
test("маршрут снаружи Кремля внутри Садового и все главы доступны в браузере", () => {
  const d = validateWalkDocument(load("walk")),
    g = load("geometry-verification"),
    api = load("shared-api-verification"),
    ui = load("ui-verification");
  assert.equal(d.stops.length, 10);
  assert.equal(d.fieldChecked, false);
  assert(g.routeInsideGardenRing && g.routeOutsideKremlin);
  assert.equal(g.kremlinBoundarySegmentsChecked, d.route.geometry.length - 1);
  assert.equal(api.readyChapters, 10);
  assert.equal(ui.stops.length, 10);
  assert.deepEqual(ui.javascriptErrors, []);
  assert(ui.finishChecked);
  for (const [i, s] of d.stops.entries()) {
    assert.equal(s.placeId, g.stops[i].id);
    assert(g.stops[i].triggerGapFromRouteM < 30);
    assert.equal(g.stops[i].triggerInsideKremlinBoundary, false);
    assert.equal(ui.stops[i].placeId, s.placeId);
    assert(
      ui.stops[i].audio.playing.every(
        (a) => a.durationSec >= 120 && a.playbackRate === 1,
      ),
    );
  }
});
