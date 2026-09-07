import test from 'node:test';
import assert from 'node:assert/strict';
import { createWalkPlanner } from './walks.mjs';

const start={address:'Москва, Арбат, 1',location:{lat:55.75,lon:37.60}};
const stop=n=>({address:`Москва, Арбат, ${n+2}`,location:{lat:55.75+n*0.001,lon:37.60}});
const input=(extra={})=>({start,mode:'loop',minutes:30,stops:[stop(1),stop(2)],...extra});
function encode(points) {
  let lat=0,lon=0,out='';
  for(const p of points) {
    const a=Math.round(p.lat*1e6),b=Math.round(p.lon*1e6);
    for(let d of [a-lat,b-lon]) {
      d=d<0?-d*2-1:d*2;
      while(d>=32){out+=String.fromCharCode((d%32)+95);d=Math.floor(d/32);}
      out+=String.fromCharCode(d+63);
    }
    lat=a;lon=b;
  }
  return out;
}
function route(request,time=100) {
  const points=request.locations;
  return {trip:{status:0,units:'kilometers',legs:points.slice(1).map((p,i)=>({summary:{time,length:Math.abs(p.lat-points[i].lat)*111.195},shape:encode([points[i],{lat:(p.lat+points[i].lat)/2,lon:p.lon},p])}))}};
}
const candidates=()=>({elements:[1,2,3,4].map(n=>({type:'way',center:stop(n).location,tags:{name:`House ${n}`,building:'yes',historic:'building','addr:street':'Арбат','addr:housenumber':String(n+2)}}))});
function fixture(handler) {
  const calls=[];
  const plan=createWalkPlanner({routerUrl:'https://router.test/route',overpassUrl:'https://osm.test/',minIntervalMs:0,fetchImpl:async(url,options)=>{
    calls.push({url:String(url),options});
    return Response.json(await handler(String(url),options,calls));
  }});
  return {plan,calls};
}

for(const mode of ['loop','open'])test(`manual ${mode} preserves stop order and returns upstream geometry`,async()=>{
  const {plan,calls}=fixture((url,o)=>route(JSON.parse(o.body)));
  const stops=[stop(2),stop(1)];const result=await plan(input({mode,stops}));
  const request=JSON.parse(calls[0].options.body);
  assert.equal(request.costing,'pedestrian');assert.equal(request.units,'kilometers');
  assert.deepEqual(request.locations.map(({lat,lon})=>({lat,lon})),[start,...stops,...(mode==='loop'?[start]:[])].map(p=>p.location));
  assert.deepEqual(result.stops,stops);assert.deepEqual(result.geometry[0],start.location);
  assert.deepEqual(result.geometry.at(-1),mode==='loop'?start.location:stops.at(-1).location);
  assert.equal(result.geometry.length,mode==='loop'?7:5);
  assert.ok(result.distanceM>300);assert.ok(result.walkingMinutes<=30);
  assert.match(result.attribution,/OpenStreetMap/);
});

test('strict input validation makes no upstream calls',async()=>{
  const {plan,calls}=fixture(()=>{throw new Error('must not fetch');});
  for(const value of [null,[],{},input({mode:'drive'}),input({minutes:'30'}),input({minutes:31}),input({extra:true}),input({stops:[]}),input({stops:undefined}),input({stops:Array.from({length:6},(_,i)=>stop(i+1))}),input({stops:[start]}),input({stops:[stop(1),stop(1)]}),input({start:{...start,address:'<script>'}}),input({start:{...start,address:'a'.repeat(241)}}),input({start:{...start,location:{lat:'55.75',lon:37.6}}}),input({start:{...start,location:{lat:56,lon:37.6}}}),input({start:{...start,location:{lat:55.75,lon:NaN}}}),input({start:{...start,location:{...start.location,z:1}}})]) {
    await assert.rejects(plan(value),{code:'WALK_INVALID'});
  }
  assert.equal(calls.length,0);
});

for(const mode of ['loop','open'])test(`automatic ${mode} selects 2-4 ordered addressed buildings`,async()=>{
  const data=candidates();
  data.elements.reverse();data.elements.push(...[
    {...data.elements[0],tags:{...data.elements[0].tags,name:'<bad>'}},
    {...data.elements[0],tags:{...data.elements[0].tags,'addr:housenumber':'<123>'}},
    {...data.elements[0],tags:{name:'no address',building:'yes',historic:'building'}},
    {...data.elements[0],center:{lat:55.9,lon:37.6}},
  ]);
  const {plan,calls}=fixture((url,o)=>url.includes('osm')?data:route(JSON.parse(o.body)));
  const result=await plan({start,mode,minutes:30});
  assert.deepEqual(result.stops,[1,2,3,4].map(stop));
  const query=new URLSearchParams(calls[0].options.body).get('data');
  assert.match(query,/around:600,55.75,37.6/);assert.match(query,/\[building\]\[name\]/);
  assert.deepEqual(result.geometry.at(-1),mode==='loop'?start.location:stop(4).location);
});

