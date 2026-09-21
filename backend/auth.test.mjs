import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp,rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { createAuth,authRequestHandler } from "./auth.mjs";
import { createAccountStore } from "./account-store.mjs";

test("Better Auth email and password creates, reads and revokes a Node HTTP session",async t=>{
  const directory=await mkdtemp(join(tmpdir(),"otg-auth-"));
  const runtime=await createAuth({databasePath:join(directory,"auth.sqlite"),baseURL:"http://127.0.0.1",secret:"auth-test-secret-with-more-than-32-characters",production:false});
  const handler=authRequestHandler(runtime.auth),server=createServer(handler);await new Promise(done=>server.listen(0,"127.0.0.1",done));
  const base=`http://127.0.0.1:${server.address().port}/api/auth`,headers={Origin:"http://127.0.0.1","Content-Type":"application/json","X-Real-IP":"127.0.0.1"};
  t.after(async()=>{await new Promise(done=>server.close(done));runtime.close();await rm(directory,{recursive:true,force:true});});
  const shortPassword=await fetch(base+"/sign-up/email",{method:"POST",headers,body:JSON.stringify({name:"Пользователь",email:"short@example.com",password:"short"})});assert.equal(shortPassword.status,400);
  const signUp=await fetch(base+"/sign-up/email",{method:"POST",headers,body:JSON.stringify({name:"Пользователь",email:"User@Example.com",password:"correct-password"})});assert.equal(signUp.status,200);const rawCookie=signUp.headers.getSetCookie().find(v=>v.startsWith("otgolosok.session="));assert.match(rawCookie,/HttpOnly/i);assert.match(rawCookie,/SameSite=Lax/i);assert.match(rawCookie,/Path=\//i);assert.doesNotMatch(rawCookie,/; Secure/i);const cookie=signUp.headers.getSetCookie().map(v=>v.split(";",1)[0]).join("; ");assert.match(cookie,/otgolosok\.session=/);
  const session=await fetch(base+"/get-session",{headers:{Cookie:cookie}});assert.equal((await session.json()).user.email,"user@example.com");
  const invalid=await fetch(base+"/sign-in/email",{method:"POST",headers,body:JSON.stringify({email:"user@example.com",password:"wrong-password"})});assert.equal(invalid.status,401);
  const signIn=await fetch(base+"/sign-in/email",{method:"POST",headers,body:JSON.stringify({email:"user@example.com",password:"correct-password"})});assert.equal(signIn.status,200);
  assert.equal((await fetch(base+"/sign-out",{method:"POST",headers:{...headers,Cookie:cookie},body:"{}"})).status,200);
  assert.equal(await (await fetch(base+"/get-session",{headers:{Cookie:cookie}})).text(),"null");
});

test("production sessions use a __Host cookie",async t=>{
  const directory=await mkdtemp(join(tmpdir(),"otg-auth-production-"));const runtime=await createAuth({databasePath:join(directory,"auth.sqlite"),baseURL:"https://example.test",secret:"production-test-secret-with-more-than-32-characters",production:true});t.after(async()=>{runtime.close();await rm(directory,{recursive:true,force:true});});
  const handler=authRequestHandler(runtime.auth),response=await new Promise(resolve=>{const req={url:"/api/auth/sign-up/email",method:"POST",headers:{host:"example.test",origin:"https://example.test","content-type":"application/json"},[Symbol.asyncIterator]:async function*(){yield Buffer.from(JSON.stringify({name:"Cookie",email:"cookie@example.test",password:"correct-password"}));}};const res={headers:null,status:null,writeHead(status,headers){this.status=status;this.headers=headers;},end(){resolve(this);}};handler(req,res);});
  const cookie=response.headers["set-cookie"].find(value=>value.startsWith("__Host-otgolosok-session="));assert.ok(cookie);assert.match(cookie,/; Secure/i);assert.match(cookie,/; HttpOnly/i);assert.match(cookie,/; SameSite=Lax/i);assert.match(cookie,/; Path=\//i);assert.doesNotMatch(cookie,/; Domain=/i);
});

test("account data is isolated per Better Auth user and updates use revisions",async t=>{
  const runtime=await createAuth({databasePath:":memory:",baseURL:"http://localhost",secret:"account-test-secret-with-more-than-32-characters",production:false});t.after(()=>runtime.close());
  const db=runtime.database,store=createAccountStore(db),time=new Date().toISOString();
  db.prepare("INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt) VALUES(?,?,?,?,?,?)").run("u1","Один","one@example.com",1,time,time);
  db.prepare("INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt) VALUES(?,?,?,?,?,?)").run("u2","Два","two@example.com",1,time,time);
  const walk=store.createWalk("u1",{title:"Арбат",snapshot:{version:1,stops:[]},idempotencyKey:"walk-0001"});assert.equal(store.createWalk("u1",{title:"Арбат",snapshot:{},idempotencyKey:"walk-0001"}).id,walk.id);assert.equal(store.getWalk("u2",walk.id),null);
  const updated=store.updateWalk("u1",walk.id,{title:"Новый Арбат",snapshot:{version:1},revision:0});assert.equal(updated.revision,1);assert.throws(()=>store.updateWalk("u1",walk.id,{title:"Старое",snapshot:{},revision:0}),/./);
  store.setFavorite("u1","walk","paveletskaya");assert.equal(store.listFavorites("u1").favorites.length,1);assert.equal(store.listFavorites("u2").favorites.length,0);
  const imported=store.importLocal("u1",{importId:"import-0001",walk:{title:"С устройства",snapshot:{version:1}}});assert.equal(store.importLocal("u1",{importId:"import-0001"}).walk.id,imported.walk.id);
  assert.equal(store.reserveGeneration("u1","request-0001",3,6),true);assert.equal(store.reserveGeneration("u1","request-0001",3,6),false);assert.throws(()=>store.reserveGeneration("u1","request-0002",4,6),error=>error.code==="QUOTA_EXCEEDED");assert.equal(store.reserveGeneration("u2","request-0002",4,6),true);
});

test("account lists paginate without omissions or duplicates",async t=>{
  let clock=Date.UTC(2026,8,21,12);const runtime=await createAuth({databasePath:":memory:",baseURL:"http://localhost",secret:"pagination-test-secret-with-more-than-32-characters",production:false});t.after(()=>runtime.close());
  const db=runtime.database,store=createAccountStore(db,()=>clock++),time=new Date(clock).toISOString();
  db.prepare("INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt) VALUES(?,?,?,?,?,?)").run("page-user","Страницы","page@example.com",1,time,time);
  for(let index=0;index<21;index++)store.createWalk("page-user",{title:`Прогулка ${index}`,snapshot:{version:1,index},idempotencyKey:`walk-page-${index}`});
  const first=store.listWalks("page-user",20),second=store.listWalks("page-user",20,first.nextCursor);
  assert.equal(first.walks.length,20);assert.equal(second.walks.length,1);assert.equal(new Set([...first.walks,...second.walks].map(walk=>walk.id)).size,21);assert.equal(second.nextCursor,null);
});
