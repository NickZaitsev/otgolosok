import { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const parkingPlace={id:"osm:way:2",name:"Парковка у музея",location:{lat:55.75,lon:37.62},entrance:{lat:55.7501,lon:37.6201},exit:{lat:55.7501,lon:37.6201},pedestrianAccess:{lat:55.7501,lon:37.6201},access:"public",fee:true,openingHours:"24/7"};
export const parkingMeta={format_version:"1",source_edited_at:"2026-10-02T10:00:00Z",attribution:"© OpenStreetMap contributors"};

export async function parkingIndexFixture(t,places=[parkingPlace],meta={}) {
  const directory=await mkdtemp(join(tmpdir(),"parking-index-")),path=join(directory,"osm-parking.sqlite");
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const db=new DatabaseSync(path);
  try {
    db.exec(`CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE places(
      id TEXT PRIMARY KEY,name TEXT,lat REAL NOT NULL,lon REAL NOT NULL,entrance_lat REAL NOT NULL,entrance_lon REAL NOT NULL,
      access TEXT NOT NULL,fee TEXT NOT NULL,opening_hours TEXT,capacity INTEGER,entrance_id TEXT NOT NULL,route_point_kind TEXT NOT NULL,operator TEXT);`);
    const insert=db.prepare("INSERT INTO places VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)");
    for(const row of places)insert.run(row.id,row.name,row.location.lat,row.location.lon,row.entrance.lat,row.entrance.lon,row.access,
      row.fee===true?"yes":row.fee===false?"no":"unknown",row.openingHours,null,"osm:node:1","entrance",null);
    const metadata=db.prepare("INSERT INTO meta VALUES(?,?)");
    for(const [key,value] of Object.entries({...parkingMeta,...meta}))metadata.run(key,value);
  } finally {db.close();}
  return path;
}
