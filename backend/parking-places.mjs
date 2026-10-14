import { DatabaseSync } from "node:sqlite";
import { statSync } from "node:fs";
import { cellKey, etagOf } from "./map-cells.mjs";
import { validParkingPlace } from "./car-route.mjs";
import { failure } from "./domain.mjs";

export const CELL_SIZE=0.05;
const MAX_RADIUS_M=25_000,MAX_RESULTS=500;
const clamp=(value,min,max)=>Math.min(max,Math.max(min,value))||0;
export const cellOf=(lat,lon)=>({lat:clamp(Math.floor(lat*20),-1800,1799),lon:clamp(Math.floor(lon*20),-3600,3599)});
export const isCellLat=value=>Number.isSafeInteger(value)&&!Object.is(value,-0)&&value>=-1800&&value<=1799;
export const isCellLon=value=>Number.isSafeInteger(value)&&!Object.is(value,-0)&&value>=-3600&&value<=3599;
const fail=()=>Object.assign(new Error("Не удалось прочитать локальный индекс парковок OSM."),{code:"PARKING_INDEX_INVALID"});
const serialize=(lat,lon,places)=>JSON.stringify({lat,lon,places});
const distance=(a,b)=>{const dy=(a.lat-b.lat)*Math.PI/180,dx=(a.lon-b.lon)*Math.PI/180,la=a.lat*Math.PI/180,lb=b.lat*Math.PI/180;
  const h=Math.sin(dy/2)**2+Math.cos(la)*Math.cos(lb)*Math.sin(dx/2)**2;return 6371000*2*Math.asin(Math.min(1,Math.sqrt(h)));};
const point=(lat,lon)=>Object.freeze({lat,lon});
const fee=value=>{
  if(value==="yes")return true;
  if(value==="no")return false;
  if(value==="unknown")return null;
  throw fail();
};

function parkingPlace(row) {
  const location=point(row.lat,row.lon),routePoint=point(row.entranceLat,row.entranceLon);
  const place=Object.freeze({id:row.id,name:row.name?.trim()||"Парковка",location,entrance:routePoint,exit:routePoint,pedestrianAccess:routePoint,
    access:row.access,fee:fee(row.fee),openingHours:row.openingHours});
  if(!validParkingPlace(place))throw fail();
  return place;
}

/** Read-only immutable parking snapshot. SQLite is closed after startup. */
export function openParkingIndex(path) {
  try {statSync(path);}
  catch(error) {if(error.code==="ENOENT")return null;throw fail();}
  let db;
  try {
    db=new DatabaseSync(path,{readOnly:true,timeout:5000});
    const meta=Object.fromEntries(db.prepare("SELECT key,value FROM meta").all().map(row=>[row.key,row.value]));
    if(meta.format_version!=="1"||typeof meta.source_edited_at!=="string"||!Number.isFinite(Date.parse(meta.source_edited_at))
      ||typeof meta.attribution!=="string"||!meta.attribution.trim())throw fail();
    const rows=db.prepare(`SELECT id,name,lat,lon,entrance_lat AS entranceLat,entrance_lon AS entranceLon,
      access,fee,opening_hours AS openingHours FROM places ORDER BY id`).all();
    const places=Object.freeze(rows.map(parkingPlace)),byIdentifier=new Map(places.map(place=>[place.id,place])),groups=new Map();
    for(const place of places) {
      const cell=cellOf(place.location.lat,place.location.lon),key=cellKey(cell);
      if(!groups.has(key))groups.set(key,{...cell,places:[]});
      groups.get(key).places.push(place);
    }
    const bodies=new Map(),cells=[];
    for(const {lat,lon,places:cellPlaces} of [...groups.values()].sort((a,b)=>a.lat-b.lat||a.lon-b.lon)) {
      const body=serialize(lat,lon,cellPlaces);
      bodies.set(cellKey({lat,lon}),body);cells.push(Object.freeze({lat,lon,count:cellPlaces.length,etag:etagOf(body)}));
    }
    const sourceEditedAt=meta.source_edited_at,attribution=meta.attribution;
    const manifest=JSON.stringify({version:1,cellSize:CELL_SIZE,sourceEditedAt,attribution,cells});
    const status=Object.freeze({count:places.length,sourceEditedAt,attribution});
    const empty=new Map();
    return Object.freeze({
      manifest:()=>manifest,
      status:()=>status,
      cell(lat,lon) {
        if(!isCellLat(lat)||!isCellLon(lon))throw failure("BAD_REQUEST");
        const key=cellKey({lat,lon});
        if(bodies.has(key))return bodies.get(key);
        if(!empty.has(key)){empty.set(key,serialize(lat,lon,[]));if(empty.size>128)empty.delete(empty.keys().next().value);}
        return empty.get(key);
      },
      /** @param {{lat?:number,lon?:number,radius?:number,limit?:number,publicOnly?:boolean}} [query] */
      nearby({lat,lon,radius,limit=MAX_RESULTS,publicOnly=false}={}) {
        if(!Number.isFinite(lat)||Math.abs(lat)>90||!Number.isFinite(lon)||Math.abs(lon)>180||!Number.isFinite(radius)||radius<=0||radius>MAX_RADIUS_M
          ||!Number.isSafeInteger(limit)||limit<1||limit>MAX_RESULTS||typeof publicOnly!=="boolean")throw failure("BAD_REQUEST");
        const origin={lat,lon};
        return Object.freeze(places.flatMap(place=>{
          if(publicOnly&&place.access!=="public")return [];
          const distanceM=distance(origin,place.location);
          return distanceM<=radius?[{place,distanceM}]:[];
        }).sort((a,b)=>a.distanceM-b.distanceM||a.place.id.localeCompare(b.place.id)).slice(0,limit).map(item=>item.place));
      },
      byId(id) {
        if(typeof id!=="string"||!/^osm:(node|way|relation):[1-9]\d*$/.test(id))throw failure("BAD_REQUEST");
        return byIdentifier.get(id)??null;
      },
      close() {},
    });
  } catch(error) {if(error?.code==="BAD_REQUEST")throw error;throw fail();}
  finally {db?.close();}
}
