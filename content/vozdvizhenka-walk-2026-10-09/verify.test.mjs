import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { validateWalkDocument } from "../../backend/walk-document.mjs";

const load = (path) =>
  JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
const changes = ["a", "b"].flatMap((part) => load(`./texts-${part}.json`));
const verification = load("./verification.json");
const provenance = load("./audio-provenance.json");
const coordinates = load("./routes/r05/coordinate-verification.json");
const byId = new Map(
  verification.entries.map((entry) => [entry.placeId, entry]),
);
const changedIds = new Set(changes.map((entry) => entry.placeId));
const wordCount = (story) =>
  story.paragraphs
    .flatMap((p) => p.text.split(/\s+/u))
    .filter((token) => /[\p{L}\p{N}]/u.test(token)).length;
const sourceHash = (story) =>
  createHash("sha256")
    .update(story.paragraphs.map((p) => p.text).join("\n\n"))
    .digest("hex");

// Хеши снимка до публикации защищают прежние записи и восемь переиспользованных рассказов.
const previousAudio = {
  "osm:way:252370791":
    "2f1f89d1eb48ea4bb92b0aa983016dec170a36fd40cf57645bf512b5ad16e6f9",
  "osm:node:10572977039":
    "52399d649f09c28e811af2fc7fb40b69e4416a8a605192c7ab9115cd079dd28d",
  "osm:relation:15344965":
    "3f4aa9f1f534d9db2de9a883c1a513926d04cd952a617ad425cafac0eb663181",
  "osm:way:31497220":
    "365efcbbc9ad1d2d44591d8d6dcbadc38678b889953d1c3dda9fd59fe5844c82",
  "osm:relation:5371125":
    "0a1a6c577e50548bb45740957c78d3ca94781cf3e01c69791a7789f42a302660",
};
const retainedStories = {
  "osm:relation:4168584": {
    textId: "52a09ee9-4b22-412d-a09a-b25a34eee09f",
    sourceTextSha256:
      "69a2179917aaa634c51933045c8d12909fb8b370b3ff4430e542be58d0ec28d8",
    sha256: "df0db8ac9611c4759ec2f8f413e15887b461df6e5848fd5998bcc21e699c5c35",
  },
  "osm:way:32693733": {
    textId: "feaaef09-466e-4205-a4ab-b9db90be9b75",
    sourceTextSha256:
      "412ab7c02c2ee28d1b9f90704784c17b42bd18aa01f5c3270db8ade1ecd2c522",
    sha256: "a8d65d107e76fa87490c4d0f8890050dbe37ec6029d7e3da7121a231d36eccb5",
  },
  "osm:way:52444324": {
    textId: "c27166e1-5d59-4100-b84e-79bda6319465",
    sourceTextSha256:
      "ea84684be9ab62fd9d65f17468bc1b3ba7e1161e0abc9ead185a893a8b0baa87",
    sha256: "05d6929723c3f81de69572b17593816eb07970f42f7fd08aea90a1dbdce4ba35",
  },
  "osm:way:251330231": {
    textId: "4713641b-e95e-4e15-97de-13ca5e5cc651",
    sourceTextSha256:
      "1a9f7b421bac4bbbd5dc072d9916369b48832b39aa25ecbc4b08159e60e44572",
    sha256: "f7cff2858f51286518219fe8704ee39d2a3dba132f130ff02496339320ce0008",
  },
  "osm:way:52813016": {
    textId: "8002cad4-f430-4d84-9a9c-fb6cc69e8d15",
    sourceTextSha256:
      "2cc2bf88ad5d199d478841aba4ccfdee38f1a89017826feace83546e742010f5",
    sha256: "769c6b0c378ae9ab7abc36d70df456c6526c6d679ebfb4acd0af04f5d5bc556e",
  },
  "osm:way:52813020": {
    textId: "48e55246-9fb6-48e2-8234-69d5fb921a6e",
    sourceTextSha256:
      "0a75410fde0e9b95119d598facb3045c020b6c8514fb6409b6a0d72fa56837a9",
    sha256: "e31bd8cb54976830c592ed88caa2c205c1434acbef51abef68e8f6463c26d1bd",
  },
  "osm:relation:5371134": {
    textId: "7d231e77-bc8d-4f94-b6ef-c1e291e97d2e",
    sourceTextSha256:
      "830bca3aa9ac33856a378f8d8320e52745f402b067c95084ba98a4ed8024a951",
    sha256: "3b6e15cac49e23c5c8566265f00489f775c7841d5375118817e0978f961e41ce",
  },
  "osm:way:35814561": {
    textId: "3aec3d91-28ef-49d7-a165-d192b9c047f6",
    sourceTextSha256:
      "ce26f5d77754148f5ec7715110831dadfd3843ae5b23b9b88f4cc8688211c109",
    sha256: "36b565550c88405d8fd80094228482fec44c41cded3df386c1200372c28b869e",
  },
};

