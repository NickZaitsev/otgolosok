import { createHmac, randomInt, randomUUID, timingSafeEqual } from "node:crypto";

const encode = JSON.stringify;
const decode = value => JSON.parse(value);
const cleanName = value => {
  if (typeof value !== "string") throw Object.assign(new Error("Invalid name"), { code: "BAD_REQUEST" });
  const name = value.trim().replace(/\s+/g, " ");
  if (!name || name.length > 80 || /[\p{Cc}\p{Cf}<>]/u.test(name)) throw Object.assign(new Error("Invalid name"), { code: "BAD_REQUEST" });
  return name;
};
const cleanTitle = value => {
  if (typeof value !== "string") throw Object.assign(new Error("Invalid title"), { code: "BAD_REQUEST" });
  const title = value.trim().replace(/\s+/g, " ");
  if (!title || title.length > 120 || /[\p{Cc}\p{Cf}<>]/u.test(title)) throw Object.assign(new Error("Invalid title"), { code: "BAD_REQUEST" });
  return title;
};
const validateSnapshot = snapshot => {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot) || encode(snapshot).length > 100_000) throw Object.assign(new Error("Invalid walk"), { code: "BAD_REQUEST" });
  return snapshot;
};

export function createAccountStore(db, now = Date.now, secret = "development-only-account-secret") {
  db.exec(`PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS user_walks (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
      title TEXT NOT NULL, snapshot_json TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS user_walks_owner_updated ON user_walks(user_id,updated_at DESC,id DESC);
    CREATE TABLE IF NOT EXISTS user_favorites (
      user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE, object_type TEXT NOT NULL,
      object_id TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(user_id,object_type,object_id)
    );
    CREATE TABLE IF NOT EXISTS user_generation_requests (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
      job_id TEXT NOT NULL, operation TEXT NOT NULL, idempotency_key TEXT NOT NULL, created_at TEXT NOT NULL,
      UNIQUE(user_id,idempotency_key)
    );
    CREATE INDEX IF NOT EXISTS user_requests_owner_created ON user_generation_requests(user_id,created_at DESC,id DESC);
    CREATE TABLE IF NOT EXISTS account_imports (
      user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE, import_id TEXT NOT NULL,
      result_json TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(user_id,import_id)
    );
    CREATE TABLE IF NOT EXISTS user_walk_idempotency (
      user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE, idempotency_key TEXT NOT NULL,
      walk_id TEXT NOT NULL REFERENCES user_walks(id) ON DELETE CASCADE, PRIMARY KEY(user_id,idempotency_key)
    );
    CREATE TABLE IF NOT EXISTS user_generation_quota (
      user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE, request_id TEXT NOT NULL,
      units INTEGER NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(user_id,request_id)
    );
    CREATE INDEX IF NOT EXISTS user_generation_quota_owner_created ON user_generation_quota(user_id,created_at);
    CREATE TABLE IF NOT EXISTS account_delete_codes (
      user_id TEXT PRIMARY KEY REFERENCES user(id) ON DELETE CASCADE, code_hash TEXT NOT NULL,
      expires_at TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0
    );`);
  const timestamp = () => new Date(now()).toISOString();
  const cursor = value => { if(!value)return null;try{const parsed=decode(Buffer.from(value,"base64url").toString());if(typeof parsed.time!=="string"||typeof parsed.id!=="string")throw new Error();return parsed;}catch{throw Object.assign(new Error("Invalid cursor"),{code:"BAD_REQUEST"});} };
  const page = (rows,limit,map) => ({items:rows.slice(0,limit).map(map),nextCursor:rows.length>limit?Buffer.from(encode({time:rows[limit-1].updated_at??rows[limit-1].created_at,id:rows[limit-1].id??`${rows[limit-1].object_type}:${rows[limit-1].object_id}`})).toString("base64url"):null});
  const viewWalk = row => row && ({ id: row.id, title: row.title, snapshot: decode(row.snapshot_json), revision: Number(row.revision), createdAt: row.created_at, updatedAt: row.updated_at });
  return {
    updateProfile(userId, name) { const value=cleanName(name),time=timestamp();db.prepare("UPDATE user SET name=?,updatedAt=? WHERE id=?").run(value,time,userId);return value; },
    listWalks(userId, limit=20,after=null) { limit=Math.min(50,Math.max(1,limit));const c=cursor(after),rows=c?db.prepare("SELECT * FROM user_walks WHERE user_id=? AND (updated_at<? OR (updated_at=? AND id<?)) ORDER BY updated_at DESC,id DESC LIMIT ?").all(userId,c.time,c.time,c.id,limit+1):db.prepare("SELECT * FROM user_walks WHERE user_id=? ORDER BY updated_at DESC,id DESC LIMIT ?").all(userId,limit+1);const result=page(rows,limit,viewWalk);return {walks:result.items,nextCursor:result.nextCursor,hasMore:Boolean(result.nextCursor)}; },
    getWalk(userId,id) { return viewWalk(db.prepare("SELECT * FROM user_walks WHERE id=? AND user_id=?").get(id,userId)) ?? null; },
    createWalk(userId,{title,snapshot,idempotencyKey}) { if(typeof idempotencyKey!=="string"||!/^[\w.-]{8,100}$/.test(idempotencyKey))throw Object.assign(new Error(),{code:"BAD_REQUEST"});const prior=db.prepare("SELECT w.* FROM user_walk_idempotency i JOIN user_walks w ON w.id=i.walk_id WHERE i.user_id=? AND i.idempotency_key=?").get(userId,idempotencyKey);if(prior)return viewWalk(prior);const id=randomUUID(),time=timestamp();db.exec("BEGIN IMMEDIATE");try{db.prepare("INSERT INTO user_walks VALUES(?,?,?,?,0,?,?)").run(id,userId,cleanTitle(title),encode(validateSnapshot(snapshot)),time,time);db.prepare("INSERT INTO user_walk_idempotency VALUES(?,?,?)").run(userId,idempotencyKey,id);db.exec("COMMIT");}catch(error){db.exec("ROLLBACK");throw error;}return this.getWalk(userId,id); },
    updateWalk(userId,id,{title,snapshot,revision}) { if(!Number.isSafeInteger(revision)||revision<0)throw Object.assign(new Error(),{code:"BAD_REQUEST"});const result=db.prepare("UPDATE user_walks SET title=?,snapshot_json=?,revision=revision+1,updated_at=? WHERE id=? AND user_id=? AND revision=?").run(cleanTitle(title),encode(validateSnapshot(snapshot)),timestamp(),id,userId,revision);if(!result.changes){if(!this.getWalk(userId,id))return null;throw Object.assign(new Error(),{code:"CONFLICT"});}return this.getWalk(userId,id); },
    deleteWalk(userId,id) { return db.prepare("DELETE FROM user_walks WHERE id=? AND user_id=?").run(id,userId).changes>0; },
    listFavorites(userId,limit=50,after=null) { limit=Math.min(50,Math.max(1,limit));const c=cursor(after);const rows=c?db.prepare("SELECT object_type,object_id,created_at FROM user_favorites WHERE user_id=? AND (created_at<? OR (created_at=? AND (object_type||':'||object_id)<?)) ORDER BY created_at DESC,object_type||':'||object_id DESC LIMIT ?").all(userId,c.time,c.time,c.id,limit+1):db.prepare("SELECT object_type,object_id,created_at FROM user_favorites WHERE user_id=? ORDER BY created_at DESC,object_type||':'||object_id DESC LIMIT ?").all(userId,limit+1);const result=page(rows,limit,row=>({type:row.object_type,id:row.object_id,createdAt:row.created_at}));return {favorites:result.items,nextCursor:result.nextCursor}; },
    setFavorite(userId,type,id) { if(!["story","walk"].includes(type)||typeof id!=="string"||id.length>128)throw Object.assign(new Error(),{code:"BAD_REQUEST"});db.prepare("INSERT OR IGNORE INTO user_favorites VALUES(?,?,?,?)").run(userId,type,id,timestamp()); },
    deleteFavorite(userId,type,id) { db.prepare("DELETE FROM user_favorites WHERE user_id=? AND object_type=? AND object_id=?").run(userId,type,id); },
    reserveGeneration(userId,requestId,units=1,limit=6) {if(typeof requestId!=="string"||requestId.length<8||!Number.isSafeInteger(units)||units<1)throw Object.assign(new Error(),{code:"BAD_REQUEST"});const existing=db.prepare("SELECT units FROM user_generation_quota WHERE user_id=? AND request_id=?").get(userId,requestId);if(existing)return false;const since=new Date(now()-86400000).toISOString(),used=db.prepare("SELECT COALESCE(SUM(units),0) AS value FROM user_generation_quota WHERE user_id=? AND created_at>=?").get(userId,since).value;if(used+units>limit)throw Object.assign(new Error("Personal daily quota exceeded"),{code:"QUOTA_EXCEEDED"});db.prepare("INSERT INTO user_generation_quota VALUES(?,?,?,?)").run(userId,requestId,units,timestamp());return true; },
    releaseGeneration(userId,requestId) {db.prepare("DELETE FROM user_generation_quota WHERE user_id=? AND request_id=?").run(userId,requestId);},
    attachRequest(userId,jobId,operation,idempotencyKey) { const existing=db.prepare("SELECT job_id FROM user_generation_requests WHERE user_id=? AND idempotency_key=?").get(userId,idempotencyKey);if(existing)return existing.job_id;db.prepare("INSERT INTO user_generation_requests VALUES(?,?,?,?,?,?)").run(randomUUID(),userId,jobId,operation,idempotencyKey,timestamp());return jobId; },
    ownsRequest(userId,jobId) { return Boolean(db.prepare("SELECT 1 FROM user_generation_requests WHERE user_id=? AND job_id=?").get(userId,jobId)); },
    listRequests(userId,limit=50,after=null) {limit=Math.min(50,Math.max(1,limit));const c=cursor(after);const rows=c?db.prepare("SELECT id,job_id,operation,created_at FROM user_generation_requests WHERE user_id=? AND (created_at<? OR (created_at=? AND id<?)) ORDER BY created_at DESC,id DESC LIMIT ?").all(userId,c.time,c.time,c.id,limit+1):db.prepare("SELECT id,job_id,operation,created_at FROM user_generation_requests WHERE user_id=? ORDER BY created_at DESC,id DESC LIMIT ?").all(userId,limit+1);const result=page(rows,limit,row=>({jobId:row.job_id,operation:row.operation,createdAt:row.created_at}));return {requests:result.items,nextCursor:result.nextCursor}; },
    researchJobIds(userId) {return db.prepare("SELECT job_id FROM user_generation_requests WHERE user_id=? AND operation='walk_research'").all(userId).map(row=>row.job_id);},
    importLocal(userId,{importId,walk=null,favorites=[]}) { if(typeof importId!=="string"||!/^[\w.-]{8,100}$/.test(importId)||!Array.isArray(favorites)||favorites.length>100)throw Object.assign(new Error(),{code:"BAD_REQUEST"});const existing=db.prepare("SELECT result_json FROM account_imports WHERE user_id=? AND import_id=?").get(userId,importId);if(existing)return decode(existing.result_json);const result={walk:null,favorites:0};if(walk)result.walk=this.createWalk(userId,{...walk,idempotencyKey:`import-${importId}`});for(const item of favorites){this.setFavorite(userId,item.type,item.id);result.favorites++;}db.prepare("INSERT INTO account_imports VALUES(?,?,?,?)").run(userId,importId,encode(result),timestamp());return result; },
    issueDeleteCode(userId) {const code=String(randomInt(0,1_000_000)).padStart(6,"0"),hash=createHmac("sha256",secret).update(`${userId}:${code}`).digest("hex"),expires=new Date(now()+600000).toISOString();db.prepare("INSERT INTO account_delete_codes(user_id,code_hash,expires_at,attempts) VALUES(?,?,?,0) ON CONFLICT(user_id) DO UPDATE SET code_hash=excluded.code_hash,expires_at=excluded.expires_at,attempts=0").run(userId,hash,expires);return code;},
    verifyDeleteCode(userId,code) {const row=db.prepare("SELECT * FROM account_delete_codes WHERE user_id=?").get(userId);if(!row||row.attempts>=5||new Date(row.expires_at).getTime()<now())return false;db.prepare("UPDATE account_delete_codes SET attempts=attempts+1 WHERE user_id=?").run(userId);const expected=Buffer.from(row.code_hash,"hex"),actual=Buffer.from(createHmac("sha256",secret).update(`${userId}:${String(code)}`).digest("hex"),"hex");if(actual.length!==expected.length||!timingSafeEqual(actual,expected))return false;db.prepare("DELETE FROM account_delete_codes WHERE user_id=?").run(userId);return true;},
    deleteAccountData(userId) { db.exec("BEGIN IMMEDIATE");try{db.prepare("DELETE FROM user WHERE id=?").run(userId);db.exec("COMMIT");}catch(error){db.exec("ROLLBACK");throw error;} },
  };
}