test('automatic over-budget routes shorten, never return a fabricated fallback',async()=>{
  const {plan,calls}=fixture((url,o)=>url.includes('osm')?candidates():route(JSON.parse(o.body),500));
  const result=await plan({start,mode:'loop',minutes:30});
  assert.equal(result.stops.length,2);assert.equal(result.walkingMinutes,25);assert.equal(calls.length,4);
  const impossible=fixture((url,o)=>url.includes('osm')?candidates():route(JSON.parse(o.body),1000));
  await assert.rejects(impossible.plan({start,mode:'loop',minutes:30}),{code:'WALK_NOT_FOUND'});
  assert.equal(impossible.calls.length,4);
  await assert.rejects(impossible.plan(input()),{code:'WALK_NOT_FOUND'});
});

test('too few automatic candidates fail honestly',async()=>{
  const {plan}=fixture(()=>({elements:candidates().elements.slice(0,1)}));
  await assert.rejects(plan({start,mode:'open',minutes:90}),{code:'WALK_NOT_FOUND'});
});

test('a routed but enormous detour is rejected even when reported time fits',async()=>{
  const {plan}=fixture((url,o)=>{
    const request=JSON.parse(o.body),data=route(request);
    data.trip.legs[0]={summary:{time:100,length:3.224655},shape:encode([start.location,{lat:55.765,lon:37.6},stop(1).location])};
    return data;
  });
  await assert.rejects(plan(input({minutes:90})),{code:'WALK_NOT_FOUND'});
});

test('rejects malformed router payloads and geometry',async()=>{
  for(const mutate of [
    ()=>null,
    d=>({...d,trip:{...d.trip,units:'miles'}}),
    d=>{d.trip.legs.pop();return d;},
    d=>{d.trip.legs[0].summary.time='100';return d;},
    d=>{d.trip.legs[0].shape='~';return d;},
    d=>{d.trip.legs[0].shape=encode([{lat:55.9,lon:37.6},stop(1).location]);return d;},
    d=>{d.trip.legs[0].summary.length=80;return d;},
  ]) {
    const {plan}=fixture((url,o)=>mutate(route(JSON.parse(o.body))));
    await assert.rejects(plan(input()),{code:'WALK_UNAVAILABLE'});
  }
});

test('rejects malformed, oversized, and failing upstream responses',async()=>{
  for(const fetchImpl of [async()=>new Response('private',{status:500}),async()=>new Response('{'),async()=>new Response('x'.repeat(1024*1024+1)),async()=>{throw new Error('secret');}]) {
    const plan=createWalkPlanner({routerUrl:'https://router.test/route',fetchImpl});
    await assert.rejects(plan(input()),{code:'WALK_UNAVAILABLE',message:'WALK_UNAVAILABLE'});
  }
  for(const data of [{}, {elements:[],remark:'timeout'}, {elements:Array(501).fill({})}]) {
    const {plan}=fixture(()=>data);
    await assert.rejects(plan({start,mode:'loop',minutes:30}),{code:'WALK_UNAVAILABLE'});
  }
});

test('missing router, concurrency, cooldown and total deadline are bounded',async()=>{
  await assert.rejects(createWalkPlanner({routerUrl:''})(input()),{code:'WALK_UNAVAILABLE'});
  let clock=0,signal;
  const plan=createWalkPlanner({routerUrl:'https://router.test/route',timeoutMs:25,now:()=>clock,fetchImpl:async(url,o)=>{signal=o.signal;return new Promise(()=>{});}});
  const first=plan(input());
  await assert.rejects(plan(input()),{code:'WALK_BUSY'});
  await assert.rejects(first,{code:'WALK_UNAVAILABLE'});assert.equal(signal.aborted,true);
  await assert.rejects(plan(input()),{code:'WALK_BUSY'});
  clock=2001;await assert.rejects(plan(input()),{code:'WALK_UNAVAILABLE'});
});

test('total deadline also covers a stalled response body',async()=>{
  let cancelled=false;
  const plan=createWalkPlanner({routerUrl:'https://router.test/route',timeoutMs:20,fetchImpl:async()=>new Response(new ReadableStream({start(){},cancel(){cancelled=true;}}))});
  await assert.rejects(plan(input()),{code:'WALK_UNAVAILABLE'});
  assert.equal(cancelled,true);
});
