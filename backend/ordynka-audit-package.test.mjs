import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateWalkDocument } from './walk-document.mjs';
const read = name => JSON.parse(readFileSync(new URL(`../content/ordynka-audit-2026-10-06/${name}`, import.meta.url), 'utf8'));
const audit = read('audit.json');
const points = read('points.json');
const stories = read('stories.json');

test('Ордынка: каждая глава сопоставлена с физическим объектом либо отмечена как утраченная', () => {
  assert.deepEqual(audit.chapters.map(c => c.chapter), Array.from({ length: 97 }, (_, i) => i + 1));
  const known = new Set([...points.places.map(p => p.placeId), ...audit.chapters.flatMap(c => c.existingBefore)]);
  for (const c of audit.chapters) {
    assert(c.sourceUrl.startsWith('https://izi.travel/ru/5fb6-moskva-ordynka/ru#'));
    if (c.status === 'demolished') { assert.equal(c.chapter, 70); assert.deepEqual(c.placeIds, []); continue; }
    assert.equal(c.status, 'matched'); assert(c.placeIds.length > 0);
    for (const id of c.placeIds) assert(known.has(id), `Неизвестный объект главы ${c.chapter}: ${id}`);
  }
});

test('Ордынка: памятная доска, ресторан и соседние корпуса не подменяют объекты главы', () => {
  const ids = n => audit.chapters.find(c => c.chapter === n).placeIds;
  assert.deepEqual(ids(1), ['osm:way:24528986']);
  assert.deepEqual(ids(14), ['osm:way:52435401']);
  assert.deepEqual(ids(17), ['osm:way:53548440']);
  assert.deepEqual(ids(58), ['osm:way:53551260']);
  assert.deepEqual(ids(75), [...ids(72), 'osm:way:25057413']);
  assert.deepEqual(ids(96), ['osm:way:48172598']);
  assert.equal(ids(22).length, 3); assert.equal(ids(26).length, 2);
});

test('Ордынка: новые карточки имеют реальные OSM ID, геометрию и происхождение', () => {
  const ids = points.places.map(p => p.placeId);
  assert.equal(new Set(ids).size, ids.length);
  for (const p of points.places) {
    assert.equal(p.placeId, `osm:${p.osmType}:${p.osmId}`);
    assert(Number.isSafeInteger(p.osmId) && p.osmId > 0);
    assert(p.location.lat > 55.72 && p.location.lat < 55.75);
    assert(p.location.lon > 37.61 && p.location.lon < 37.64);
    assert(p.geometry.coordinates.length > 0);
    assert.equal(p.provenance.sourceUrl, `https://www.openstreetmap.org/${p.osmType}/${p.osmId}`);
    assert(p.provenance.discoverySource.includes('#'));
  }
});

test('Ордынка: дата открытия обители исправлена, факты рассказов связаны с первичными источниками', () => {
  const convent = stories.entries.find(e => e.placeId === 'osm:relation:16467332').story;
  const text = convent.paragraphs.map(p => p.text).join(' ');
  assert.match(text, /открылась в 1909 году/u); assert.doesNotMatch(text, /основана.*1907/u);
  const theatre = stories.entries.find(e => e.placeId === 'osm:node:2868787302').story;
  assert.match(theatre.title, /Театр на Малой Ордынке/u);
  for (const { story } of stories.entries) {
    assert.equal(story.wordCount, story.paragraphs.map(p => p.text).join(' ').split(/\s+/u).length);
    const sources = new Set(story.sources.map(s => s.id)), facts = new Set(story.facts.map(f => f.id));
    assert(sources.size > 0 && facts.size > 0);
    for (const f of story.facts) { assert(f.sourceIds.length > 0); assert(f.sourceIds.every(id => sources.has(id))); }
    for (const p of story.paragraphs) { assert(p.factIds.length > 0); assert(p.factIds.every(id => facts.has(id))); }
  }
});

test('Ордынка: проект соединяет метро и выдерживает порог пересечения в обоих направлениях', () => {
  const walk = validateWalkDocument(read('walk-candidate.json')), overlap = read('overlap.json');
  assert(walk.stops.length >= 10);
  assert.match(walk.start.address, /Третьяковская/u); assert.match(walk.destination.address, /Добрынинская/u);
  assert(walk.route.geometry.length > 2 && walk.route.distanceM > 2000);
  assert.equal(walk.fieldChecked, false);
  assert.deepEqual(walk.stops.map(s => s.storyRef.id), overlap.candidatePlaceIds);
  for (const w of overlap.walks) {
    assert.equal(w.common, w.commonPlaceIds.length);
    assert(w.candidatePercent <= 50 && w.existingPercent <= 60, w.title);
  }
});

test('Ордынка: каждая остановка проекта имеет проверенный MP3, сумма озвучки больше 15 минут', () => {
  const walk = read('walk-candidate.json'), audio = read('audio-candidate-verification.json');
  assert.deepEqual(audio.items.map(a => a.placeId), walk.stops.map(s => s.storyRef.id));
  const measured = audio.items.reduce((n, a) => n + a.measuredDurationSec, 0);
  assert(measured >= 900); assert(Math.abs(measured - audio.measuredDurationSec) < 0.01);
  for (const a of audio.items) {
    assert.match(a.sha256, /^[a-f0-9]{64}$/); assert(a.bytes > 1000);
    assert(Math.abs(a.durationSec - a.measuredDurationSec) < 1);
  }
  assert.equal(audio.publicationReady, false);
});
