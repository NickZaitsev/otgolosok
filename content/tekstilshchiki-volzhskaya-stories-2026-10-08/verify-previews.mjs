// Проверка существующих публичных карточек и двух размеров изображения каждой точки.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);
const here = import.meta.dirname;
const stops = JSON.parse(await readFile(join(here, "stories.json"), "utf8")).stops;
const previewDir = resolve("backend/data/tekstilshchiki-volzhskaya-2026-10-08/previews");
await mkdir(previewDir, { recursive: true });

async function get(url, path) {
  const { stdout } = await exec("curl", ["--http2", "-sS", "-L", "--retry", "2", "--max-time", "30", "-o", path,
    "-w", "%{http_code}", url], { timeout: 100000 });
  return Number(stdout.trim());
}

async function image(path) {
  const bytes = await readFile(path);
  assert.ok(bytes.length > 1000 && bytes[0] === 0xff && bytes[1] === 0xd8, `Неверный JPEG: ${path}`);
  const { stdout } = await exec("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height",
    "-of", "json", path], { timeout: 10000 });
  const { width, height } = JSON.parse(stdout).streams?.[0] ?? {};
  assert.ok(width >= 200 && height >= 150, `Слишком маленькое изображение: ${path}`);
  return { bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), width, height };
}

const items = [];
for (const stop of stops) {
  const id = stop.placeId;
  const apiPath = join(previewDir, `${stop.order}-place.json`);
  const cardStatus = await get(`https://otgolosok.online/api/content/places/${id}`, apiPath);
  const row = { order: stop.order, placeId: id, title: stop.title, cardStatus, preview: null };
  if (cardStatus === 200) {
    const data = JSON.parse(await readFile(apiPath, "utf8"));
    const photo = data.place?.photo ?? null;
    if (photo) {
      assert.ok(photo.sourceUrl && photo.author && photo.license && photo.licenseUrl && photo.alt, `Нет атрибуции: ${id}`);
      const files = {};
      for (const size of ["thumbnail", "src"]) {
        const path = join(previewDir, `${stop.order}-${size}.jpg`);
        const status = await get(`https://otgolosok.online${photo[size]}`, path);
        assert.equal(status, 200, `Изображение ${id}/${size} недоступно: ${status}`);
        files[size] = { url: photo[size], ...await image(path) };
      }
      row.preview = { status: "ready", alt: photo.alt, author: photo.author, sourceUrl: photo.sourceUrl,
        license: photo.license, licenseUrl: photo.licenseUrl, files };
    } else row.preview = { status: "missing_photo" };
  } else if (cardStatus === 404) row.preview = { status: "missing_card" };
  else throw new Error(`Карточка ${id}: HTTP ${cardStatus}`);
  items.push(row);
  console.log(`${stop.order}/12 ${stop.title}: ${row.preview.status}`);
}
await writeFile(join(here, "preview-verification.json"), JSON.stringify({ checkedAt: new Date().toISOString(), items }, null, 2) + "\n");
