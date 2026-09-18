import test from 'node:test';
import assert from 'node:assert/strict';
import { parseStoryText, writeStory } from './story-writing.mjs';

const words=count=>Array.from({length:count},(_,index)=>`слово${index}`).join(' ');
test('plain story parser enforces profile boundaries',()=>{assert.equal(parseStoryText(`${words(50)}\n\n${words(50)}`).wordCount,100);assert.throws(()=>parseStoryText(words(99)),{code:'INVALID_DRAFT'});assert.equal(parseStoryText(words(20),{profile:'description-v1'}).wordCount,20);assert.throws(()=>parseStoryText(words(101),{profile:'description-v1'}),{code:'INVALID_DRAFT'});});

const evidence={placeName:'Дом',resolvedAddress:'Москва, улица Примерная, 1',facts:[
  {id:'f1',claim:'Дом построен в 1900 году.',kind:'content',subjectRelation:'object',contentReason:'Год постройки',evidence:[{sourceId:'s1',quote:'Дом построен в 1900 году.'}]},
  {id:'f2',claim:'Дом находится на улице Примерной, 1.',kind:'address',subjectRelation:'object',evidence:[{sourceId:'s1',quote:'улица Примерная, 1'}]},
],sources:[{id:'s1',url:'https://one.example',title:'Источник',publisher:'one.example'},{id:'s2',url:'https://unused.example',title:'Лишний',publisher:'unused.example'}]};
const checked=(text,{ids=['f1'],address=false}={})=>({value:{approved:true,issues:[],checks:{substantive:true,subjectAligned:true,audioClear:true},paragraphFacts:[{paragraph:1,factIds:ids}],claims:[{paragraph:1,text,factIds:ids,supported:true,address}]}});

test('review rejects duplicate paragraph mappings and address claims without address evidence',async()=>{
  const text=words(20),responses=[{text},{value:{approved:true,issues:[],checks:{substantive:true,subjectAligned:true,audioClear:true},paragraphFacts:[{paragraph:1,factIds:['f1']},{paragraph:1,factIds:['f1']}],claims:[{paragraph:1,text:'слово0',factIds:['f1'],supported:true,address:false}]}}];
  await assert.rejects(writeStory(evidence,{provider:{writerModel:'writer',response:async()=>responses.shift()}}),{code:'INVALID_MODEL_OUTPUT'});
  const addressResponses=[{text},checked('слово0',{address:true})];
  await assert.rejects(writeStory(evidence,{provider:{writerModel:'writer',response:async()=>addressResponses.shift()}}),{code:'INVALID_MODEL_OUTPUT'});
});

test('editor rewrite may become a short description and publishes only used sources',async()=>{
  const long=`${words(50)}\n\n${words(50)}`,short=words(20),responses=[{text:long},{value:{approved:false,issues:['Слишком сложно для слуха'],checks:{substantive:true,subjectAligned:true,audioClear:false},paragraphFacts:[],claims:[]}},{text:short},checked('слово0')];
  const result=await writeStory(evidence,{provider:{writerModel:'writer',response:async()=>responses.shift()}});
  assert.equal(result.effectiveProfile,'description-v1');
  assert.equal(result.downgradeReason,'insufficient_material_for_story');
  assert.deepEqual(result.sources.map(source=>source.id),['s1']);
});
