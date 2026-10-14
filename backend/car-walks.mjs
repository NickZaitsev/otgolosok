import { cityAt } from './cities.mjs';
import { carRouteGeometry, validCarRoute, validParkingPlace, CAR_MINUTES, MAX_CAR_DISTANCE_M } from './car-route.mjs';
import { distance, decode, readJson } from './walks.mjs';

const fail = code => Object.assign(new Error(code), { code });
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const fields = (v, names) => object(v) && Object.keys(v).every(k => names.includes(k));
const osmId = v => typeof v === 'string' && /^osm:(node|way|relation):[1-9]\d*$/.test(v);
const identifier = value => typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,127}$/.test(value);
const place = value => fields(value,['address','location','contentId','placeId','stopId','parkingId'])
  && typeof value.address === 'string' && value.address.trim().length > 0 && value.address.length <= 240
  && !/[\p{Cc}\p{Cf}<>]/u.test(value.address) && fields(value.location,['lat','lon'])
  && Number.isFinite(value.location.lat) && Number.isFinite(value.location.lon) && cityAt(value.location.lat,value.location.lon)
  && [value.parkingId,value.contentId,value.placeId].every(id=>id===undefined||osmId(id))
  && (value.stopId===undefined||identifier(value.stopId));
const retryable = status => status === 408 || status === 429 || status >= 500;
const delay=(ms,signal)=>new Promise((resolve,reject)=>{
  const abort=()=>{clearTimeout(timer);reject(fail('WALK_UNAVAILABLE'));};
  const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},ms);
  signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
});
function sumGeometry(geometry) {
  let total = 0; for (let index = 1; index < geometry.length; index++) total += distance(geometry[index - 1], geometry[index]);
  return Math.round(total);
}

