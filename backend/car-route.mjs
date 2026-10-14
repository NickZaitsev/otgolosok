// Shared wire contract: stories remain stops; a parking visit owns one or more stories.
/** @typedef {{lat:number,lon:number}} CarPoint */
/** @typedef {{id:string,name:string,location:CarPoint,entrance:CarPoint,exit:CarPoint,pedestrianAccess:CarPoint,access:'public'|'unknown',fee:boolean|null,openingHours:string|null}} ParkingPlace */
/** @typedef {{id:string,parking:ParkingPlace,stopIds:string[],visitMinutes:number,parkingMinutes:number}} ParkingVisit */
/** @typedef {{mode:'driving'|'walking',visitId:string|null,geometry:CarPoint[],distanceM:number,minutes:number}} TravelSegment */
/** @typedef {{drivingMinutes:number,totalMinutes:number,visits:ParkingVisit[],segments:TravelSegment[]}} CarRoute */

export const CAR_MINUTES = [60, 120, 180];
export const MAX_CAR_DISTANCE_M = 250_000;
export const MAX_CAR_VERTICES = 30_000;
export const MAX_CAR_DOCUMENT_BYTES = 1_500_000;
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
/** @returns {value is Record<string, any>} */
const fields = (value, names) => record(value) && Object.keys(value).every(key => names.includes(key));
const text = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max && !/[\p{Cc}\p{Cf}<>]/u.test(value);
const identifier = value => typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,127}$/.test(value);
const point = p => fields(p, ['lat', 'lon']) && Number.isFinite(p.lat) && Math.abs(p.lat) <= 90 && Number.isFinite(p.lon) && Math.abs(p.lon) <= 180;
const number = (v, max) => Number.isFinite(v) && v >= 0 && v <= max;
const distance = (a, b) => Math.hypot((a.lat-b.lat)*111320, (a.lon-b.lon)*111320*Math.cos((a.lat+b.lat)*Math.PI/360));

/** @param {unknown} value @param {(p:CarPoint)=>boolean} [validPoint] @returns {value is ParkingPlace} */
export function validParkingPlace(value, validPoint = point) {
  return fields(value, ['id','name','location','entrance','exit','pedestrianAccess','access','fee','openingHours'])
    && typeof value.id === 'string' && /^osm:(node|way|relation):[1-9]\d*$/.test(value.id)
    && text(value.name, 180) && ['location','entrance','exit','pedestrianAccess'].every(key => point(value[key]) && validPoint(value[key]))
    && ['public','unknown'].includes(value.access) && (value.fee === null || typeof value.fee === 'boolean')
    && (value.openingHours === null || text(value.openingHours, 500))
    && distance(value.location,value.entrance) <= 1000 && distance(value.location,value.exit) <= 1000
    && distance(value.location,value.pedestrianAccess) <= 1000;
}

/** Geometry is frozen with the visit references; drafts invalidate it when stops change.
 * @param {unknown} value @param {string[]} stopIds @param {(p:CarPoint)=>boolean} [validPoint]
 * @returns {value is CarRoute}
 */
export function validCarRoute(value, stopIds, validPoint = point) {
  if (!fields(value,['drivingMinutes','totalMinutes','visits','segments']) || !number(value.drivingMinutes,180)
    || !number(value.totalMinutes,180) || value.totalMinutes <= 0 || !Number.isInteger(value.totalMinutes)
    || !Array.isArray(value.visits) || !value.visits.length || value.visits.length > 40
    || !Array.isArray(value.segments) || value.segments.length !== value.visits.length * 2 && value.segments.length !== value.visits.length * 2 + 1
    || !Array.isArray(stopIds) || !stopIds.length || new Set(stopIds).size !== stopIds.length) return false;
  const ids = new Set(), covered = [];
  for (const visit of value.visits) {
    if (!fields(visit,['id','parking','stopIds','visitMinutes','parkingMinutes']) || !identifier(visit.id) || ids.has(visit.id)
      || !validParkingPlace(visit.parking,validPoint) || !Array.isArray(visit.stopIds) || !visit.stopIds.length || visit.stopIds.length > 40
      || !visit.stopIds.every(identifier) || !number(visit.visitMinutes,120) || visit.visitMinutes <= 0 || !number(visit.parkingMinutes,30)) return false;
    ids.add(visit.id); covered.push(...visit.stopIds);
  }
  if (covered.length !== stopIds.length || covered.some((id,i) => id !== stopIds[i])) return false;
  let vertices = 0, drive = 0, walk = 0;
  for (let i = 0; i < value.segments.length; i++) {
    const segment = value.segments[i], visit = value.visits[Math.floor(i/2)];
    if (!fields(segment,['mode','visitId','geometry','distanceM','minutes']) || !['driving','walking'].includes(segment.mode)
      || !Array.isArray(segment.geometry) || segment.geometry.length < 2 || !segment.geometry.every(p => point(p) && validPoint(p))
      || !number(segment.distanceM,MAX_CAR_DISTANCE_M) || !number(segment.minutes,180)) return false;
    vertices += segment.geometry.length;
    if (vertices > MAX_CAR_VERTICES) return false;
    if (visit) {
      if (segment.visitId !== visit.id || segment.mode !== (i % 2 === 0 ? 'driving':'walking')) return false;
      if (i % 2 === 0) {
        if (distance(segment.geometry.at(-1),visit.parking.entrance)>75) return false;
        if (i>0 && distance(segment.geometry[0],value.visits[Math.floor(i/2)-1].parking.exit)>75) return false;
      } else if (segment.distanceM <= 0 || segment.minutes <= 0 || segment.distanceM > 1500
        || distance(segment.geometry[0],visit.parking.pedestrianAccess)>75 || distance(segment.geometry.at(-1),visit.parking.pedestrianAccess)>75) return false;
    } else if (segment.visitId !== null || segment.mode !== 'driving' || distance(segment.geometry[0],value.visits.at(-1).parking.exit)>75) return false;
    if (segment.mode === 'driving') drive += segment.minutes; else walk += segment.minutes;
  }
  const visiting = value.visits.reduce((sum,visit) => sum+visit.visitMinutes+visit.parkingMinutes,0);
  return Math.abs(value.drivingMinutes-drive)<=1 && value.totalMinutes === Math.ceil(drive+walk+visiting);
}

/** Copies nested points so adapters never mutate a stored route through an alias.
 * @param {CarRoute} car @param {Map<string,string>} [stopIds] @returns {CarRoute}
 */
export function copyCarRoute(car, stopIds = new Map()) {
  return { ...car, visits:car.visits.map(visit => ({...visit,stopIds:visit.stopIds.map(id=>stopIds.get(id)??id),parking:{...visit.parking,
    location:{...visit.parking.location},entrance:{...visit.parking.entrance},exit:{...visit.parking.exit},pedestrianAccess:{...visit.parking.pedestrianAccess}}})),
    segments:car.segments.map(segment=>({...segment,geometry:segment.geometry.map(p=>({...p}))})) };
}

/** @param {{route?:{car?:CarRoute,walkingMinutes:number}|null}} document */
export const tripMinutes = document => document.route?.car?.totalMinutes ?? document.route?.walkingMinutes ?? null;

/** Map overview geometry, with no artificial connector between distinct access points.
 * @param {CarRoute} car @returns {CarPoint[]}
 */
export function carRouteGeometry(car) {
  const result = [];
  for (const segment of car.segments) {
    const first = segment.geometry[0], last = result.at(-1);
    result.push(...(last && first.lat === last.lat && first.lon === last.lon ? segment.geometry.slice(1) : segment.geometry));
  }
  return result;
}
