import { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const foodPlace={id:"osm:node:2",kind:"coffee",name:"Кофейня",lat:55.75,lon:37.62,address:"Мясницкая улица, 1",openingHours:"Mo-Su 09:00-22:00",cuisine:"coffee_shop",website:"https://example.test",phone:"+7 000 000-00-00"};
export const foodMeta={format_version:"1",source_edited_at:"2026-10-02T10:00:00Z",attribution:"© OpenStreetMap contributors"};

/** Mirrors the format built by scripts/build-osm-food-index.py, including snake_case SQLite columns. */
export async function foodIndexFixture(t,places=[foodPlace],meta={}) {
  const directory=await mkdtemp(join(tmpdir(),"food-index-")),path=join(directory,"osm-food.sqlite");
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const db=new DatabaseSync(path);
  try {
    db.exec("CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE places(id TEXT PRIMARY KEY,kind TEXT NOT NULL,name TEXT NOT NULL,lat REAL NOT NULL,lon REAL NOT NULL,address TEXT,opening_hours TEXT,cuisine TEXT,website TEXT,phone TEXT);");
    const insert=db.prepare("INSERT INTO places VALUES(?,?,?,?,?,?,?,?,?,?)");
    for(const row of places)insert.run(row.id,row.kind,row.name,row.lat,row.lon,row.address,row.openingHours,row.cuisine,row.website,row.phone);
    const metadata=db.prepare("INSERT INTO meta VALUES(?,?)");
    for(const [key,value] of Object.entries({...foodMeta,...meta}))metadata.run(key,value);
  } finally { db.close(); }
  return path;
}
