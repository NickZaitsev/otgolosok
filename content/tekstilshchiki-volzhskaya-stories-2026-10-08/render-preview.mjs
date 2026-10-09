// Локальное превью всех рассказов и записей: node render-preview.mjs
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const here = import.meta.dirname;
const stories = JSON.parse(await readFile(join(here, "stories.json"), "utf8"));
const audio = JSON.parse(await readFile(join(here, "audio-verification.json"), "utf8"));
const previews = JSON.parse(await readFile(join(here, "preview-verification.json"), "utf8"));
assert.equal(stories.stops.length, 12);
assert.equal(audio.complete, true);
const escape = value => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const duration = seconds => `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, "0")}`;
const cards = stories.stops.map(stop => {
  const track = audio.items.find(item => item.order === stop.order && item.placeId === stop.placeId);
  const preview = previews.items.find(item => item.order === stop.order && item.placeId === stop.placeId);
  assert.ok(track && preview);
  const photo = preview.preview.status === "ready"
    ? `<img src="../../backend/data/tekstilshchiki-volzhskaya-2026-10-08/previews/${stop.order}-src.jpg" alt="${escape(preview.preview.alt)}">`
    : `<div class="missing">${preview.preview.status === "missing_card" ? "Карточка ещё не опубликована" : "У карточки нет фотографии"}</div>`;
  const paragraphs = stop.paragraphs.map(p => `<p>${escape(p.text)}</p>`).join("\n");
  return `<article class="card"><div class="photo">${photo}</div><div class="body"><div class="number">Остановка ${stop.order} из 12 · ${duration(track.measuredDurationSec)}</div><h2>${escape(stop.title)}</h2><audio controls preload="metadata" src="../../backend/data/tekstilshchiki-volzhskaya-2026-10-08/audio/${track.sha256}.mp3"></audio><details><summary>Читать рассказ</summary>${paragraphs}</details></div></article>`;
}).join("\n");
const html = `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Текстильщики → Волжская: превью</title><style>
:root{font-family:system-ui,sans-serif;color:#262820;background:#f2f0e8}*{box-sizing:border-box}body{margin:0}main{max-width:1000px;margin:auto;padding:32px 18px 70px}header{margin-bottom:28px}h1{font-size:clamp(28px,5vw,48px);line-height:1.08;margin:0 0 12px}header p{max-width:680px;line-height:1.55}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:18px}.card{background:white;border-radius:14px;overflow:hidden;box-shadow:0 2px 12px #1d241213}.photo{height:230px;background:#dce1d5}.photo img{display:block;width:100%;height:100%;object-fit:cover}.missing{height:100%;display:grid;place-items:center;padding:24px;color:#50594c;text-align:center}.body{padding:20px}.number{color:#657452;font-size:14px}h2{font-size:21px;line-height:1.2;margin:8px 0 18px}audio{width:100%}details{margin-top:18px;line-height:1.58}summary{cursor:pointer;color:#385a47;font-weight:600}details p{margin:14px 0 0}
</style><main><header><h1>От «Текстильщиков» до «Волжской»</h1><p>Локальное превью 12 рассказов. Озвучка ElevenLabs v4 голосом «Отголосок2» длится ${duration(audio.measuredTotalDurationSec)}. Семь карточек ещё не опубликованы, у дворца пока нет фотографии. Это редакционный просмотр, маршрутная ссылка пока не создана.</p></header><div class="grid">${cards}</div></main></html>\n`;
await writeFile(join(here, "preview.html"), html);
console.log(`Создано превью ${stories.stops.length} точек`);
