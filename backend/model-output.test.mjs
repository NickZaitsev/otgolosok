import test from 'node:test';
import assert from 'node:assert/strict';
import { requestStructured, usageTokens } from './model-output.mjs';

test('structured responses repair invalid JSON once',async()=>{const queue=[{text:'broken'},{text:'{"approved":true}'}],provider={response:async()=>queue.shift()};const result=await requestStructured(provider,'review');assert.equal(result.value.approved,true);assert.equal(result.formatRepaired,true);});
test('usage avoids counting total and components twice',()=>{assert.equal(usageTokens({input_tokens:10,output_tokens:5,total_tokens:15}),15);assert.equal(usageTokens({input_tokens:10,output_tokens:5}),15);});