test("пять дополненных рассказов сохраняют название и адрес, содержат минимум 100 слов и связанные источники", () => {
  assert.equal(changes.length, 5);
  assert.equal(changedIds.size, 5);
  assert.deepEqual(changedIds, new Set(Object.keys(previousAudio)));
  for (const entry of changes) {
    assert.equal(entry.operation, "update");
    assert.equal(entry.story.title, entry.beforeStory.title);
    assert.equal(entry.story.address, entry.beforeStory.address);
    assert.ok(wordCount(entry.story) >= 100, entry.placeId);
    assert.equal(entry.story.wordCount, wordCount(entry.story));
    const published = byId.get(entry.placeId);
    assert.equal(published.wordCount, wordCount(entry.story));
    assert.equal(published.sourceTextSha256, sourceHash(entry.story));
    assert.notEqual(published.textId, entry.expectedTextId);
    const sources = new Set(entry.story.sources.map((source) => source.id));
    const facts = new Set(entry.story.facts.map((fact) => fact.id));
    assert.equal(sources.size, entry.story.sources.length);
    assert.equal(facts.size, entry.story.facts.length);
    assert.ok(entry.sourceChecks.length > 0);
    for (const fact of entry.story.facts) {
      assert.ok(fact.sourceIds.length > 0);
      for (const id of fact.sourceIds)
        assert.ok(sources.has(id), `${entry.placeId}: ${id}`);
    }
    for (const paragraph of entry.story.paragraphs) {
      assert.ok(paragraph.factIds.length > 0);
      for (const id of paragraph.factIds)
        assert.ok(facts.has(id), `${entry.placeId}: ${id}`);
      assert.doesNotMatch(
        paragraph.text,
        /(?:по адресу|расположен[аоы]? по|строение\s+\d)/iu,
      );
    }
  }
});

