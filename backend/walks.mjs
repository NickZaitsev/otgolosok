import discoveryCatalog from './walk-discovery-catalog.mjs';

const fail = (code) => Object.assign(new Error(code), {code});
const inBox = (p) => p && typeof p.lat === 'number' && typeof p.lon === 'number' && Number.isFinite(p.lat) && Number.isFinite(p.lon) && p.lat >= 55.48 && p.lat <= 55.98 && p.lon >= 37.30 && p.lon <= 37.95;
const keys = (v, allowed) => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).every(k => allowed.includes(k));
const clean = (v, max) => typeof v === 'string' && v.length <= max && !/[\p{Cc}\p{Cf}<>]/u.test(v) ? v.trim().replace(/\s+/g, ' ') : '';
const distance = (a,b) => {
  const rad = Math.PI / 180;
  const h = Math.sin((b.lat-a.lat)*rad/2)**2 + Math.cos(a.lat*rad)*Math.cos(b.lat*rad)*Math.sin((b.lon-a.lon)*rad/2)**2;
  return 12742000 * Math.asin(Math.sqrt(Math.min(1,h)));
};

function place(p) {
  if (!keys(p,['address','location']) || !clean(p.address,240) || !keys(p.location,['lat','lon']) || !inBox(p.location)) throw fail('WALK_INVALID');
  return {address:clean(p.address,240),location:{lat:p.location.lat,lon:p.location.lon}};
}

// Valhalla's default shape is a latitude/longitude polyline with six decimals.
function decode(shape) {
  if (typeof shape !== 'string' || !shape.length || shape.length > 200000) throw fail('WALK_UNAVAILABLE');
  const points=[]; let i=0,lat=0,lon=0;
  function delta() {
    let value=0,shift=0,byte;
    do {
      if(i>=shape.length || shift>30)throw fail('WALK_UNAVAILABLE');
      byte=shape.charCodeAt(i++)-63;
      if(byte<0||byte>63)throw fail('WALK_UNAVAILABLE');
      value+=(byte&31)*2**shift;shift+=5;
    } while(byte>=32);
    return value%2 ? -(value+1)/2 : value/2;
  }
  while(i<shape.length) {
    lat+=delta();lon+=delta();const p={lat:lat/1e6,lon:lon/1e6};
    if(!inBox(p)||points.length>=12000)throw fail('WALK_UNAVAILABLE');
    points.push(p);
  }
  if(points.length<2)throw fail('WALK_UNAVAILABLE');
  return points;
}

