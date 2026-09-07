import test from "node:test";
import assert from "node:assert/strict";
import { createProvider } from "./provider.mjs";

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
  assert.deepEqual(draft.value,{valid:true});
});
