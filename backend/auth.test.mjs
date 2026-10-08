import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp,rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { createAuth,authRequestHandler,AUTH_BODY_LIMIT } from "./auth.mjs";
import { TERMS_VERSION } from "../legal/publication.mjs";
import { createAccountStore } from "./account-store.mjs";

test("Better Auth email and password creates, reads and revokes a Node HTTP session",async t=>{
  const directory=await mkdtemp(join(tmpdir(),"otg-auth-"));
  const runtime=await createAuth({databasePath:join(directory,"auth.sqlite"),baseURL:"http://127.0.0.1",secret:"auth-test-secret-with-more-than-32-characters",production:false,legalReady:true});
  const handler=authRequestHandler(runtime.auth),server=createServer(handler);await /** @type {Promise<void>} */ (new Promise(done=>server.listen(0,"127.0.0.1",done)));
  const base=`http://127.0.0.1:${/** @type {import("node:net").AddressInfo} */ (server.address()).port}/api/auth`,headers={Origin:"http://127.0.0.1","Content-Type":"application/json","X-Real-IP":"127.0.0.1"};
  t.after(async()=>{await new Promise(done=>server.close(done));runtime.close();await rm(directory,{recursive:true,force:true});});
  const shortPassword=await fetch(base+"/sign-up/email",{method:"POST",headers,body:JSON.stringify({name:"Пользователь",email:"short@example.com",password:"short",termsAccepted:true,termsVersion:TERMS_VERSION})});assert.equal(shortPassword.status,400);
  const signUp=await fetch(base+"/sign-up/email",{method:"POST",headers,body:JSON.stringify({name:"Пользователь",email:"User@Example.com",password:"correct-password",termsAccepted:true,termsVersion:TERMS_VERSION})});assert.equal(signUp.status,200);const rawCookie=signUp.headers.getSetCookie().find(v=>v.startsWith("otgolosok.session="));assert.match(rawCookie,/HttpOnly/i);assert.match(rawCookie,/SameSite=Lax/i);assert.match(rawCookie,/Path=\//i);assert.doesNotMatch(rawCookie,/; Secure/i);const cookie=signUp.headers.getSetCookie().map(v=>v.split(";",1)[0]).join("; ");assert.match(cookie,/otgolosok\.session=/);
  const session=await fetch(base+"/get-session",{headers:{Cookie:cookie}});assert.equal(/** @type {any} */ (await session.json()).user.email,"user@example.com");
  const invalid=await fetch(base+"/sign-in/email",{method:"POST",headers,body:JSON.stringify({email:"user@example.com",password:"wrong-password"})});assert.equal(invalid.status,401);
  const signIn=await fetch(base+"/sign-in/email",{method:"POST",headers,body:JSON.stringify({email:"user@example.com",password:"correct-password"})});assert.equal(signIn.status,200);
  assert.equal((await fetch(base+"/sign-out",{method:"POST",headers:{...headers,Cookie:cookie},body:"{}"})).status,200);
  assert.equal(await (await fetch(base+"/get-session",{headers:{Cookie:cookie}})).text(),"null");
});

test("production sessions use a __Host cookie",async t=>{
  const directory=await mkdtemp(join(tmpdir(),"otg-auth-production-"));const runtime=await createAuth({databasePath:join(directory,"auth.sqlite"),baseURL:"https://example.test",secret:"production-test-secret-with-more-than-32-characters",production:true,legalReady:true});t.after(async()=>{runtime.close();await rm(directory,{recursive:true,force:true});});
  const handler=authRequestHandler(runtime.auth),response=await new Promise(resolve=>{const req={url:"/api/auth/sign-up/email",method:"POST",headers:{host:"example.test",origin:"https://example.test","content-type":"application/json"},[Symbol.asyncIterator]:async function*(){yield Buffer.from(JSON.stringify({name:"Cookie",email:"cookie@example.test",password:"correct-password",termsAccepted:true,termsVersion:TERMS_VERSION}));}};const res={headers:null,status:null,writeHead(status,headers){this.status=status;this.headers=headers;},end(){resolve(this);}};handler(req,res);});
  const cookie=response.headers["set-cookie"].find(value=>value.startsWith("__Host-otgolosok-session="));assert.ok(cookie);assert.match(cookie,/; Secure/i);assert.match(cookie,/; HttpOnly/i);assert.match(cookie,/; SameSite=Lax/i);assert.match(cookie,/; Path=\//i);assert.doesNotMatch(cookie,/; Domain=/i);
});

test("account data is isolated per Better Auth user and updates use revisions",async t=>{
  const runtime=await createAuth({databasePath:":memory:",baseURL:"http://localhost",secret:"account-test-secret-with-more-than-32-characters",production:false,legalReady:true});t.after(()=>runtime.close());
  const db=runtime.database,store=createAccountStore(db),time=new Date().toISOString();
  db.prepare("INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt) VALUES(?,?,?,?,?,?)").run("u1","Один","one@example.com",1,time,time);
  db.prepare("INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt) VALUES(?,?,?,?,?,?)").run("u2","Два","two@example.com",1,time,time);
  const draft={version:1,title:"Арбат",start:null,stops:[],mode:"loop",minutes:30,route:null,jobs:[],submitting:null};
  const walk=store.createWalk("u1",{title:"Арбат",snapshot:draft,idempotencyKey:"walk-0001"});assert.equal(store.createWalk("u1",{title:"Арбат",snapshot:draft,idempotencyKey:"walk-0001"}).id,walk.id);assert.equal(store.getWalk("u2",walk.id),null);
  assert.throws(()=>store.createWalk("u1",{title:"Подмена",snapshot:draft,idempotencyKey:"walk-0001"}),/** @param {Error & {code?: string}} error */ error=>error.code==="CONFLICT");
  const updated=store.updateWalk("u1",walk.id,{title:"Новый Арбат",snapshot:{...draft,title:"Новый Арбат"},revision:0});assert.equal(updated.revision,1);assert.throws(()=>store.updateWalk("u1",walk.id,{title:"Старое",snapshot:draft,revision:0}),/./);
  store.setFavorite("u1","walk","paveletskaya");assert.equal(store.listFavorites("u1").favorites.length,1);assert.equal(store.listFavorites("u2").favorites.length,0);
  const imported=store.importLocal("u1",{importId:"import-0001",walk:{title:"С устройства",snapshot:{...draft,title:"С устройства"}}});assert.equal(store.importLocal("u1",{importId:"import-0001"}).walk.id,imported.walk.id);
  assert.equal(store.reserveGeneration("u1","request-0001",3,6),true);assert.equal(store.reserveGeneration("u1","request-0001",3,6),false);assert.throws(()=>store.reserveGeneration("u1","request-0002",4,6),/** @param {Error & {code?: string}} error */ error=>error.code==="QUOTA_EXCEEDED");assert.equal(store.reserveGeneration("u2","request-0002",4,6),true);
});

test("account lists paginate without omissions or duplicates",async t=>{
  let clock=Date.UTC(2026,8,21,12);const runtime=await createAuth({databasePath:":memory:",baseURL:"http://localhost",secret:"pagination-test-secret-with-more-than-32-characters",production:false,legalReady:true});t.after(()=>runtime.close());
  const db=runtime.database,store=createAccountStore(db,()=>clock++),time=new Date(clock).toISOString();
  db.prepare("INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt) VALUES(?,?,?,?,?,?)").run("page-user","Страницы","page@example.com",1,time,time);
  for(let index=0;index<21;index++)store.createWalk("page-user",{title:`Прогулка ${index}`,snapshot:{version:1,title:`Прогулка ${index}`,start:null,stops:[],mode:"loop",minutes:30,route:null,jobs:[],submitting:null},idempotencyKey:`walk-page-${index}`});
  const first=store.listWalks("page-user",20),second=store.listWalks("page-user",20,first.nextCursor);
  assert.equal(first.walks.length,20);assert.equal(second.walks.length,1);assert.equal(new Set([...first.walks,...second.walks].map(walk=>walk.id)).size,21);assert.equal(second.nextCursor,null);
});

test("walk storage migrates legacy snapshots, keeps account IDs addressable and preserves CAS sharing", async t => {
  const runtime=await createAuth({databasePath:":memory:",baseURL:"http://localhost",secret:"walk-storage-test-secret-with-more-than-32-characters",production:false,legalReady:true});
  t.after(()=>runtime.close());
  const db=runtime.database,store=createAccountStore(db),time=new Date().toISOString();
  db.prepare("INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt) VALUES(?,?,?,?,?,?)").run("walk-user","Пользователь","walk@example.com",1,time,time);
  const legacy={version:1,title:"Старый маршрут",start:{address:"Москва, Арбат, 1",location:{lat:55.75,lon:37.60}},stops:[{address:"Москва, Арбат, 10",location:{lat:55.751,lon:37.601}}],mode:"open",minutes:30,route:null,jobs:[],submitting:null};
  const migrated=store.createWalk("walk-user",{title:legacy.title,snapshot:legacy,idempotencyKey:"legacy-walk-1"});
  assert.equal(migrated.snapshot.version,2);assert.equal(migrated.snapshot.id,migrated.id);
  const accountDocument={version:2,id:"77777777-7777-4777-8777-777777777777",title:"Свой маршрут",description:"",city:"Москва",mode:"open",minutes:30,
    start:{address:"Москва, Арбат, 1",location:{lat:55.75,lon:37.60}},stops:[{id:"88888888-8888-4888-8888-888888888888",place:{address:"Москва, Арбат, 10",location:{lat:55.751,lon:37.601}},storyRef:null,transition:"",nextHint:""}],route:null,fieldChecked:false};
  const created=store.createWalk("walk-user",{title:accountDocument.title,snapshot:accountDocument,idempotencyKey:"account-walk-1"});
  assert.match(created.id,/^[a-f0-9-]{36}$/);assert.equal(created.id,accountDocument.id);assert.equal(created.snapshot.id,created.id);
  assert.throws(()=>store.createWalk("walk-user",{title:"Другой маршрут",snapshot:accountDocument,idempotencyKey:"account-walk-1"}),/** @param {Error & {code?: string}} error */ error=>error.code==="CONFLICT");
  const shared=store.setWalkVisibility("walk-user",created.id,created.revision,"shared");
  assert.equal(shared.visibility,"shared");assert.match(shared.shareToken,/^[a-f0-9-]{36}$/);
  assert.throws(()=>store.setWalkVisibility("walk-user",created.id,created.revision,"private"),/** @param {Error & {code?: string}} error */ error=>error.code==="CONFLICT");
  const token=shared.shareToken,changed=store.updateWalk("walk-user",created.id,{title:"Переименованный маршрут",snapshot:{...created.snapshot,title:"Переименованный маршрут"},revision:shared.revision});
  assert.equal(store.getSharedWalk(token).title,"Переименованный маршрут");
  assert.equal(store.setWalkVisibility("walk-user",created.id,changed.revision,"private").visibility,"private");
  assert.equal(store.getSharedWalk(token),null);
  const reenabled=store.setWalkVisibility("walk-user",created.id,changed.revision+1,"shared");
  assert.equal(reenabled.shareToken,token);
  assert.equal(store.setWalkVisibility("walk-user",created.id,changed.revision,"shared").shareToken,token);
});

test("oversized auth bodies are refused with 413 before Better Auth reads them",async t=>{
  const runtime=await createAuth({databasePath:":memory:",baseURL:"http://127.0.0.1",secret:"auth-limit-secret-with-more-than-32-characters",production:false,legalReady:true});
  const server=createServer(authRequestHandler(runtime.auth));await /** @type {Promise<void>} */ (new Promise(done=>server.listen(0,"127.0.0.1",done)));
  t.after(async()=>{server.closeAllConnections();await new Promise(done=>server.close(done));runtime.close();});
  const url=`http://127.0.0.1:${/** @type {import("node:net").AddressInfo} */ (server.address()).port}/api/auth/sign-in/email`,headers={Origin:"http://127.0.0.1","Content-Type":"application/json","X-Real-IP":"127.0.0.1"};
  const padded=size=>JSON.stringify({email:"user@example.com",password:"correct-password",padding:"x".repeat(size)});
  const announced=await fetch(url,{method:"POST",headers,body:padded(AUTH_BODY_LIMIT)});
  assert.equal(announced.status,413);assert.equal(/** @type {any} */ (await announced.json()).code,"PAYLOAD_TOO_LARGE");
  // Without Content-Length the streamed bytes are counted.
  const bytes=new TextEncoder().encode(padded(AUTH_BODY_LIMIT));
  const streamed=await fetch(url,{method:"POST",headers,duplex:"half",body:new ReadableStream({start(controller){controller.enqueue(bytes);controller.close();}})});
  assert.equal(streamed.status,413);
  const small=await fetch(url,{method:"POST",headers,body:padded(10)});
  assert.equal(small.status,401);
});


test("registration requires an explicit current agreement and stores server evidence atomically", async t => {
  const runtime = await createAuth({databasePath: ":memory:", baseURL: "http://localhost", production: false, legalReady: true});
  t.after(() => runtime.close());
  let clientIp = 0;
  const send = body => runtime.auth.handler(new Request("http://localhost/api/auth/sign-up/email", {
    method: "POST", headers: {Origin: "http://localhost", "Content-Type": "application/json", "X-Real-IP": `10.0.0.${++clientIp}`}, body: JSON.stringify(body),
  }));
  const user = {name: "Тест", email: "legal@example.test", password: "correct-password"};
  for (const fields of [{}, {termsAccepted: false, termsVersion: TERMS_VERSION}, {termsAccepted: "true", termsVersion: TERMS_VERSION}, {termsAccepted: true, termsVersion: "old"}]) {
    const response = await send({...user, ...fields});
    assert.equal(response.status, 400);
    assert.equal((/** @type {any} */ (await response.json())).code, "TERMS_REQUIRED");
    assert.equal(runtime.database.prepare("SELECT count(*) AS count FROM user").get().count, 0);
  }
  const before = Date.now();
  const accepted = await send({...user, termsAccepted: true, termsVersion: TERMS_VERSION, termsAcceptedAt: "2000-01-01"});
  assert.equal(accepted.status, 200);
  const result = /** @type {any} */ (await accepted.json());
  const stored = runtime.database.prepare("SELECT termsVersion, termsAcceptedAt FROM user WHERE id=?").get(result.user.id);
  assert.equal(stored.termsVersion, TERMS_VERSION);
  assert.ok(Date.parse(String(stored.termsAcceptedAt)) >= before && Date.parse(String(stored.termsAcceptedAt)) <= Date.now());
  assert.equal(result.user.termsVersion, undefined);
  const cookie = accepted.headers.getSetCookie().map(value => value.split(";", 1)[0]).join("; ");
  const update = await runtime.auth.handler(new Request("http://localhost/api/auth/update-user", {method: "POST", headers: {Origin: "http://localhost", "Content-Type": "application/json", Cookie: cookie}, body: JSON.stringify({termsVersion: "forged", termsAcceptedAt: "2000-01-01"})}));
  assert.equal(update.status, 400);
  assert.deepEqual(runtime.database.prepare("SELECT termsVersion, termsAcceptedAt FROM user WHERE id=?").get(result.user.id), stored);
  assert.equal(runtime.database.prepare("SELECT count(*) AS count FROM account").get().count, 1);
});

test("unpublished legal documents prevent registration but preserve existing sign-in", async t => {
  const directory = await mkdtemp(join(tmpdir(), "otg-auth-legal-migration-"));
  const databasePath = join(directory, "auth.sqlite");
  const previous = await createAuth({databasePath, baseURL: "http://localhost", production: false, legalReady: true});
  try {
    await previous.auth.api.signUpEmail({body: /** @type {any} */ ({name: "Существующий", email: "existing@example.test", password: "correct-password", termsAccepted: true, termsVersion: TERMS_VERSION})});
    // Reproduce the schema that is currently deployed, before legal evidence.
    previous.database.exec("ALTER TABLE user DROP COLUMN termsVersion; ALTER TABLE user DROP COLUMN termsAcceptedAt");
  } finally {previous.close();}
  const runtime = await createAuth({databasePath, baseURL: "http://localhost", production: false, legalReady: false});
  t.after(async () => {runtime.close();await rm(directory, {recursive: true, force: true});});
  assert.deepEqual({...runtime.database.prepare("SELECT termsVersion,termsAcceptedAt FROM user WHERE email='existing@example.test'").get()}, {termsVersion: null, termsAcceptedAt: null});
  const response = await runtime.auth.handler(new Request("http://localhost/api/auth/sign-up/email", {method: "POST", headers: {Origin: "http://localhost", "Content-Type": "application/json"}, body: JSON.stringify({name: "Тест", email: "blocked@example.test", password: "correct-password", termsAccepted: true, termsVersion: TERMS_VERSION})}));
  assert.equal(response.status, 503);
  assert.equal((/** @type {any} */ (await response.json())).code, "LEGAL_UNAVAILABLE");
  assert.equal(runtime.database.prepare("SELECT count(*) AS count FROM user").get().count, 1);
  const signIn = await runtime.auth.handler(new Request("http://localhost/api/auth/sign-in/email", {method: "POST", headers: {Origin: "http://localhost", "Content-Type": "application/json"}, body: JSON.stringify({email: "existing@example.test", password: "correct-password"})}));
  assert.equal(signIn.status, 200);
  assert.equal((/** @type {any} */ (await signIn.json())).user.email, "existing@example.test");
});
