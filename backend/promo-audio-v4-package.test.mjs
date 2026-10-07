import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('Промопрогулки: проверены фактические провайдер, модель и голос всех записей, включая повторно используемые', () => {
  const report = JSON.parse(readFileSync(new URL('../content/promo-audio-v4-2026-10-07/verification.json', import.meta.url), 'utf8'));
  assert.equal(report.walks.length, 25);
  assert.equal(report.items.length, 205);
  assert.equal(report.replacements.length, 50);
  assert.equal(report.preservedV3.length, 103);
  for (const item of report.items) {
    assert.equal(item.audio.provider, 'elevenlabs', item.title);
    assert(['eleven_v3', 'eleven_v4'].includes(item.audio.model), item.title);
    assert.equal(item.audio.voice, '9ivxhQ6xIsHd6R3Xc635', item.title);
    assert.match(item.audio.sha256, /^[a-f0-9]{64}$/);
    assert(item.audio.bytes > 1000 && item.audio.durationSec > 0);
  }
  for (const replacement of report.replacements) {
    assert.equal(replacement.beforeModel, 'f5');
    assert.equal(replacement.audio.model, 'eleven_v4', replacement.title);
    assert.notEqual(replacement.audio.sha256, replacement.beforeSha256);
    assert(replacement.measuredDurationSec > 0);
    assert(Math.abs(replacement.measuredDurationSec - replacement.audio.durationSec) < 1);
  }
  for (const preserved of report.preservedV3) {
    assert.equal(preserved.audio.model, 'eleven_v3', preserved.title);
    assert.equal(preserved.audio.sha256, preserved.beforeSha256);
  }
  for (const id of ['osm:relation:8453866', 'osm:node:1359123836']) {
    assert(report.items.some(item => item.placeId === id), id);
  }
});
