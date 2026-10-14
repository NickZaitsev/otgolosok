import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createCarWalkPlanner} from './car-walks.mjs';
import {distance} from './walks.mjs';
import {validCarRoute} from './car-route.mjs';
const start={address:'Москва, Тверская, 1',location:{lat:55.757,lon:37.614}};
const stop={address:'Москва, Тверская, 5',location:{lat:55.761,lon:37.615},contentId:'osm:way:1'};
const point={lat:55.760,lon:37.614};
const parking={id:'osm:node:10',name:'Парковка',location:point,entrance:point,exit:point,pedestrianAccess:point,access:'public',fee:null,openingHours:null};
const encode=points=>{
  let lat=0,lon=0,result='';
  const part=value=>{let v=value<0?-value*2-1:value*2,out='';while(v>=32){out+=String.fromCharCode(v%32+95);v=Math.floor(v/32);}return out+String.fromCharCode(v+63);};
  for(const p of points){const a=Math.round(p.lat*1e6),b=Math.round(p.lon*1e6);result+=part(a-lat)+part(b-lon);lat=a;lon=b;}return result;
};
function fixture(options={}) {
  const calls=[];
  const router=async(_url,init)=>{
    const body=JSON.parse(init.body);calls.push(body);
    const points=body.locations.map(({lat,lon})=>({lat,lon}));
    return Response.json({trip:{status:0,units:'kilometers',legs:points.slice(1).map((p,i)=>({shape:encode([points[i],p]),summary:{time:body.costing==='auto'?120:180,length:distance(points[i],p)/1000}}))}});
  };
  const index={nearby:()=>[parking],byId:()=>parking};
  return {router,calls,plan:createCarWalkPlanner({routerUrl:'http://router/route',parkingIndex:index,fetchImpl:router,minIntervalMs:0,
    candidateProvider:async()=>[{id:'osm:way:1',address:stop.address,location:stop.location,readiness:'audio'}],...options})};
}
const input={travelMode:'driving',start,mode:'loop',minutes:60,stops:[{...stop,parkingId:parking.id}]};
test('дорога и возврат используют auto, пешая петля pedestrian, время включает посещение',async()=>{
 const {plan,calls}=fixture();const r=await plan(input);
 assert.deepEqual(calls.map(c=>c.costing),['auto','pedestrian','auto']);assert.equal(r.car.totalMinutes,20);
 assert.equal(r.car.drivingMinutes,4);assert.equal(r.walkingMinutes,6);
 assert.equal(validCarRoute(r.car,r.stops.map(s=>s.stopId)),true);
 assert.deepEqual(r.car.segments.at(-1).geometry.at(-1),start.location);
 const automaticParking=await plan({...input,stops:[stop]});assert.equal(automaticParking.car.visits[0].parking.access,'public');
});
test('истории группируются у парковки, открытый маршрут доходит до назначения',async()=>{
 const {plan}=fixture({candidateProvider:async()=>[1,2].map(n=>({id:`osm:way:${n}`,address:stop.address+n,location:{lat:55.761+n*0.0001,lon:37.615},readiness:'story'}))});
 const destination={address:'Москва, Тверская, 10',location:{lat:55.766,lon:37.615}};
 const r=await plan({travelMode:'driving',start,mode:'open',minutes:60,destination});
 assert.equal(r.stops.length,2);assert.equal(r.car.visits.length,1);assert.equal(r.car.visits[0].visitMinutes,10);
 assert.deepEqual(r.car.visits[0].stopIds,r.stops.map(s=>s.stopId));assert.deepEqual(r.car.segments.at(-1).geometry.at(-1),destination.location);
});
test('неизвестная парковка требует ручного выбора',async()=>{
 const unknown={...parking,access:'unknown'};const {plan}=fixture({parkingIndex:{nearby:()=>[unknown],byId:()=>unknown}});
 await assert.rejects(plan({travelMode:'driving',start,mode:'open',minutes:60}),{code:'WALK_NOT_FOUND'});
 await assert.rejects(plan({...input,stops:[stop]}),{code:'WALK_NOT_FOUND'});
 assert.equal((await plan({...input,stops:[{...stop,parkingId:unknown.id}]})).car.visits[0].parking.access,'unknown');
});
test('отсутствие пути не повторяется, нет прямолинейной подмены',async()=>{
 let count=0;const {plan}=fixture({fetchImpl:async()=>{count++;return Response.json({error_code:442},{status:400});}});
 await assert.rejects(plan(input),{code:'WALK_NOT_FOUND'});assert.equal(count,1);
});
test('временные ошибки повторяются ограниченно',async()=>{
 let count=0;const {router}=fixture();const {plan}=fixture({fetchImpl:async(...args)=>++count<3?Response.json({}, {status:503}):router(...args)});
 assert.equal((await plan(input)).car.visits.length,1);assert.equal(count,5);
 let failed=0;const bad=fixture({fetchImpl:async()=>{failed++;return Response.json({}, {status:503});}});
 await assert.rejects(bad.plan(input),{code:'WALK_UNAVAILABLE'});assert.equal(failed,3);
});
test('общий бюджет и длина пешей петли ограничены',async()=>{
 const {router}=fixture();const {plan}=fixture({fetchImpl:async(...args)=>{
 const data=/** @type {any} */(await (await router(...args)).json());data.trip.legs.forEach(l=>{l.summary.time=1200;});return Response.json(data);
 }});await assert.rejects(plan(input),{code:'WALK_NOT_FOUND'});
 const far={...stop,location:{lat:55.768,lon:37.614}};await assert.rejects(fixture().plan({...input,stops:[far]}),{code:'WALK_NOT_FOUND'});
});
test('ошибки данных и зависший запрос завершаются без частичного маршрута',async()=>{
 await assert.rejects(fixture({fetchImpl:async()=>new Response('invalid')}).plan(input),{code:'WALK_UNAVAILABLE'});
 await assert.rejects(fixture({timeoutMs:10,fetchImpl:async()=>new Promise(()=>{})}).plan(input),{code:'WALK_UNAVAILABLE'});
});
test('режим, дубликаты, длительность проверяются до маршрутизатора',async()=>{
 const {plan,calls}=fixture();for(const bad of [{...input,minutes:90},{...input,travelMode:'walking'},{...input,stops:[stop,stop]},{...input,destination:start}])await assert.rejects(plan(bad),{code:'WALK_INVALID'});
 assert.equal(calls.length,0);
});
test('один клиент ограничен частотой, очередь ограничена размером',async()=>{
 const {plan}=fixture({minIntervalMs:10000,maxWaiters:0,timeoutMs:20,fetchImpl:async()=>new Promise(()=>{})});
 const pending=plan(input,{client:'one'});await assert.rejects(plan(input,{client:'one'}),{code:'WALK_RATE_LIMITED'});
 await assert.rejects(plan(input,{client:'two'}),{code:'WALK_BUSY'});await assert.rejects(pending,{code:'WALK_UNAVAILABLE'});
});
test('нулевой переезд допустим, но пешая петля должна оставаться непустой',async()=>{
 const nearStart={...start,location:parking.entrance};const {router}=fixture();
 const {plan}=fixture({fetchImpl:async(...args)=>{
  const data=/** @type {any} */(await (await router(...args)).json());const request=JSON.parse(args[1].body);
  if(request.costing==='auto'&&distance(request.locations[0],request.locations[1])<1)data.trip.legs[0].summary={time:0,length:0};
  return Response.json(data);
 }});
 const result=await plan({...input,start:nearStart});assert.equal(result.car.drivingMinutes,0);assert.equal(result.car.totalMinutes,16);
});
test('ручной порядок сохраняется при возвращении к уже посещённой парковке',async()=>{
 const secondPoint={lat:55.764,lon:37.614};const second={...parking,id:'osm:node:11',location:secondPoint,entrance:secondPoint,exit:secondPoint,pedestrianAccess:secondPoint};
 const {plan}=fixture({parkingIndex:{nearby:()=>[parking],byId:id=>id===parking.id?parking:second}});
 const stops=[{...stop,stopId:'first',parkingId:parking.id},{...stop,address:'Москва, другой дом',location:{lat:55.7645,lon:37.615},stopId:'second',parkingId:second.id},
  {...stop,address:'Москва, третий дом',location:{lat:55.7615,lon:37.615},stopId:'third',parkingId:parking.id}];
 const result=await plan({...input,minutes:120,stops});
 assert.deepEqual(result.stops.map(stop=>stop.stopId),['first','second','third']);
 assert.deepEqual(result.car.visits.map(visit=>visit.parking.id),[parking.id,second.id,parking.id]);
});
test('повреждённые summary, snap и geometry не превращаются в успешный маршрут',async()=>{
 for(const mutate of [data=>{data.trip.legs[0].summary.time='10';},data=>{data.trip.legs[0].summary.length=-1;},
  data=>{data.trip.legs[0].shape='~';},data=>{data.trip.legs[0].shape=encode([{lat:55.757,lon:37.65},point]);}]) {
  const {router}=fixture();const {plan}=fixture({fetchImpl:async(...args)=>{const data=await(await router(...args)).json();mutate(data);return Response.json(data);}});
  await assert.rejects(plan(input),error=>['WALK_UNAVAILABLE','WALK_NOT_FOUND'].includes(/** @type {any} */(error).code));
 }
});
test('зависший источник объектов и отказ индекса закрываются общей границей ошибок',async()=>{
 await assert.rejects(fixture({timeoutMs:10,candidateProvider:async()=>new Promise(()=>{})}).plan({...input,stops:undefined}),{code:'WALK_UNAVAILABLE'});
 await assert.rejects(fixture({parkingIndex:{nearby:()=>{throw new Error('private failure');},byId:()=>null}}).plan({...input,stops:undefined}),{code:'WALK_UNAVAILABLE',message:'WALK_UNAVAILABLE'});
});
