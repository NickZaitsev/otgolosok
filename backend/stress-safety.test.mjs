import test from "node:test";
import assert from "node:assert/strict";
import { findUnsafeStress, stripUnsafeStress } from "./stress-safety.mjs";

test("a stress mark on a word voiced differently from its spelling is reported",()=>{
  const found=findUnsafeStress("Сег+одня ст+ала ч+астью ег+о культ+урной п+амяти.");
  assert.deepEqual(found.map((item)=>item.word),["Сег+одня","ег+о"]);
  assert.deepEqual(found.map((item)=>item.rule),["ого","ого"]);
  assert.equal(found[0].severity,"high");
});

test("a stress mark anywhere in the word is reported, not only next to the ending",()=>{
  assert.deepEqual(findUnsafeStress("голос+а пр+ошлого").map((item)=>item.word),["пр+ошлого"]);
});

test("words spelled as they sound are left alone",()=>{
  assert.deepEqual(findUnsafeStress("Москв+а ум+еет хран+ить голос+а на берег+у г+орода"),[]);
});

test("unmarked words are never reported, however they are voiced",()=>{
  assert.deepEqual(findUnsafeStress("Сегодня его прошлого что конечно"),[]);
});

test("adverbs keeping a spelled -ого are not mistaken for genitive endings",()=>{
  assert.deepEqual(findUnsafeStress("мн+ого стр+ого д+олго д+орого"),[]);
  assert.deepEqual(findUnsafeStress("мн+огого").map((item)=>item.rule),["ого"]);
});

test("lexical shifts outside the -ого ending are reported",()=>{
  const rules=(text)=>findUnsafeStress(text).map((item)=>item.rule);
  assert.deepEqual(rules("чт+о хот+ели"),["что"]);
  assert.deepEqual(rules("кон+ечно ск+учно"),["чн","чн"]);
  assert.deepEqual(rules("т+очный в+ечный"),[]);
  assert.deepEqual(rules("нах+одится стр+оиться"),["тся","тся"]);
  assert.deepEqual(rules("с+олнце п+оздно чу+вство изв+естный"),["немой","немой","немой","немой"]);
  assert.deepEqual(rules("б+ездна"),[]);
  assert.deepEqual(rules("сч+астье легк+о"),["щ","хк"]);
});

test("hyphenated words are checked part by part",()=>{
  assert.deepEqual(findUnsafeStress("Москв+ы-рек+и"),[]);
  assert.deepEqual(findUnsafeStress("чт+о-то").map((item)=>item.word),["чт+о"]);
});

test("stripping removes only the unsafe marks and reports what it dropped",()=>{
  const {text,removed}=stripUnsafeStress("Сег+одня стар+инные зд+ания напомин+ают, как ист+ория г+орода ст+ала ч+астью ег+о культ+урной п+амяти.");
  assert.equal(text,"Сегодня стар+инные зд+ания напомин+ают, как ист+ория г+орода ст+ала ч+астью его культ+урной п+амяти.");
  assert.deepEqual(removed.map((item)=>item.word),["Сег+одня","ег+о"]);
});

test("stripping keeps the pause and accent markup untouched",()=>{
  const script="**голос+а** пр+ошлого. <[large]> sil<[400]> Сег+одня <[small]> ег+о ф+абрика.";
  assert.equal(stripUnsafeStress(script).text,"**голос+а** прошлого. <[large]> sil<[400]> Сегодня <[small]> его ф+абрика.");
});

test("the high threshold keeps marks the engine's own rules likely handle",()=>{
  const script="нах+одится ег+о с+олнце";
  assert.equal(stripUnsafeStress(script,{severity:"high"}).text,"нах+одится его с+олнце");
  assert.equal(stripUnsafeStress(script).text,"находится его солнце");
});

test("text without stress marks is returned unchanged",()=>{
  const script="Сегодня старинные здания напоминают. <[large]>";
  assert.deepEqual(stripUnsafeStress(script),{text:script,removed:[]});
  assert.deepEqual(findUnsafeStress(""),[]);
  assert.deepEqual(findUnsafeStress(null),[]);
});

test("the shift inside \"сегодня\" is caught even though the word does not end in -его",()=>{
  assert.deepEqual(findUnsafeStress("сег+одня сег+одняшний").map((item)=>item.rule),["ого","ого"]);
  assert.equal(stripUnsafeStress("сег+одняшний д+ень").text,"сегодняшний д+ень");
});
