import test from "node:test";
import assert from "node:assert/strict";
import { gunzipSync } from "node:zlib";
import { createBackendLogger } from "./logs.mjs";

test("Airouter backend logging is disabled without a token",()=>{
  assert.equal(createBackendLogger({token:""}),null);
});

test("Airouter backend logger sends redacted, gzipped events",async()=>{
  const requests=[];
  const logs=createBackendLogger({token:"test-token",endpoint:"https://airouter.test",environment:"test",fetch:async(url,options)=>{
    requests.push({url,options});
    return new Response(null,{status:202});
  }});
  logs.captureException(new Error("Bearer abc.def"),{operation:"runJob",context:{jobId:"job-1",password:"hidden"}});
  await logs.close();
  assert.equal(requests.length,1);
  assert.equal(requests[0].url,"https://airouter.test/api/products/log-batches");
  assert.equal(requests[0].options.headers.Authorization,"Bearer test-token");
  const payload=JSON.parse(gunzipSync(requests[0].options.body).toString());
  assert.equal(requests[0].options.headers["Idempotency-Key"],payload.batchKey);
  assert.equal(payload.source.service,"otgolosok-backend");
  assert.equal(payload.events[0].context.password,"[REDACTED]");
  assert.ok(!JSON.stringify(payload).includes("abc.def"));
});
