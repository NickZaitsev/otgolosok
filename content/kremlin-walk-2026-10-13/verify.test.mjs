import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { validateWalkDocument } from "../../backend/walk-document.mjs";

const load = (name) =>
  JSON.parse(readFileSync(new URL(`./${name}.json`, import.meta.url), "utf8"));
const hash = (value) => createHash("sha256").update(value).digest("hex");
const sourceHash = (story) =>
  hash(story.paragraphs.map(({ text }) => text).join("\n\n"));
const wordCount = (story) =>
  story.paragraphs
    .flatMap(({ text }) => text.split(/\s+/u))
    .filter((token) => /[\p{L}\p{N}]/u.test(token)).length;
const index = (entries) => {
  const result = new Map(entries.map((entry) => [entry.placeId, entry]));
  assert.equal(entries.length, 12);
  assert.equal(result.size, 12, "Повторная остановка в доказательствах");
  return result;
};
const sha256 = (value) => assert.match(value, /^[a-f0-9]{64}$/u);

test("12 рассказов сохраняют поля карточек и связаны с проверенными фактами и источниками", () => {
  const bundle = load("texts");
  index(bundle.entries);
  assert.equal(bundle.minimumStopDurationSec, 120);
  for (const entry of bundle.entries) {
    const { story } = entry;
    assert.ok(["update", "create"].includes(entry.operation));
    if (entry.operation === "update") {
      assert.equal(story.title, entry.beforeStory.title, entry.placeId);
      assert.equal(story.address, entry.beforeStory.address, entry.placeId);
      assert.ok(entry.expectedTextId);
      assert.notEqual(entry.newTextId, entry.expectedTextId);
    } else {
      assert.equal(entry.beforeStory, null);
      assert.equal(entry.expectedTextId, null);
    }
    assert.ok(wordCount(story) >= 300, entry.placeId);
    assert.equal(story.wordCount, wordCount(story));
    const sources = new Map(story.sources.map((source) => [source.id, source]));
    const facts = new Map(story.facts.map((fact) => [fact.id, fact]));
    assert.equal(sources.size, story.sources.length);
    assert.equal(facts.size, story.facts.length);
    assert.ok(sources.size >= 2 && facts.size > 0);
    const checkedUrls = new Set(
      entry.sourceChecks.map((check) => {
        assert.ok(check.note?.trim());
        return check.url;
      }),
    );
    for (const source of sources.values()) {
      assert.match(source.url, /^https:\/\//u);
      assert.ok(checkedUrls.has(source.url), `${entry.placeId}: ${source.url}`);
    }
    for (const fact of facts.values()) {
      assert.ok(fact.claim.trim() && fact.sourceIds.length > 0);
      for (const id of fact.sourceIds) assert.ok(sources.has(id), id);
    }
    for (const paragraph of story.paragraphs) {
      assert.ok(paragraph.text.trim() && paragraph.factIds.length > 0);
      for (const id of paragraph.factIds) assert.ok(facts.has(id), id);
      assert.doesNotMatch(paragraph.text, /(?:по адресу|строение\s+\d)/iu);
    }
  }
});

test("каждый текущий MP3 длится минимум две минуты и совпадает с текстом, квитанцией v4 и фотографиями", () => {
  const texts = index(load("texts").entries);
  const verified = load("verification");
  const provenance = load("audio-provenance");
  const published = index(load("text-publication").results);
  const audio = index(verified.entries);
  const proofs = index(provenance.entries);
  assert.equal(verified.checked, 12);
  assert.equal(provenance.checked, 12);
  assert.deepEqual(verified.errors, []);
  assert.deepEqual(new Set(audio.keys()), new Set(texts.keys()));
  assert.deepEqual(new Set(proofs.keys()), new Set(texts.keys()));
  for (const [placeId, entry] of audio) {
    const changed = texts.get(placeId);
    const proof = proofs.get(placeId);
    assert.equal(entry.title, changed.story.title);
    assert.equal(entry.textId, published.get(placeId).textId);
    if (changed.operation === "create")
      assert.equal(entry.textId, changed.newTextId);
    else assert.notEqual(entry.textId, changed.expectedTextId);
    assert.equal(entry.wordCount, wordCount(changed.story));
    assert.equal(entry.sourceTextSha256, sourceHash(changed.story));
    assert.equal(entry.audio.provider, "elevenlabs");
    assert.equal(entry.audio.model, "eleven_v4");
    assert.equal(entry.audio.voice, "9ivxhQ6xIsHd6R3Xc635");
    sha256(entry.audio.sha256);
    assert.equal(proof.state, "succeeded");
    for (const key of ["textId", "sourceTextSha256"])
      assert.equal(proof[key], entry[key]);
    for (const key of ["provider", "model", "voice", "sha256"])
      assert.equal(proof[key], entry.audio[key]);
    sha256(proof.spokenTextSha256);
    assert.equal(proof.uploadAndReceiptMatch, true);
    assert.equal(proof.approvedSourceTextMatch, true);
    const measured = entry.files[0];
    assert.equal(measured.sha256, entry.audio.sha256);
    assert.equal(measured.bytes, entry.audio.bytes);
    assert.ok(measured.bytes > 0 && measured.durationSec >= 120, placeId);
    assert.ok(Math.abs(measured.durationSec - entry.audio.durationSec) < 0.15);
    if (changed.operation === "update") assert.ok(entry.files.length >= 2);
    else assert.equal(entry.files.length, 1);
    assert.equal(
      new Set(entry.files.map((file) => file.sha256)).size,
      entry.files.length,
    );
    assert.ok(entry.files.every((file) => file.decoded === true));
    for (const old of entry.files.slice(1)) {
      sha256(old.sha256);
      assert.notEqual(old.sha256, measured.sha256);
      assert.ok(old.bytes > 0 && old.durationSec > 0);
    }
    assert.ok(
      entry.photo.sourceUrl && entry.photo.author && entry.photo.license,
    );
    assert.equal(entry.images.length, 2);
    assert.deepEqual(
      new Set(entry.images.map(({ kind }) => kind)),
      new Set(["src", "thumbnail"]),
    );
    for (const image of entry.images)
      assert.ok(image.width > 0 && image.height > 0 && image.bytes > 0);
  }
});

test("линия и все 12 триггеров привязаны к проверке снаружи Кремля, внутри Садового кольца", () => {
  const doc = validateWalkDocument(load("walk"));
  const geometry = load("geometry-verification");
  const ids = [...index(load("texts").entries).keys()];
  assert.deepEqual(
    doc.stops.map(({ placeId }) => placeId),
    ids,
  );
  assert.equal(doc.fieldChecked, false);
  assert.equal(geometry.fieldChecked, false);
  assert.ok(doc.start && doc.destination && doc.route);
  assert.equal(geometry.stops.length, 12);
  assert.equal(geometry.stopOrderPreserved, true);
  assert.equal(geometry.routeDistanceM, doc.route.distanceM);
  assert.equal(geometry.walkingMinutes, doc.route.walkingMinutes);
  assert.equal(geometry.geometryVertices, doc.route.geometry.length);
  assert.equal(
    geometry.geometrySha256,
    hash(
      JSON.stringify(doc.route.geometry.map(({ lat, lon }) => ({ lat, lon }))),
    ),
  );
  assert.equal(geometry.routeInsideGardenRing, true);
  assert.equal(geometry.outsideGardenRingSamples, 0);
  assert.ok(
    geometry.geometrySampleStepM <= 10 && geometry.geometrySampleCount > 0,
  );
  assert.equal(geometry.kremlinBoundaryPlaceId, "osm:relation:1360641");
  sha256(geometry.kremlinBoundaryGeometrySha256);
  assert.equal(geometry.kremlinBoundaryIntrusionSamples, 0);
  assert.equal(geometry.kremlinBoundaryInteriorSegmentIntersections, 0);
  assert.equal(
    geometry.kremlinBoundarySegmentsChecked,
    doc.route.geometry.length - 1,
  );
  assert.ok(geometry.startGapM < 30 && geometry.destinationGapM < 30);
  for (const [i, stop] of doc.stops.entries()) {
    const measured = geometry.stops[i];
    assert.equal(measured.id, stop.placeId);
    assert.deepEqual(stop.storyRef, { kind: "osm", id: stop.placeId });
    assert.deepEqual(stop.triggerLocation, measured.triggerLocation);
    assert.equal(measured.triggerInsideGardenRing, true);
    assert.equal(measured.triggerInsideKremlinBoundary, false, stop.placeId);
    assert.ok(measured.triggerGapFromRouteM < 30);
    assert.ok(
      ["footway", "pedestrian"].includes(measured.listeningWayTags.highway),
    );
    if (measured.physicalGeometryType === "Polygon")
      assert.equal(measured.triggerInsidePhysicalFootprint, false);
  }
});

test("опубликованная ссылка в мобильном браузере показывает и воспроизводит все текущие главы", () => {
  const doc = load("walk");
  const audio = index(load("verification").entries);
  const publication = load("walk-publication");
  const api = load("shared-api-verification");
  const ui = load("ui-verification");
  assert.equal(publication.walks.length, 1);
  assert.equal(publication.existingWalksUnchanged, true);
  const shareUrl = new URL(publication.walks[0].shareUrl);
  assert.equal(shareUrl.origin, "https://otgolosok.online");
  assert.equal(shareUrl.pathname, "/walk");
  assert.match(shareUrl.searchParams.get("share"), /^[a-f0-9-]{36}$/u);
  assert.equal(api.readyChapters, 12);
  assert.equal(api.currentTextAndAudioMatch, true);
  assert.equal(api.documentMatches, true);
  assert.equal(ui.shareUrl, shareUrl.href);
  assert.equal(ui.touchDevice, true);
  assert.equal(ui.finishChecked, true);
  assert.deepEqual(ui.javascriptErrors, []);
  assert.equal(ui.stops.length, 12);
  for (const [i, stop] of ui.stops.entries()) {
    assert.equal(stop.placeId, doc.stops[i].placeId);
    assert.ok(
      stop.textChecked && stop.photoBannerChecked && stop.photoViewerChecked,
    );
    assert.equal(stop.audio.sha256, audio.get(stop.placeId).audio.sha256);
    assert.equal(stop.audio.pauseChecked, true);
    assert.ok(
      stop.audio.playing.some(
        ({ timeSec, paused, error }) =>
          timeSec > 1 && paused === false && error === null,
      ),
      stop.placeId,
    );
  }
});
