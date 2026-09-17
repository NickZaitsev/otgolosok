import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";

const email=process.argv[2]?.trim().toLowerCase();
if(!email)throw new Error("Usage: node scripts/set-editor.mjs editor@example.com [database]");
const databasePath=resolve(process.argv[3]??process.env.AUTH_DB_PATH??"backend/data/auth.sqlite");
const db=new DatabaseSync(databasePath,{timeout:5000});
try{const row=db.prepare("SELECT id,email FROM user WHERE lower(email)=?").get(email);if(!row)throw new Error("Confirmed user not found");db.prepare("UPDATE user SET role='editor',updatedAt=? WHERE id=?").run(new Date().toISOString(),row.id);console.log(`Editor role granted: ${row.email} (${row.id})`);}finally{db.close();}
