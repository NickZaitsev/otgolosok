import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateWalkDocument } from './walk-document.mjs';
import { resolveWalkView } from './walk-view.mjs';
import { hasValidStoryText } from './admin.mjs';

const read = name => JSON.parse(readFileSync(new URL(`../content/ordynka-temples-2026-10-07/${name}`, import.meta.url), 'utf8'));
const distance = (a, b) => Math.hypot((a.lat - b.lat) * 111195, (a.lon - b.lon) * 62580);

test('Ордынка: слушатель подходит к дому Островского и музею Тропинина, а не к соседнему кварталу', () => {
  const walk = validateWalkDocument(read('walk.json'));
  for (const id of ['osm:node:1359123836', 'osm:way:164210810']) {
    const stop = walk.stops.find(s => (s.placeId ?? s.storyRef.id) === id);
    assert(stop);
    assert(distance(stop.place.location, stop.triggerLocation) <= 45, id);
  }
});

test('Ордынка: отдельные рассказы сохраняют фото и физическую идентичность пяти общих объектов', () => {
  const walk = validateWalkDocument(read('walk.json')), entries = read('stories.json').entries;
  assert.equal(walk.stops.length, 13);
  assert.equal(entries.length, 5);
  assert.match(walk.start.address, /Третьяковская/u);
  assert.match(walk.destination.address, /Добрынинская/u);
  for (const e of entries) {
    const stop = walk.stops.find(s => s.placeId === e.placeId);
    assert.deepEqual(stop.storyRef, { kind: 'job', id: e.jobId });
    assert.equal(stop.place.address, e.story.address);
    assert(hasValidStoryText(e.story));
    assert.equal(e.story.wordCount, e.story.paragraphs.map(p => p.text).join(' ').split(/\s+/u).length);
    assert.notDeepEqual(e.story.paragraphs, e.expectedStory.paragraphs);
    assert.deepEqual(e.story.sources, e.expectedStory.sources);
    assert.deepEqual(e.story.facts, e.expectedStory.facts);
    assert.deepEqual(e.story.paragraphs.slice(0, -1), e.expectedStory.paragraphs.slice(0, -1));
  }
  const selected = { ...walk, stops: walk.stops.filter(s => s.storyRef.kind === 'job') };
  const jobs = new Map(entries.map(e => [e.jobId, { id: e.jobId, address: e.story.address, stage: 'ready', data: { story: e.story }, revision: 0 }]));
  const store = { get: id => jobs.get(id) };
  const view = resolveWalkView(selected, 0, store);
  assert(view.chapters.every(c => c.story && c.status === 'text_ready' && c.audio === null));
  const first = selected.stops[0];
  jobs.get(first.storyRef.id).address = 'Москва, другой дом, 1';
  assert.equal(resolveWalkView(selected, 0, store).chapters[0].status, 'unavailable');
  jobs.delete(first.storyRef.id);
  assert.equal(resolveWalkView(selected, 0, store).chapters[0].story, null);
});

test('Ордынка: маршрутные связки ведут к новым остановкам и к метро после последней', () => {
  const entries = read('stories.json').entries;
  const endings = entries.map(e => e.story.paragraphs.at(-1).text);
  /** @type {Array<[number, RegExp]>} */
  const checks = [[0, /Николая в Пыжах/u], [1, /Марфо-Мариинская/u], [2, /музея Тропинина/u], [3, /сцене Малого театра/u], [4, /выходу 1 метро «Добрынинская»/u]];
  for (const [index, expected] of checks) {
    assert.match(endings[index], expected);
  }
  assert.doesNotMatch(endings[4], /Последняя остановка находится/u);
});

test('Ордынка: пересечение считается по объектам, а подходы не требуют входа в музеи', () => {
  const walk = read('walk.json'), overlap = read('overlap.json'), geometry = read('geometry-verification.json');
  assert.deepEqual([...new Set(walk.stops.map(s => s.placeId))].sort(), overlap.candidatePlaceIds);
  for (const w of overlap.walks) assert(w.candidatePercent <= 50 && w.existingPercent <= 60, w.title);
  assert.equal(overlap.walks.find(w => w.shareToken === '85429f29-1bb3-41dc-a08b-2c4cb13b67d0').common, 0);
  assert.equal(overlap.walks.find(w => w.shareToken === 'baed220c-72a9-4790-940e-1b1160e02913').common, 5);
  assert(geometry.approach.every(p => p.distanceM < 25));
  assert(geometry.startGapM < 1 && geometry.destinationGapM < 1);
  assert(geometry.walks.every(w => w.candidatePercent < 50));
  assert.equal(walk.fieldChecked, false);
});

test('Ордынка: готовые MP3 покрывают все остановки, старые связки исключены и звук длится не меньше 15 минут', () => {
  const walk = read('walk.json'), audio = read('audio-verification.json'), entries = read('stories.json').entries;
  assert.deepEqual(audio.items.map(a => a.placeId), walk.stops.map(s => s.placeId));
  const measured = audio.items.reduce((total, a) => total + a.measuredDurationSec, 0);
  assert(measured >= 900);
  assert(Math.abs(measured - audio.measuredDurationSec) < 0.01);
  for (const [index, a] of audio.items.entries()) {
    assert.equal(a.provider, 'elevenlabs', a.title);
    assert.equal(a.model, 'eleven_v4', a.title);
    assert.equal(a.voice, '9ivxhQ6xIsHd6R3Xc635', a.title);
    assert.match(a.sha256, /^[a-f0-9]{64}$/);
    assert(a.bytes > 1000 && a.measuredDurationSec > 0);
    assert(Math.abs(a.measuredDurationSec - a.durationSec) < 1);
    assert.deepEqual(a.storyRef, walk.stops[index].storyRef);
    const e = entries.find(entry => entry.placeId === a.placeId);
    if (e) assert.notEqual(a.sha256, e.expectedAudio.sha256);
  }
});
