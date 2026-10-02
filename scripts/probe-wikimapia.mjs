#!/usr/bin/env node
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { candidateMatches, createWikimapiaClient, validLocation } from "../backend/wikimapia-pilot.mjs";

async function main() {
  const args = process.argv.slice(2), example = args.includes("--example"), positional = args.filter(arg => arg !== "--example");
  if (positional.length !== 2 || positional.some(arg => arg.startsWith("--"))) throw new Error("Использование: node scripts/probe-wikimapia.mjs <sample.json> <каталог результатов> [--example]");
  const input = JSON.parse(await readFile(resolve(positional[0]), "utf8"));
  if (!Array.isArray(input.places) || input.places.length < 1 || input.places.length > 50
    || input.places.some(place => !validLocation(place) || typeof place.id !== "string" || typeof place.name !== "string")
    || new Set(input.places.map(place => place.id)).size !== input.places.length) throw new Error("Некорректная выборка: требуется 1–50 уникальных точек с названиями и координатами");
  const output = resolve(positional[1]);
  await mkdir(output, { recursive: true });
  const client = createWikimapiaClient({ apiKey: process.env.WIKIMAPIA_API_KEY, example });
  const save = async (name, data) => {
    const path = join(output, name), temp = `${path}.${process.pid}.tmp`;
    await writeFile(temp, JSON.stringify(data, null, 2) + "\n");
    await rename(temp, path);
  };
  const cached = async (name, fetchData) => {
    try { return JSON.parse(await readFile(join(output, name), "utf8")); }
    catch (error) { if (error.code !== "ENOENT") throw new Error("Не удалось прочитать кеш; проверьте файлы пилота"); }
    const data = await fetchData();
    await save(name, { fetchedAt: new Date().toISOString(), data });
    return { data };
  };
  const results = [];
  for (const place of input.places) {
    let result;
    try {
      const hash = createHash("sha256").update(JSON.stringify([place.id, place.lat, place.lon, "nearest-v1"])).digest("hex");
      const nearest = (await cached(`nearest-${hash}.json`, () => client.nearest(place))).data;
      const matches = candidateMatches(place, nearest);
      const candidates = [];
      for (const match of matches.slice(0, 3)) {
        const detail = (await cached(`detail-${match.id}.json`, () => client.detail(match.id, match.location))).data;
        candidates.push({ ...detail, distanceM: match.distanceM, nameCoverage: match.nameCoverage });
      }
      result = { place, status: candidates.length ? "needs_review" : "no_candidate", nearestCount: nearest.length,
        candidateCount: matches.length, candidates, shortlistTruncated: matches.length > 3 };
    } catch (error) {
      if (!/^WIKIMAPIA_[A-Z_0-9]+$/.test(error?.code ?? "")) throw error;
      result = { place, status: "failed", error: error.code };
    }
    results.push(result);
    await save("report.json", { generatedAt: new Date().toISOString(), sample: input, complete: results.length === input.places.length, results });
    console.log(JSON.stringify({ progress: `${results.length}/${input.places.length}`, name: place.name, status: result.status,
      candidates: result.candidates?.length ?? 0, error: result.error }));
  }
  if (results.some(result => result.status === "failed")) process.exitCode = 1;
}

main().catch(error => {
  console.error(/^WIKIMAPIA_[A-Z_0-9]+$/.test(error?.code ?? "") ? error.code : "Пилот остановлен: проверьте входной JSON, доступность каталога результатов и параметры запуска.");
  process.exitCode = 1;
});