test("13 публичных точек имеют превью и проверенный звук; пять старых MP3 и восемь готовых рассказов сохранены", () => {
  assert.equal(verification.checked, 13);
  assert.equal(verification.entries.length, 13);
  assert.deepEqual(verification.errors, []);
  assert.equal(provenance.checked, 13);
  assert.equal(provenance.entries.length, 13);
  assert.equal(
    new Set(provenance.entries.map((entry) => entry.placeId)).size,
    13,
  );
  assert.equal(byId.size, 13);
  assert.equal(coordinates.stops.length, 13);
  assert.deepEqual(
    new Set(coordinates.stops.map((entry) => entry.placeId)),
    new Set(byId.keys()),
  );
  const proofs = new Map(
    provenance.entries.map((entry) => [entry.placeId, entry]),
  );
  for (const entry of verification.entries) {
    const coordinate = coordinates.stops.find(
      (stop) => stop.placeId === entry.placeId,
    );
    assert.equal(entry.title, coordinate.title);
    assert.ok(entry.wordCount >= 100, entry.placeId);
    assert.equal(entry.changed, changedIds.has(entry.placeId));
    assert.equal(entry.audio.provider, "elevenlabs");
    assert.equal(entry.audio.voice, "9ivxhQ6xIsHd6R3Xc635");
    assert.equal(
      entry.audio.model,
      entry.placeId === "osm:way:35814561" ? "eleven_v3" : "eleven_v4",
    );
    assert.equal(entry.images.length, 2);
    assert.deepEqual(
      new Set(entry.images.map((image) => image.kind)),
      new Set(["src", "thumbnail"]),
    );
    for (const image of entry.images)
      assert.ok(image.width > 0 && image.height > 0 && image.bytes > 0);
    assert.ok(
      entry.photo.sourceUrl && entry.photo.author && entry.photo.license,
    );
    const proof = proofs.get(entry.placeId);
    assert.equal(proof.state, "succeeded");
    assert.equal(proof.textId, entry.textId);
    assert.equal(proof.sourceTextSha256, entry.sourceTextSha256);
    assert.equal(proof.sha256, entry.audio.sha256);
    assert.equal(proof.provider, entry.audio.provider);
    assert.equal(proof.model, entry.audio.model);
    assert.equal(proof.voice, entry.audio.voice);
    assert.equal(proof.uploadAndReceiptMatch, true);
    assert.equal(proof.approvedSourceTextMatch, true);
    assert.equal(entry.files[0].sha256, entry.audio.sha256);
    assert.equal(entry.files[0].bytes, entry.audio.bytes);
    assert.ok(entry.files[0].durationSec > 0);
    assert.ok(
      Math.abs(entry.files[0].durationSec - entry.audio.durationSec) < 0.15,
    );
    assert.equal(entry.files.length, entry.changed ? 2 : 1);
    if (entry.changed) {
      assert.notEqual(entry.audio.sha256, previousAudio[entry.placeId]);
      assert.equal(entry.files[1].sha256, previousAudio[entry.placeId]);
      assert.ok(entry.files[1].bytes > 0 && entry.files[1].durationSec > 0);
    } else {
      const retained = retainedStories[entry.placeId];
      assert.equal(entry.textId, retained.textId);
      assert.equal(entry.sourceTextSha256, retained.sourceTextSha256);
      assert.equal(entry.audio.sha256, retained.sha256);
    }
  }
  assert.equal(
    verification.entries.reduce((sum, entry) => sum + entry.files.length, 0),
    18,
  );
  assert.equal(
    verification.entries.filter((entry) => entry.audio.model === "eleven_v3")
      .length,
    1,
  );
});

