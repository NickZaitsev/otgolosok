#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve,join } from "node:path";
import { createStore } from "../backend/store.mjs";

const file=process.argv[2];
if(!file)throw new Error("Usage: node scripts/load-osm-catalog.mjs <catalog.json> [--complete]");
const catalog=JSON.parse(await readFile(resolve(file),"utf8"));
const directory=resolve(process.env.DATA_DIR??"backend/data");
const store=createStore(join(directory,"jobs.sqlite"));
try {console.log(JSON.stringify(store.importPlaces(catalog,{complete:process.argv.includes("--complete")}),null,2));}
finally {store.close();}
