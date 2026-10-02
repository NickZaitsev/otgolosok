import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { candidateMatches, createWikimapiaClient, sourceRecord } from "./wikimapia-pilot.mjs";

const place = { name: "И. Д. Кобзону", lat: 55.773518, lon: 37.6080415 };
const raw = (id = 1, title = "Памятник И. Д. Кобзону", extra = {}) => ({ id, title, location: { lat: place.lat, lon: place.lon }, ...extra });
const response = data => new Response(JSON.stringify(data), { headers: { "content-type": "application/json" } });

test("source records retain source text and canonical link, excluding unrelated personal and media data", () => {
  const record = sourceRecord(raw(123, "Памятник", { description: "Открыт в 2022 году.", photos: [{ user_ip: "private" }], comments: ["private"], tags: [{ title: "monument" }] }));
  assert.deepEqual(record, { id: 123, title: "Памятник", description: "Открыт в 2022 году.", url: "https://wikimapia.org/123/ru",
    location: { lat: place.lat, lon: place.lon }, deleted: false, categories: ["monument"] });
});

test("candidate shortlist keeps ambiguity but rejects far, unrelated and deleted objects", () => {
  const records = [raw(1), raw(2, "Памятник Иосифу Кобзону"), raw(3, "Бюст Менделеева"),
    raw(4, "Памятник Кобзону", { location: { lat: 56, lon: 37 } }), raw(5, "Кобзону", { is_deleted: true })].map(sourceRecord);
  assert.deepEqual(candidateMatches(place, records).map(item => item.id), [1, 2]);
  assert.equal(candidateMatches({ ...place, name: "Памятник" }, records).length, 0);
  assert.equal(candidateMatches({ ...place, name: "Кобзон" }, records).length, 2);
});

test("invalid coordinates and names fail instead of producing arbitrary matches", () => {
  for (const location of [{ lat: null, lon: 37 }, { lat: "55", lon: 37 }, { lat: 91, lon: 37 }, { lat: NaN, lon: 37 }, { lat: 55, lon: 181 }]) {
    assert.throws(() => candidateMatches({ name: "Кобзон", ...location }, []), /WIKIMAPIA_INVALID_INPUT/);
    assert.throws(() => sourceRecord(raw(1, "Кобзон", { location })), /WIKIMAPIA_INVALID_PLACE/);
  }
  assert.throws(() => sourceRecord(raw(0)), /WIKIMAPIA_INVALID_PLACE/);
});

function harness(replies, options = {}) {
  let clock = 0;
  const starts = [], requests = [];
  const client = createWikimapiaClient({ example: true, now: () => clock, wait: async ms => { clock += ms; },
    fetchImpl: async url => {
      starts.push(clock); requests.push(new URL(url));
      const reply = replies.shift();
      if (reply instanceof Error) throw reply;
      return reply;
    }, ...options });
  return { client, starts, requests };
}

test("nearest and detail serialize concurrent requests and obey test-key pacing", async () => {
  const { client, starts, requests } = harness([response({ places: [raw()] }), response(raw(2))]);
  const [nearest, detail] = await Promise.all([client.nearest(place), client.detail(2)]);
  assert.equal(nearest[0].id, 1);
  assert.equal(detail.id, 2);
  assert.ok(starts[1] - starts[0] >= 31000);
  assert.equal(requests[0].searchParams.get("language"), "ru");
  assert.equal(requests[0].searchParams.get("count"), "50");
  assert.equal(requests[1].searchParams.get("data_blocks"), "main,location");
});

test("nearest accepts an empty result and rejects malformed responses and wrong detail IDs", async () => {
  const { client } = harness([response({ places: [] }), response([]), response(raw(3))]);
  assert.deepEqual(await client.nearest(place), []);
  await assert.rejects(client.nearest(place), /WIKIMAPIA_INVALID_RESPONSE/);
  await assert.rejects(client.detail(2), /WIKIMAPIA_ID_MISMATCH/);
});

test("transient HTTP, timeout and network errors retry; deterministic errors and API debug fail immediately", async () => {
  for (const error of [new Response("busy", { status: 429, headers: { "retry-after": "40" } }), new Response("busy", { status: 503 }),
    Object.assign(new Error("timeout"), { name: "TimeoutError" }), new TypeError("fetch failed")]) {
    const { client, starts } = harness([error, response({ places: [] })]);
    assert.deepEqual(await client.nearest(place), []);
    assert.equal(starts.length, 2);
    assert.ok(starts[1] - starts[0] >= 31000);
  }
  for (const [bad, code] of [[new Response("bad", { status: 403 }), "WIKIMAPIA_HTTP_403"],
    [response({ debug: { code: 1901, message: "private-api-key" } }), "WIKIMAPIA_API_1901"]]) {
    const { client, starts } = harness([bad]);
    await assert.rejects(client.nearest(place), error => error instanceof Error && error.message === code && !JSON.stringify(error).includes("private-api-key"));
    assert.equal(starts.length, 1);
  }
});

test("retry exhaustion is bounded, transport errors do not leak credentials, key is explicit", async () => {
  assert.throws(() => createWikimapiaClient(), /WIKIMAPIA_KEY_REQUIRED/);
  const replies = Array.from({ length: 3 }, () => Object.assign(new Error("URL contains private-api-key"), { code: "ECONNRESET" }));
  const { client, starts } = harness(replies, { apiKey: "private-api-key" });
  await assert.rejects(client.nearest(place), error => error instanceof Error && error.message === "WIKIMAPIA_TRANSPORT_ERROR"
    && !JSON.stringify(error).includes("private-api-key") && error.cause === undefined);
  assert.equal(starts.length, 3);
});

test("CLI resumes entirely from cached sources and reports a reviewed-candidate workload without publishing", async () => {
  const directory = await mkdtemp(join(tmpdir(), "wikimapia-pilot-"));
  try {
    const inputPlace = { id: "osm:node:123", ...place };
    const input = join(directory, "sample.json");
    await writeFile(input, JSON.stringify({ places: [inputPlace] }));
    const hash = createHash("sha256").update(JSON.stringify([inputPlace.id, place.lat, place.lon, "nearest-v1"])).digest("hex");
    const cache = join(directory, `nearest-${hash}.json`);
    await writeFile(cache, JSON.stringify({ data: [sourceRecord(raw())] }));
    await writeFile(join(directory, "detail-1.json"), JSON.stringify({ data: sourceRecord(raw(1, "Памятник И. Д. Кобзону", { description: "Открыт в 2022 году." })) }));
    const run = () => spawnSync(process.execPath, [resolve("scripts/probe-wikimapia.mjs"), input, directory, "--example"],
      { encoding: "utf8", timeout: 3000, env: { ...process.env, WIKIMAPIA_API_KEY: "" } });
    const result = run();
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(await readFile(join(directory, "report.json"), "utf8"));
    assert.equal(report.complete, true);
    assert.equal(report.results[0].status, "needs_review");
    assert.equal(report.results[0].candidates[0].description, "Открыт в 2022 году.");
    await writeFile(cache, "{broken");
    const failed = run();
    assert.equal(failed.status, 1);
    assert.match(failed.stderr, /Пилот остановлен/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
