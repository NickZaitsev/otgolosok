// Shared, dependency-free registry of the cities the catalog covers. Areas do not
// overlap, so a coordinate belongs to at most one city and a walk to exactly one.
// The data lives in cities.json, which the OSM build scripts read as well.
import data from "./cities.json" with { type: "json" };

/** @typedef {{south:number,north:number,west:number,east:number}} Bounds */
/** @typedef {{id:"moscow"|"kazan",name:"Москва"|"Казань",nameEn:string,inName:string,boundaryRelation:number,bounds:Bounds,region:Bounds,center:{lat:number,lon:number},zoom:number}} City */

/** Freezes a city with its nested areas. @param {City} city @returns {City} */
const freeze = city => {
  for (const item of Object.values(city)) if (item && typeof item === "object") Object.freeze(item);
  return Object.freeze(city);
};

/** @type {readonly City[]} */
export const CITIES = Object.freeze(/** @type {City[]} */ (data.cities).map(freeze));

export const MOSCOW = CITIES[0];

/** @param {Bounds} box @param {unknown} lat @param {unknown} lon */
export const insideBounds = (box, lat, lon) => typeof lat === "number" && typeof lon === "number" && Number.isFinite(lat) && Number.isFinite(lon)
  && lat >= box.south && lat <= box.north && lon >= box.west && lon <= box.east;

/** The city whose walk area holds the point. @param {unknown} lat @param {unknown} lon @returns {City | null} */
export const cityAt = (lat, lon) => CITIES.find(city => insideBounds(city.bounds, lat, lon)) ?? null;

/** The city whose catalog region holds the point. @param {unknown} lat @param {unknown} lon @returns {City | null} */
export const regionCityAt = (lat, lon) => CITIES.find(city => insideBounds(city.region, lat, lon)) ?? null;

/** @param {unknown} name @returns {City | null} */
export const cityByName = name => CITIES.find(city => city.name === name) ?? null;

// A city named as a word: «Казанский переулок» and «Московская улица» name no city.
const named = CITIES.map(city => ({ city, pattern: new RegExp(`(?:^|[^\\p{L}])${city.name}(?:$|[^\\p{L}])`, "iu") }));

/** The city an address names, if any. @param {string} address @returns {City | null} */
export const cityInAddress = address => named.find(item => item.pattern.test(address))?.city ?? null;

/** «Казань, улица Баумана, 5» → «улица Баумана, 5»: the address without its leading city. @param {string} address */
export const withoutCity = address => {
  const city = cityInAddress(address);
  return city ? address.replace(new RegExp(`^${city.name}[,.\\s]*`, "iu"), "") : address;
};
