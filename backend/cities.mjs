// Shared, dependency-free registry of the cities the catalog covers. Areas do not
// overlap, so a coordinate belongs to at most one city and a walk to exactly one.

/** @typedef {{south:number,north:number,west:number,east:number}} Bounds */
/** @typedef {{id:"moscow"|"kazan",name:"Москва"|"Казань",nameEn:string,inName:string,bounds:Bounds,region:Bounds,center:{lat:number,lon:number},zoom:number}} City */

/** Freezes a city with its nested areas. @param {City} city @returns {City} */
const freeze = city => {
  for (const item of Object.values(city)) if (item && typeof item === "object") Object.freeze(item);
  return Object.freeze(city);
};

/** @type {readonly City[]} */
export const CITIES = Object.freeze([
  // bounds: where walks and stops may lie; region: the wider catalog area with the outskirts.
  freeze({ id: "moscow", name: "Москва", nameEn: "Moscow", inName: "в Москве",
    bounds: { south: 55.48, north: 55.98, west: 37.30, east: 37.95 },
    region: { south: 55.05, north: 56.05, west: 36.75, east: 38.25 },
    center: { lat: 55.752, lon: 37.6175 }, zoom: 14 }),
  // The urban district (OSM relation 3437391) spans 55.603–55.931 N, 48.821–49.381 E.
  freeze({ id: "kazan", name: "Казань", nameEn: "Kazan", inName: "в Казани",
    bounds: { south: 55.60, north: 55.94, west: 48.82, east: 49.39 },
    region: { south: 55.55, north: 55.99, west: 48.77, east: 49.44 },
    center: { lat: 55.7963, lon: 49.1088 }, zoom: 15 }),
]);

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
