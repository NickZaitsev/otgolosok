#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve,join } from "node:path";
import { CITIES } from "../backend/cities.mjs";
import { createStore } from "../backend/store.mjs";

const file=process.argv[2];
if(!file)throw new Error("Usage: node scripts/load-osm-catalog.mjs <catalog.json> [--complete]");
const catalog=JSON.parse(await readFile(resolve(file),"utf8"));
const complete=process.argv.includes("--complete");
// A complete import archives the absent places of one city, so its catalog must be clipped to that city's boundary.
if(complete&&!CITIES.some(city=>catalog.coverage===`${city.id}-admin`))throw new Error("--complete requires a catalog clipped to a verified <city>-admin coverage");
if(complete&&(!catalog.boundary?.sha256||!/^[a-f0-9]{64}$/.test(catalog.boundary.sha256)))throw new Error("--complete requires verified boundary checksum metadata");
const directory=resolve(process.env.DATA_DIR??"backend/data");
const store=createStore(join(directory,"jobs.sqlite"));
try {console.log(JSON.stringify(store.importPlaces(catalog,{complete}),null,2));}
finally {store.close();}
