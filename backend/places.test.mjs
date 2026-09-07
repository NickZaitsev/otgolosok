import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlaceResolver } from './places.mjs';

const enc = new TextEncoder();
function response(payload, { status = 200, stream = true } = {}) {
  const bytes = enc.encode(typeof payload === 'string' ? payload : JSON.stringify(payload));
  return {
    ok: status >= 200 && status < 300,
    status,
    body: stream ? new ReadableStream({ start(c) { c.enqueue(bytes); c.close(); } }) : null
  };
}
function item(address = {}) {
  return { lat: '55.7558', lon: '37.6176', osm_type: 'node', osm_id: 42,
    display_name: 'Тест', address: { city: 'Москва', ...address } };
}
function fake(payload, options) {
  const calls = [];
  return { calls, fetch: async (url, init) => { calls.push({ url, init }); return response(payload, options); } };
}
async function rejectsCode(promise, code) {
  await assert.rejects(promise, error => error?.code === code);
}

test('validates exact input shapes, values, and URL-like queries', async () => {
  const r = createPlaceResolver({ fetchImpl: fake(item()).fetch });
  for (const value of [null, {}, { lat: 55.7 }, { lat: 55.7, lon: 37.6, x: 1 }, { lat: '55.7', lon: 37.6 }, { lat: 54, lon: 37.6 }, { q: 'ab' }, { q: 'https://x.test' }, { q: 'x'.repeat(181) }]) {
    await rejectsCode(r(value), 'PLACE_INVALID');
  }
});

test('uses fixed Nominatim endpoints and required request parameters', async () => {
  const f = fake([item({ road: 'Тверская', house_number: '1' })]);
  const r = createPlaceResolver({ fetchImpl: f.fetch });
  await r({ q: 'Тверская 1' });
  const call = f.calls[0]; const url = new URL(call.url);
  assert.equal(url.origin, 'https://nominatim.openstreetmap.org');
  assert.equal(url.pathname, '/search');
  assert.equal(url.searchParams.get('countrycodes'), 'ru');
  assert.equal(url.searchParams.get('bounded'), '1');
  assert.equal(url.searchParams.get('limit'), '1');
  assert.equal(call.init.headers['Accept-Language'], 'ru');
  assert.match(call.init.headers['User-Agent'], /^Otgolosok\/0\.1/);
});

test('preserves an exact house suffix and does not manufacture missing numbers', async () => {
  let f = fake(item({ road: 'ул. Тестовая', house_number: '12 корпус 3', building: 'Дом' }));
  let r = createPlaceResolver({ fetchImpl: f.fetch });
  const full = await r({ lat: 55.75, lon: 37.61 });
  assert.equal(full.address, 'Москва, ул. Тестовая, 12 корпус 3');
  assert.equal(full.label, 'Дом');
  assert.deepEqual(full.location, { lat: 55.7558, lon: 37.6176 });
  assert.equal(full.osmId, 'node/42');
  f = fake(item({ road: 'ул. Тестовая' }));
  r = createPlaceResolver({ fetchImpl: f.fetch });
  assert.equal((await r({ lat: 55.75, lon: 37.61 })).address, null);
});

test('rejects results outside Moscow and unavailable/bounded responses', async () => {
  let r = createPlaceResolver({ fetchImpl: fake([item({ city: 'Химки', state: 'Московская область' })]).fetch });
  await rejectsCode(r({ q: 'Химки дом' }), 'PLACE_NOT_FOUND');
  r = createPlaceResolver({ fetchImpl: fake('nope').fetch });
  await rejectsCode(r({ q: 'Москва дом' }), 'PLACE_UNAVAILABLE');
  r = createPlaceResolver({ fetchImpl: fake('x'.repeat(256 * 1024 + 1)).fetch });
  await rejectsCode(r({ q: 'Москва дом' }), 'PLACE_UNAVAILABLE');
});

test('caches successes, rate limits misses, and rejects concurrent upstream work', async () => {
  let clock = 10_000;
  const f = fake(item({ road: 'Арбат', house_number: '1' }));
  const r = createPlaceResolver({ fetchImpl: async(url,init)=>new URL(url).pathname==='/search'?response([item({road:'Арбат',house_number:'1'})]):f.fetch(url,init), now: () => clock });
  await r({ lat: 55.75, lon: 37.61 });
  await r({ lat: 55.75, lon: 37.61 });
  assert.equal(f.calls.length, 1, 'cache bypasses the rate gate');
  await rejectsCode(r({ q: 'Арбат 1' }), 'PLACE_BUSY');
  clock += 1100;
  await r({ q: 'Арбат 1' });

  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const slow = createPlaceResolver({ fetchImpl: async () => { await pending; return response(item()); }, now: () => 0 });
  const first = slow({ lat: 55.75, lon: 37.61 });
  await rejectsCode(slow({ q: 'Арбат 1' }), 'PLACE_BUSY');
  release(); await first;
});

test('empty search is not found, HTTP failures are sanitized, and cache expires', async () => {
  await rejectsCode(createPlaceResolver({fetchImpl:fake([]).fetch})({q:'Арбат 10'}),'PLACE_NOT_FOUND');
  await rejectsCode(createPlaceResolver({fetchImpl:fake('private provider detail',{status:403}).fetch})({q:'Арбат 10'}),'PLACE_UNAVAILABLE');
  let clock=0;const f=fake(item({road:'Арбат',house_number:'10'}));
  const r=createPlaceResolver({fetchImpl:f.fetch,now:()=>clock});
  await r({lat:55.75,lon:37.61});clock+=86400001;await r({lat:55.75,lon:37.61});
  assert.equal(f.calls.length,2);
});

test('oversized streaming response cancels the reader', async () => {
  let cancelled=false;
  const body=new ReadableStream({pull(c){c.enqueue(new Uint8Array(256*1024+1));},cancel(){cancelled=true;}});
  const r=createPlaceResolver({fetchImpl:async()=>({ok:true,body})});
  await rejectsCode(r({q:'Арбат 10'}),'PLACE_UNAVAILABLE');assert.equal(cancelled,true);
});