export function createWalkPlanner({fetchImpl=fetch, now=Date.now,
  routerUrl=process.env.WALK_ROUTER_URL,
  overpassUrl=process.env.WALK_OVERPASS_URL ?? 'https://overpass-api.de/api/interpreter',
  discoveryElements=process.env.WALK_DISCOVERY_SOURCE==='overpass'?null:discoveryCatalog.elements,
  timeoutMs=12000, minIntervalMs=2000}={}) {
  let active=false,lastStart=-Infinity;
  return async function planWalk(input) {
    if(!keys(input,['start','mode','minutes','stops']) || !['loop','open'].includes(input.mode) || ![30,60,90].includes(input.minutes))throw fail('WALK_INVALID');
    const start=place(input.start), manual=Object.hasOwn(input,'stops');
    if(manual&&(!Array.isArray(input.stops)||input.stops.length<1||input.stops.length>5))throw fail('WALK_INVALID');
    let stops=manual?input.stops.map(place):[];
    const distinct=[start,...stops];
    if(distinct.some((p,i)=>distinct.slice(0,i).some(q=>distance(p.location,q.location)<25)))throw fail('WALK_INVALID');
    if(!routerUrl)throw fail('WALK_UNAVAILABLE');
    if(active||now()-lastStart<minIntervalMs)throw fail('WALK_BUSY');
    active=true;lastStart=now();
    const controller=new AbortController();let timer,discovering=false;
    const unavailable=()=>fail(discovering?'WALK_DISCOVERY_UNAVAILABLE':'WALK_UNAVAILABLE');
    const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(unavailable());},timeoutMs);});
    async function request(url,body,contentType) {
      const response=await fetchImpl(url,{method:'POST',body,redirect:'error',signal:controller.signal,headers:{'Content-Type':contentType,Accept:'application/json','User-Agent':'Otgolosok/0.1 (+https://otgolosok.softmg.tech)'}});
      if(!response?.ok||!response.body?.getReader){await response?.body?.cancel();throw fail('WALK_UNAVAILABLE');}
      const reader=response.body.getReader(),chunks=[];let size=0;
      const cancel=()=>{void reader.cancel().catch(()=>{});};
      controller.signal.addEventListener('abort',cancel,{once:true});
      try {
        while(true) {
          controller.signal.throwIfAborted();
          const {done,value}=await reader.read();if(done)break;
          size+=value.byteLength;if(size>1024*1024)throw fail('WALK_UNAVAILABLE');chunks.push(value);
        }
        return JSON.parse(Buffer.concat(chunks).toString());
      } finally {controller.signal.removeEventListener('abort',cancel);cancel();}
    }
    async function run() {
      if(!manual) {
        discovering=true;
        // Discovery is bounded; straight-line distances only rank candidates, never form a route.
        // A loop must also cover the return leg; routing below enforces the actual budget.
        const radius=Math.min(4050,input.minutes*90/(input.mode==='loop'?2:1)),around=`around:${radius},${start.location.lat},${start.location.lon}`;
        let elements=discoveryElements;
        if(elements===null) {
          const query=`[out:json][timeout:8];(nwr(${around})[building][name]["addr:street"]["addr:housenumber"][historic];nwr(${around})[building][name]["addr:street"]["addr:housenumber"][heritage];nwr(${around})[building][name]["addr:street"]["addr:housenumber"][tourism=museum];);out center tags 160;`;
          const data=await request(overpassUrl,new URLSearchParams({data:query}).toString(),'application/x-www-form-urlencoded');
          if(!Array.isArray(data?.elements)||data.elements.length>500||data.remark)throw unavailable();
          elements=data.elements;
        }
        const candidates=[];
        for(const e of elements) {
          const t=e?.tags,p=e?.center??e;
          if(!t||!inBox(p)||!clean(t.name,180)||!clean(t.building,80)||t.building==='no'||!(t.historic&&t.historic!=='no'||t.heritage&&t.heritage!=='no'||t.tourism==='museum'))continue;
          const street=clean(t['addr:street'],160),house=clean(t['addr:housenumber'],40);
          if(!street||!house||!/^\d[\p{L}\p{N}\s/.,-]*$/u.test(house)||distance(start.location,p)>radius||distance(start.location,p)<60)continue;
          const item={address:`Москва, ${street}, ${house}`,location:{lat:p.lat,lon:p.lon}};
          if(candidates.some(c=>c.address===item.address||distance(c.location,p)<40))continue;
          candidates.push(item);
        }
        let current=start;
        while(candidates.length&&stops.length<4) {
          candidates.sort((a,b)=>distance(current.location,a.location)-distance(current.location,b.location));
          current=candidates.shift();stops.push(current);
        }
        if(stops.length<2)throw fail('WALK_STOPS_NOT_FOUND');
        discovering=false;
      }
      while(true) {
        controller.signal.throwIfAborted();
        const points=[start,...stops,...(input.mode==='loop'?[start]:[])];
        const url=new URL(routerUrl);
        if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw fail('WALK_UNAVAILABLE');
        const data=await request(url.toString(),JSON.stringify({locations:points.map(p=>({...p.location,type:'break',radius:100})),costing:'pedestrian',units:'kilometers',shape_format:'polyline6'}),'application/json');
        if(data?.error_code===442)throw fail('WALK_NOT_FOUND');
        const trip=data?.trip;
        if(trip?.status!==0||trip.units!=='kilometers'||!Array.isArray(trip.legs)||trip.legs.length!==points.length-1)throw fail('WALK_UNAVAILABLE');
        const geometry=[];let seconds=0,distanceM=0;
        for(const [i,leg] of trip.legs.entries()) {
          const s=leg?.summary;
          if(!s||!Number.isFinite(s.time)||s.time<=0||!Number.isFinite(s.length)||s.length<=0||s.time>86400||s.length>100)throw fail('WALK_UNAVAILABLE');
          const shape=decode(leg.shape);
          if(distance(shape[0],points[i].location)>150||distance(shape.at(-1),points[i+1].location)>150||(geometry.length&&distance(geometry.at(-1),shape[0])>10))throw fail('WALK_UNAVAILABLE');
          let measured=0;for(let j=1;j<shape.length;j++)measured+=distance(shape[j-1],shape[j]);
          if(Math.abs(measured-s.length*1000)>Math.max(100,s.length*1000*0.25))throw fail('WALK_UNAVAILABLE');
          seconds+=s.time;distanceM+=s.length*1000;geometry.push(...(geometry.length?shape.slice(1):shape));
          if(geometry.length>12000)throw fail('WALK_UNAVAILABLE');
        }
        const direct=points.slice(1).reduce((sum,p,i)=>sum+distance(points[i].location,p.location),0);
        if(seconds<=input.minutes*60&&distanceM<=input.minutes*90&&distanceM<=Math.max(1200,direct*4)) {
          return {stops,geometry,distanceM:Math.round(distanceM),walkingMinutes:Math.ceil(seconds/60),attribution:'© OpenStreetMap contributors; pedestrian routing by Valhalla. Map information is not verified historical evidence.'};
        }
        if(manual||stops.length<=2)throw fail('WALK_NOT_FOUND');
        stops=stops.slice(0,-1);
      }
    }
    try {return await Promise.race([run(),deadline]);}
    catch(error) {if(['WALK_NOT_FOUND','WALK_STOPS_NOT_FOUND','WALK_DISCOVERY_UNAVAILABLE'].includes(error?.code))throw error;throw unavailable();}
    finally {clearTimeout(timer);controller.abort();active=false;}
  };
}
