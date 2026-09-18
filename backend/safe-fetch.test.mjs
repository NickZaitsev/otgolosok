import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { fetchSource, isPublicAddress, validateSourceUrl } from './safe-fetch.mjs';

const rejects = [
  '0.1.2.3', '10.0.0.1', '100.64.0.1', '127.0.0.1', '169.254.1.1',
  '172.16.0.1', '192.0.0.1', '192.0.2.1', '192.168.1.1', '198.18.0.1',
  '198.51.100.1', '203.0.113.1', '224.0.0.1', '240.0.0.1',
  '::1', 'fc00::1', 'fe80::1', '::ffff:8.8.8.8', '2001:db8::1',
  '2001::1', '2002::1',
];

test('public-address policy rejects special address ranges', () => {
  for (const ip of rejects) assert.equal(isPublicAddress(ip), false, ip);
  for (const ip of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111']) {
    assert.equal(isPublicAddress(ip), true, ip);
  }
});

test('URL validation enforces scheme, host, credentials, port, and literals', () => {
  for (const value of [
    'ftp://example.com/a', 'https://user@example.com/', 'https://example.com:444/',
    'http://localhost/', 'http://printer/', 'http://a.local/', 'http://a.internal/',
    'http://127.0.0.1/', 'http://2130706433/', 'http://[::ffff:8.8.8.8]/',
    'x'.repeat(2001),
  ]) assert.throws(() => validateSourceUrl(value), { code: 'INVALID_URL' }, value);
  assert.equal(validateSourceUrl('https://8.8.8.8/a').hostname, '8.8.8.8');
  assert.equal(validateSourceUrl('https://[2606:4700:4700::1111]/').protocol, 'https:');
});

function fakeRequest(reply, seen) {
  return (options, callback) => {
    seen.push(options);
    const req = new EventEmitter();
    req.end = () => queueMicrotask(() => reply(options, callback));
    req.destroy = () => {};
    return req;
  };
}

function response(statusCode, headers, chunks = []) {
  const res = new EventEmitter();
  res.statusCode = statusCode;
  res.headers = headers;
  res.resume = () => {};
  res.destroy = () => {};
  queueMicrotask(() => { for (const c of chunks) res.emit('data', c); res.emit('end'); });
  return res;
}

test('mixed DNS answers are refused before a request is made', async () => {
  let called = false;
  await assert.rejects(fetchSource('https://example.com/', {
    lookup: async () => [{ address: '8.8.8.8', family: 4 }, { address: '127.0.0.1', family: 4 }],
    request: () => { called = true; },
  }), { code: 'DNS_REJECTED' });
  assert.equal(called, false);
});

test('pins a validated answer and returns a bounded text response', async () => {
  const seen = [];
  const result = await fetchSource('https://example.com/x?q=1', {
    lookup: async () => [{ address: '8.8.8.8', family: 4 }],
    request: fakeRequest((_options, cb) => cb(response(200, { 'content-type': 'text/html; charset=utf-8' }, ['<p>ok</p>'])), seen),
  });
  assert.deepEqual(result, { url: 'https://example.com/x?q=1', contentType: 'text/html', html: '<p>ok</p>' });
  assert.equal(seen[0].servername, 'example.com');
  await new Promise((resolve, reject) => seen[0].lookup('ignored', { all: true }, (e, rows) => e ? reject(e) : (assert.deepEqual(rows, [{ address: '8.8.8.8', family: 4 }]), resolve())));
});

test('returns a bounded PDF as bytes for isolated text extraction', async () => {
  const bytes=Buffer.from('%PDF-1.7 fixture');
  const result=await fetchSource('https://example.com/source.pdf',{
    lookup:async()=>[{address:'8.8.8.8',family:4}],
    request:fakeRequest((_options,cb)=>cb(response(200,{'content-type':'application/pdf','content-length':String(bytes.length)},[bytes])),[]),
  });
  assert.equal(result.url,'https://example.com/source.pdf');
  assert.equal(result.contentType,'application/pdf');
  assert.deepEqual(result.bytes,bytes);
});

test('rejects declared or streamed oversized responses', async () => {
  const lookup = async () => [{ address: '8.8.8.8', family: 4 }];
  await assert.rejects(fetchSource('http://example.com/', {
    lookup, maxBytes: 3,
    request: fakeRequest((_o, cb) => cb(response(200, { 'content-type': 'text/plain', 'content-length': '4' })), []),
  }), { code: 'SOURCE_TOO_LARGE' });
  await assert.rejects(fetchSource('http://example.com/', {
    lookup, maxBytes: 3,
    request: fakeRequest((_o, cb) => cb(response(200, { 'content-type': 'text/plain' }, ['four'])), []),
  }), { code: 'SOURCE_TOO_LARGE' });

test('PDF has a separate 25 MiB default limit', async () => {
  const lookup=async()=>[{address:'8.8.8.8',family:4}],bytes=Buffer.alloc(1200001,1);bytes.write('%PDF-1.7');
  const result=await fetchSource('https://example.com/large.pdf',{lookup,request:fakeRequest((_o,cb)=>cb(response(200,{'content-type':'application/pdf'},[bytes])),[])});
  assert.equal(result.bytes.length,bytes.length);
  await assert.rejects(fetchSource('https://example.com/large.pdf',{lookup,maxPdfBytes:bytes.length-1,request:fakeRequest((_o,cb)=>cb(response(200,{'content-type':'application/pdf'},[bytes])),[])}),{code:'SOURCE_TOO_LARGE'});
});
});

test('a redirect is DNS-revalidated and cannot reach a private answer', async () => {
  const seen = [];
  await assert.rejects(fetchSource('https://public.example/', {
    lookup: async host => host === 'public.example'
      ? [{ address: '8.8.8.8', family: 4 }] : [{ address: '10.0.0.7', family: 4 }],
    request: fakeRequest((_o, cb) => cb(response(302, { location: 'https://next.example/path' })), seen),
  }), { code: 'DNS_REJECTED' });
  assert.equal(seen.length, 1);
});

test('an already aborted literal request never starts', async () => {
  let called = false;
  await assert.rejects(fetchSource('https://8.8.8.8/', {
    signal: AbortSignal.abort(), request: () => {called = true;},
  }));
  assert.equal(called,false);
});

test('DNS and hung requests share the same bounded deadline', async () => {
  await assert.rejects(fetchSource('https://example.com/', {
    timeoutMs:10,lookup:()=>new Promise(()=>{}),
  }),{code:'TIMEOUT'});
  let destroyed = false;
  await assert.rejects(fetchSource('https://8.8.8.8/', {
    timeoutMs:10,request:()=>{const req=new EventEmitter();req.end=()=>{};req.destroy=()=>{destroyed=true;};return req;},
  }),{code:'TIMEOUT'});
  assert.equal(destroyed,true);
});