test("маршрут сохраняет 13 физических объектов, метро, линию внутри кольца и минимум 15 минут фактического звука", () => {
  const doc = validateWalkDocument(load("./routes/r05/walk.json"));
  const geometry = load("./routes/r05/geometry-verification.json");
  const audio = load("./routes/r05/audio-verification.json");
  const overlaps = load("./routes/r05/overlap.json");
  assert.equal(doc.stops.length, 13);
  assert.equal(new Set(doc.stops.map((stop) => stop.placeId)).size, 13);
  assert.deepEqual(
    new Set(doc.stops.map((stop) => stop.placeId)),
    new Set(byId.keys()),
  );
  assert.ok(
    doc.start.address.includes("Библиотека имени Ленина") &&
      doc.start.address.includes("выход 6"),
  );
  assert.ok(
    doc.destination.address.includes("Арбатская") &&
      doc.destination.address.includes("Филёвской") &&
      doc.destination.address.includes("выход 1"),
  );
  assert.equal(doc.fieldChecked, false);
  assert.equal(geometry.fieldChecked, false);
  assert.equal(geometry.outsideBoundarySampleCount, 0);
  assert.ok(geometry.startInsideBoundary && geometry.destinationInsideBoundary);
  assert.ok(
    geometry.boundarySampleStepM <= 10 && geometry.boundarySamplesChecked > 0,
  );
  assert.equal(geometry.distanceM, doc.route.distanceM);
  assert.equal(geometry.walkingMinutes, doc.route.walkingMinutes);
  assert.equal(geometry.geometryVertices, doc.route.geometry.length);
  const canonicalGeometry = doc.route.geometry.map(({ lat, lon }) => ({
    lat,
    lon,
  }));
  assert.equal(
    geometry.routeGeometrySha256,
    createHash("sha256")
      .update(JSON.stringify(canonicalGeometry))
      .digest("hex"),
  );
  assert.equal(geometry.stops.length, 13);
  for (const [index, stop] of doc.stops.entries()) {
    const original = coordinates.stops[index];
    const measured = geometry.stops[index];
    assert.equal(stop.placeId, original.placeId);
    assert.deepEqual(stop.place.location, original.location);
    assert.equal(stop.place.address, original.storyAddressPreserved);
    assert.deepEqual(stop.triggerLocation, original.triggerLocation);
    assert.deepEqual(stop.storyRef, { kind: "osm", id: stop.placeId });
    assert.equal(measured.placeId, stop.placeId);
    assert.ok(measured.triggerInsideBoundary && measured.centerInsideBoundary);
    assert.ok(measured.triggerGapFromRouteM < 30);
    assert.equal(measured.footprintOutsideBoundarySampleCount, 0);
    assert.ok(
      measured.footprintSampleStepM <= 10 &&
        measured.footprintBoundarySamplesChecked > 0,
    );
  }
  assert.equal(audio.items.length, 13);
  assert.deepEqual(
    audio.items.map((item) => item.placeId),
    doc.stops.map((stop) => stop.placeId),
  );
  const measuredDuration = doc.stops.reduce(
    (sum, stop) => sum + byId.get(stop.placeId).files[0].durationSec,
    0,
  );
  assert.ok(measuredDuration >= 900);
  assert.ok(Math.abs(audio.measuredDurationSec - measuredDuration) < 0.01);
  assert.equal(audio.complete, true);
  assert.equal(audio.mp3Decoded, true);
  assert.equal(audio.providerModelVoiceAndSourceVerified, true);
  for (const item of audio.items) {
    const entry = byId.get(item.placeId);
    assert.equal(item.textId, entry.textId);
    assert.equal(item.wordCount, entry.wordCount);
    assert.equal(item.sha256, entry.audio.sha256);
    assert.deepEqual(item.audio, entry.audio);
    assert.ok(Math.abs(item.durationSec - entry.files[0].durationSec) < 0.01);
  }
  assert.ok(
    overlaps.maxExistingPercent <= 50 && overlaps.maxPlannedPercent <= 50,
  );
  assert.ok(
    overlaps.existingWalksChecked > 0 && overlaps.plannedWalksChecked > 0,
  );
  assert.deepEqual(overlaps.unresolvedNearby, []);
});

test("общая ссылка и мобильный браузер воспроизводят все 13 текущих глав с фотографиями и завершением у метро", () => {
  const doc = load("./routes/r05/walk.json");
  const ui = load("./routes/r05/ui-verification.json");
  const api = load("./shared-api-verification.json");
  assert.equal(api.pointsChecked.length, 13);
  assert.deepEqual(new Set(api.pointsChecked), new Set(byId.keys()));
  assert.equal(api.walks.length, 1);
  const walk = api.walks[0];
  assert.equal(walk.routeId, "r05");
  assert.equal(walk.readyChapters, 13);
  assert.equal(walk.currentTextAndAudioMatch, true);
  assert.equal(walk.documentAndDestinationUnchanged, true);
  const shareUrl = new URL(walk.shareUrl);
  assert.equal(shareUrl.origin, "https://otgolosok.online");
  assert.equal(shareUrl.pathname, "/walk");
  assert.match(
    shareUrl.searchParams.get("share"),
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u,
  );
  assert.equal(ui.shareUrl, walk.shareUrl);
  assert.equal(ui.touchDevice, true);
  assert.equal(ui.stops.length, 13);
  assert.equal(ui.finishChecked, true);
  assert.deepEqual(ui.javascriptErrors, []);
  for (const [index, stop] of ui.stops.entries()) {
    assert.equal(stop.placeId, doc.stops[index].placeId);
    assert.ok(
      stop.textChecked && stop.photoBannerChecked && stop.photoViewerChecked,
    );
    assert.equal(stop.audio.sha256, byId.get(stop.placeId).audio.sha256);
    assert.equal(stop.audio.pauseChecked, true);
    assert.ok(
      stop.audio.playing.some(
        (sample) =>
          sample.timeSec > 1 && !sample.paused && sample.error === null,
      ),
    );
  }
});
