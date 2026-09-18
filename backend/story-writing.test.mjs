import test from 'node:test';
import assert from 'node:assert/strict';
import { parseStoryText } from './story-writing.mjs';

const words=count=>Array.from({length:count},(_,index)=>`слово${index}`).join(' ');
test('plain story parser enforces profile boundaries',()=>{assert.equal(parseStoryText(`${words(50)}\n\n${words(50)}`).wordCount,100);assert.throws(()=>parseStoryText(words(99)),{code:'INVALID_DRAFT'});assert.equal(parseStoryText(words(20),{profile:'description-v1'}).wordCount,20);assert.throws(()=>parseStoryText(words(101),{profile:'description-v1'}),{code:'INVALID_DRAFT'});});