/** @param {{candidateProvider?:Function,parkingIndex?:any,fetchImpl?:Function,routerUrl?:string,timeoutMs?:number,retries?:number,now?:()=>number,minIntervalMs?:number,maxWaiters?:number,maxWaitMs?:number}} [options] */
export function createCarWalkPlanner({ candidateProvider, parkingIndex, fetchImpl = fetch,
  routerUrl = process.env.VALHALLA_ROUTE_URL ?? process.env.WALK_ROUTER_URL, timeoutMs = 20000, retries = 2,
  now=Date.now,minIntervalMs=2000,maxWaiters=8,maxWaitMs=10000 } = {}) {
  let active=false,lastStart=-Infinity,pumpTimer=null;
  const queue=[],clients=new Map();
  const pump=()=>{
    if(active||!queue.length||pumpTimer)return;
    const wait=lastStart+minIntervalMs-now();
    if(wait>0){pumpTimer=setTimeout(()=>{pumpTimer=null;pump();},wait);return;}
    const next=queue.shift();clearTimeout(next.timer);active=true;lastStart=now();next.resolve();
  };
  const acquire=()=>{
    if(!active&&!queue.length&&now()-lastStart>=minIntervalMs){active=true;lastStart=now();return;}
    if(queue.length>=maxWaiters)throw fail('WALK_BUSY');
    return new Promise((resolve,reject)=>{
      const waiter={resolve,timer:setTimeout(()=>{queue.splice(queue.indexOf(waiter),1);reject(fail('WALK_BUSY'));},maxWaitMs)};
      queue.push(waiter);pump();
    });
  };
  return async function planCarWalk(input, { client = null } = {}) {
    if (!object(input) || Object.keys(input).some(key => !['travelMode', 'start', 'destination', 'mode', 'minutes', 'stops'].includes(key))
      || input.travelMode !== 'driving' || !['loop', 'open'].includes(input.mode) || !CAR_MINUTES.includes(input.minutes)
      || !place(input.start) || (input.destination !== undefined && input.destination !== null && !place(input.destination))
      || (input.destination != null && input.mode !== 'open') || (input.stops !== undefined && (!Array.isArray(input.stops) || !input.stops.length || input.stops.length > 40 || input.stops.some(stop => !place(stop))))) throw fail('WALK_INVALID');
    if (!routerUrl || !parkingIndex || typeof parkingIndex.nearby !== 'function' || typeof parkingIndex.byId !== 'function') throw fail('WALK_UNAVAILABLE');
    const city = cityAt(input.start.location.lat, input.start.location.lon);
    const points = [input.start, ...(input.stops ?? []), ...(input.destination ? [input.destination] : [])];
    if (points.some(item => cityAt(item.location.lat, item.location.lon) !== city)) throw fail('WALK_INVALID');
    if ((input.stops??[]).some((p,i)=>input.stops.slice(0,i).some(q=>distance(p.location,q.location)<5)))throw fail('WALK_INVALID');
    const suppliedIds=(input.stops??[]).flatMap(stop=>stop.stopId?[stop.stopId]:[]);
    if(new Set(suppliedIds).size!==suppliedIds.length)throw fail('WALK_INVALID');
    if(client){const time=now(),last=clients.get(client);if(last!==undefined&&time-last<minIntervalMs)throw fail('WALK_RATE_LIMITED');
      for(const [key,at] of clients)if(time-at>=minIntervalMs)clients.delete(key);
      if(clients.size>=1024)throw fail('WALK_BUSY');clients.set(client,time);}
    await acquire();
    const controller = new AbortController(); let timer,calls=0;
    const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(fail('WALK_UNAVAILABLE'));},timeoutMs);});
    const endpoint = (() => { try { const url = new URL(routerUrl); if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null; return url.toString(); } catch { return null; } })();
    if (!endpoint) { clearTimeout(timer);active=false;pump();throw fail('WALK_UNAVAILABLE'); }
    const cache=new Map();
    const requestRoute = async (locations, costing) => {
      const body=JSON.stringify({locations:locations.map(p=>({...p,type:'break',radius:0})),costing,units:'kilometers',shape_format:'polyline6'});
      if(cache.has(body))return cache.get(body);
      let data;
      const limit=Math.min(2,Math.max(0,retries));
      for(let attempt=0;attempt<=limit;attempt++) {
        controller.signal.throwIfAborted();if(++calls>36)throw fail('WALK_UNAVAILABLE');
        let response;
        try {response=await fetchImpl(endpoint,{method:'POST',body,redirect:'error',signal:controller.signal,
          headers:{'Content-Type':'application/json',Accept:'application/json'}});}
        catch {if(controller.signal.aborted||attempt===limit)throw fail('WALK_UNAVAILABLE');await delay(100*2**attempt,controller.signal);continue;}
        if(retryable(response?.status)){await response.body?.cancel();if(attempt===limit)throw fail('WALK_UNAVAILABLE');await delay(100*2**attempt,controller.signal);continue;}
        try {data=await readJson(response,controller.signal);}catch {throw fail('WALK_UNAVAILABLE');}
        if(!response.ok)throw fail([442,171].includes(data?.error_code)?'WALK_NOT_FOUND':'WALK_UNAVAILABLE');
        break;
      }
      const trip=data?.trip;
      if(trip?.status!==0||trip.units!=='kilometers'||!Array.isArray(trip.legs)||trip.legs.length!==locations.length-1)throw fail('WALK_UNAVAILABLE');
      const legs=trip.legs.map((leg,index)=>{
        const summary=leg?.summary;
        if(!summary||!Number.isFinite(summary.time)||summary.time<0||summary.time>10800||!Number.isFinite(summary.length)||summary.length<0||summary.length>250)throw fail('WALK_UNAVAILABLE');
        const geometry=decode(leg.shape);
        if(geometry.some(p=>cityAt(p.lat,p.lon)!==city)||distance(geometry[0],locations[index])>75||distance(geometry.at(-1),locations[index+1])>75)throw fail('WALK_NOT_FOUND');
        const measured=sumGeometry(geometry);
        if(Math.abs(measured-summary.length*1000)>Math.max(100,summary.length*250))throw fail('WALK_UNAVAILABLE');
        return {geometry,distanceM:Math.round(summary.length*1000),minutes:summary.time/60};
      });
      if(legs.some((leg,i)=>i>0&&distance(legs[i-1].geometry.at(-1),leg.geometry[0])>10))throw fail('WALK_NOT_FOUND');
      cache.set(body,legs);return legs;
    };
    const parkingFor = async (candidate, manual) => {
      if (manual && candidate.parkingId) {
        const selected = parkingIndex.byId(candidate.parkingId);
        if (!selected || !validParkingPlace(selected, p => cityAt(p.lat, p.lon) === city)) throw fail('WALK_NOT_FOUND');
        return selected;
      }
      const nearby = parkingIndex.nearby({ lat: candidate.location.lat, lon: candidate.location.lon, radius: 600, limit: 20, publicOnly: true });
      if(!Array.isArray(nearby)||nearby.length>20)throw fail('WALK_DISCOVERY_UNAVAILABLE');
      return nearby.filter(item => validParkingPlace(item, p => cityAt(p.lat, p.lon) === city) && item.access === 'public'
        && distance(item.pedestrianAccess,candidate.location)<=600)
        .sort((a, b) => distance(a.pedestrianAccess, candidate.location) - distance(b.pedestrianAccess, candidate.location) || a.id.localeCompare(b.id))[0] ?? null;
    };
    async function run() {
      let candidates;
      const manual = input.stops !== undefined;
      if (manual) {
        if (!input.stops.length) throw fail('WALK_STOPS_NOT_FOUND');
        candidates = input.stops;
      } else {
        if (typeof candidateProvider !== 'function') throw fail('WALK_STOPS_NOT_FOUND');
        candidates = await candidateProvider({ lat: input.start.location.lat, lon: input.start.location.lon, radius: 25000, limit: 500, published: true, travelMode: 'driving' });
        if (!Array.isArray(candidates) || candidates.length > 500 || candidates.some(item => !osmId(item.id)||!place({address:item.address,location:item.location})||!['none','story','audio'].includes(item.readiness))) throw fail('WALK_DISCOVERY_UNAVAILABLE');
        candidates = candidates.filter(item => ['story','audio'].includes(item.readiness)).map(item=>({address:item.address,location:item.location,placeId:item.id,contentId:item.id}))
          .filter(item=>cityAt(item.location.lat,item.location.lon)===city&&distance(input.start.location,item.location)<=25000)
          .sort((a,b)=>distance(input.start.location,a.location)-distance(input.start.location,b.location));
      }
      const grouped = new Map();let candidateIndex=0;
      for (const candidate of candidates) {
        controller.signal.throwIfAborted();
        const parking = await parkingFor(candidate, manual);
        if (!parking) { if (manual) throw fail('WALK_NOT_FOUND'); continue; }
        let generatedId;
        do { generatedId=`car-stop-${candidateIndex++}`; } while(suppliedIds.includes(generatedId));
        const stopId = candidate.stopId ?? generatedId;
        const visitId = `car-visit-${grouped.size}`;
        // Ручная последовательность сохраняется: повторная парковка после другой
        // остановки образует новый визит, а не переносит историю назад в маршруте.
        const last=[...grouped.values()].at(-1);
        const groupKey=manual&&last?.parking.id!==parking.id?`${parking.id}:${candidateIndex}`:manual?[...grouped.keys()].at(-1):parking.id;
        if (!grouped.has(groupKey)) grouped.set(groupKey, { id: visitId, parking, stopIds: [], candidates: [], visitMinutes: 0, parkingMinutes: 5 });
        const visit = grouped.get(groupKey);
        if(visit.candidates.some(p=>distance(p.location,candidate.location)<5))continue;
        if(!manual&&visit.stopIds.length>=3)continue;
        visit.stopIds.push(stopId);visit.candidates.push({...candidate,stopId,parkingId:parking.id});visit.visitMinutes+=5;
      }
      const groups=[...grouped.values()];
      if (manual && groups.reduce((sum,v)=>sum+v.candidates.length,0)!==input.stops.length) throw fail('WALK_NOT_FOUND');
      if(!groups.length)throw fail('WALK_NOT_FOUND');
      const visits=[],segments=[];let current=input.start.location,closing=null;
      for(const visit of groups.slice(0,manual?40:8)) {
        try {
          const drive=(await requestRoute([current,visit.parking.entrance],'auto'))[0];
          const walking=await requestRoute([visit.parking.pedestrianAccess,...visit.candidates.map(p=>p.location),visit.parking.pedestrianAccess],'pedestrian');
          const walk={geometry:walking.flatMap((leg,i)=>i?leg.geometry.slice(1):leg.geometry),distanceM:walking.reduce((sum,l)=>sum+l.distanceM,0),minutes:walking.reduce((sum,l)=>sum+l.minutes,0)};
          if(walk.distanceM<=0||walk.minutes<=0||walk.distanceM>1500)throw fail('WALK_NOT_FOUND');
          const finish=input.destination?.location??(input.mode==='loop'?input.start.location:null);
          const nextClosing=finish?(await requestRoute([visit.parking.exit,finish],'auto'))[0]:null;
          const addition=[{...drive,mode:'driving',visitId:visit.id},{...walk,mode:'walking',visitId:visit.id}];
          const next=[...segments,...addition,...(nextClosing?[nextClosing]:[])];
          const total=Math.ceil(next.reduce((sum,s)=>sum+s.minutes,0)+[...visits,visit].reduce((sum,v)=>sum+v.visitMinutes+v.parkingMinutes,0));
          if(total>input.minutes||next.reduce((sum,s)=>sum+s.distanceM,0)>MAX_CAR_DISTANCE_M)throw fail('WALK_NOT_FOUND');
          visits.push(visit);segments.push(...addition);current=visit.parking.exit;closing=nextClosing;
        }catch(error){if(!manual&&error?.code==='WALK_NOT_FOUND')continue;throw error;}
      }
      if(!visits.length)throw fail('WALK_NOT_FOUND');
      if(closing)segments.push({...closing,mode:'driving',visitId:null});
      const drivingMinutes=segments.filter(s=>s.mode==='driving').reduce((sum,s)=>sum+s.minutes,0);
      const walkingMinutes=Math.ceil(segments.filter(s=>s.mode==='walking').reduce((sum,s)=>sum+s.minutes,0));
      const totalMinutes=Math.ceil(segments.reduce((sum,s)=>sum+s.minutes,0)+visits.reduce((sum,v)=>sum+v.visitMinutes+v.parkingMinutes,0));
      const totalDistance=segments.reduce((sum,s)=>sum+s.distanceM,0);
      const stopOutput=visits.flatMap(v=>v.candidates);
      const car={drivingMinutes,totalMinutes,visits:visits.map(v=>({id:v.id,parking:v.parking,stopIds:v.stopIds,visitMinutes:v.visitMinutes,parkingMinutes:v.parkingMinutes})),segments};
      if(!validCarRoute(car,stopOutput.map(s=>s.stopId),p=>cityAt(p.lat,p.lon)===city))throw fail('WALK_UNAVAILABLE');
      return { stops: stopOutput, geometry: carRouteGeometry(car), distanceM: totalDistance, walkingMinutes, attribution: '© OpenStreetMap contributors; автомобильная и пешеходная маршрутизация Valhalla.', car };
    }
    try {return await Promise.race([run(),deadline]);} catch (error) {
      if (error?.code) throw error;
      throw fail('WALK_UNAVAILABLE');
    } finally { clearTimeout(timer); controller.abort();active=false;pump(); }
  };
}

export { decode as decodeCarShape };
