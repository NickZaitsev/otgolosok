import test from "node:test";
import assert from "node:assert/strict";
import { createProvider, providerStatusCode, PROVIDER_OUTAGE_CODES } from "./provider.mjs";

test("uses the requested writer model and records the actual model used",async()=>{
  const requests=[];
  const provider=createProvider({baseUrl:"https://provider.example/v1",apiKey:"test-key",fetchImpl:async(url,options)=>{
    requests.push({url,body:JSON.parse(options.body)});
    return new Response(JSON.stringify({status:"completed",output:[{type:"message",content:[{type:"output_text",text:'{"valid":true}'}]}]}),{headers:{"Content-Type":"application/json"}});
  }});
  const review=await provider.response("Review supplied evidence");
  const draft=await provider.response("Write from supplied facts",{model:provider.writerModel});
  assert.equal(requests[0].body.model,"codex/gpt-5.6-sol-medium");
  assert.equal(requests[1].body.model,"codex/gpt-5.6-sol-low");
  assert.equal(review.model,requests[0].body.model);
  assert.equal(draft.model,requests[1].body.model);
  assert.equal(requests[1].url,"https://provider.example/v1/responses");
  assert.equal(draft.text,'{"valid":true}');
});

test("OpenAI uses each job's selected voice without changing the shared default", async () => {
  const voices = [];
  const provider = createProvider({ baseUrl: "https://provider.example/v1", apiKey: "key", fetchImpl: async (_url, options) => {
    voices.push(JSON.parse(options.body).voice);
    return new Response("mp3", { headers: { "Content-Type": "audio/mpeg" } });
  } });
  await Promise.all([provider.speech("Первый рассказ", { voice: "cedar" }), provider.speech("Второй рассказ", { voice: "nova" })]);
  await provider.speech("Рассказ с голосом по умолчанию");
  assert.deepEqual(voices, ["cedar", "nova", "marin"]);
  assert.equal(provider.voice, "marin");
});

test("provider HTTP statuses separate an outage from a rejected request", async () => {
  for (const [status, code] of [[429, "PROVIDER_BUSY"], [401, "PROVIDER_AUTH"], [403, "PROVIDER_AUTH"], [500, "PROVIDER_UNAVAILABLE"], [503, "PROVIDER_UNAVAILABLE"], [400, "PROVIDER_REJECTED"], [422, "PROVIDER_REJECTED"]]) {
    assert.equal(providerStatusCode(status), code, String(status));
  }
  for (const code of ["PROVIDER_BUSY", "PROVIDER_AUTH", "PROVIDER_UNAVAILABLE", "PROVIDER_UNREACHABLE"]) assert.ok(PROVIDER_OUTAGE_CODES.has(code), code);
  assert.equal(PROVIDER_OUTAGE_CODES.has("PROVIDER_REJECTED"), false);
  const provider = createProvider({ baseUrl: "https://provider.example/v1", apiKey: "key", fetchImpl: async () => new Response("{}", { status: 401 }) });
  await assert.rejects(provider.response("Проверка"), { code: "PROVIDER_AUTH" });
});

test("a DNS or network failure becomes PROVIDER_UNREACHABLE instead of an untyped error", async () => {
  let calls = 0;
  const provider = createProvider({ baseUrl: "https://provider.example/v1", apiKey: "key", fetchImpl: async () => {
    calls++; throw Object.assign(new TypeError("fetch failed"), { cause: { code: "EAI_AGAIN" } });
  } });
  await assert.rejects(provider.response("Проверка"), error => error.code === "PROVIDER_UNREACHABLE" && error.cause?.cause?.code === "EAI_AGAIN");
  assert.equal(calls, 3);
});

test("an aborted request stays an abort, not an outage", async () => {
  const controller = new AbortController();
  const provider = createProvider({ baseUrl: "https://provider.example/v1", apiKey: "key", fetchImpl: async () => { controller.abort(); throw new DOMException("aborted", "AbortError"); } });
  await assert.rejects(provider.response("Проверка", { signal: controller.signal }), { name: "AbortError" });
});
