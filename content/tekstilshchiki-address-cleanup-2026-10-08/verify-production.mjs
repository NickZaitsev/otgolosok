// node verify-production.mjs > verification.json
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const bundle = JSON.parse(readFileSync(new URL("./changes.json", import.meta.url), "utf8"));
const origin = "https://otgolosok.online";

async function curl(path) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const result = spawnSync("curl", ["--http2", "-fsS", "--connect-timeout", "8", "--max-time", "30", `${origin}${path}`],
      { encoding: null, maxBuffer: 8 * 1024 * 1024 });
    if (!result.error && result.status === 0) return result.stdout;
    lastError = result.error ?? new Error(`curl ${path}: ${result.status}; ${result.stderr?.toString("utf8").trim()}`);
    if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt));
  }
  throw lastError;
}

function inspectMp3(bytes, expected) {
  assert.equal(bytes.byteLength, expected.bytes);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  assert.equal(sha256, expected.sha256);
  const directory = mkdtempSync(join(tmpdir(), "otgolosok-audio-verify-"));
  let durationSec;
  try {
    const file = join(directory, "story.mp3");
    writeFileSync(file, bytes);
    const probe = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", file],
      { encoding: "utf8", maxBuffer: 1024 * 1024 });
    assert.equal(probe.status, 0, probe.stderr || probe.error?.message);
    durationSec = Number(probe.stdout.trim());
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
  assert.ok(Number.isFinite(durationSec) && durationSec > 1);
  assert.ok(Math.abs(durationSec - expected.durationSec) < 0.2, `${durationSec} vs ${expected.durationSec}`);
  return { sha256, bytes: bytes.byteLength, durationSec };
}

const results = [];
for (const entry of bundle.entries) {
  const place = JSON.parse((await curl(`/api/content/places/${entry.placeId}`)).toString("utf8")).place;
  assert.equal(place.id, entry.placeId);
  assert.equal(place.contentHash, entry.expected.placeContentHash);
  assert.equal(place.address, entry.expected.address);
  assert.deepEqual(place.location, entry.expected.location);
  assert.deepEqual(place.text.story, entry.story);
  if (entry.status === "unchanged") {
    assert.equal(place.text.id, entry.expected.textId);
    assert.equal(place.text.audio.sha256, entry.expected.audio.sha256);
  } else {
    assert.notEqual(place.text.id, entry.expected.textId);
    assert.equal(place.text.audio.provider, "external");
    assert.equal(place.text.audio.model, "f5");
    assert.equal(place.text.audio.voice, "obrazec6");
    assert.notEqual(place.text.audio.sha256, entry.expected.audio.sha256, `Запись ещё не заменена: ${entry.placeId}`);
  }
  const current = inspectMp3(await curl(place.text.audio.url), place.text.audio);
  const previous = entry.status === "changed"
    ? inspectMp3(await curl(entry.expected.audio.url), entry.expected.audio) : null;
  results.push({ placeId: entry.placeId, status: entry.status, textId: place.text.id, wordCount: place.text.story.wordCount,
    address: place.address, location: place.location, audio: { ...current, provider: place.text.audio.provider,
      model: place.text.audio.model, voice: place.text.audio.voice }, previousAudio: previous });
}
console.log(JSON.stringify({ verifiedAt: new Date().toISOString(), bundleId: bundle.id, results }, null, 2));
