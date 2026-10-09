import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
const load=name=>JSON.parse(readFileSync(new URL(name,import.meta.url),"utf8"));
const change=load("./changes.json").entries[0];
const result=load("./verification.json").entries[0];
const provenance=load("./audio-provenance.json").entries[0];
test("рассказ о храме расширен с сохранением карточки и проверяемых источников",()=>{
 assert.equal(change.placeId,"osm:relation:7314898");
 const words=change.story.paragraphs.flatMap(p=>p.text.split(/\s+/u)).filter(w=>/[\p{L}\p{N}]/u.test(w)).length;
 assert.ok(words>=350&&words<=450);assert.equal(change.story.wordCount,words);assert.equal(result.wordCount,words);
 assert.equal(change.story.title,change.beforeStory.title);assert.equal(change.story.address,change.beforeStory.address);assert.notEqual(result.textId,change.expectedTextId);
 const sources=new Set(change.story.sources.map(s=>s.id)),facts=new Set(change.story.facts.map(f=>f.id));
 for(const fact of change.story.facts){assert.ok(fact.sourceIds.length);for(const id of fact.sourceIds)assert.ok(sources.has(id));}
 for(const p of change.story.paragraphs){assert.ok(p.factIds.length);for(const id of p.factIds)assert.ok(facts.has(id));assert.doesNotMatch(p.text,/(?:по адресу|Волхонке,?\s*15)/iu);}
});
test("новый v4 соответствует тексту и прежний MP3 доступен",()=>{
 assert.equal(result.audio.provider,"elevenlabs");assert.equal(result.audio.model,"eleven_v4");assert.equal(result.audio.voice,"9ivxhQ6xIsHd6R3Xc635");
 assert.equal(provenance.state,"succeeded");assert.ok(provenance.approvedSourceTextMatch&&provenance.uploadAndReceiptMatch);
 assert.equal(provenance.sha256,result.audio.sha256);assert.equal(provenance.sourceTextSha256,result.sourceTextSha256);assert.equal(provenance.model,result.audio.model);assert.equal(provenance.voice,result.audio.voice);
 assert.equal(result.files.length,2);assert.equal(result.files[0].sha256,result.audio.sha256);assert.notEqual(result.files[1].sha256,result.audio.sha256);assert.ok(result.files[0].durationSec>150);assert.equal(result.images.length,2);
 const guards=load("./local-verification.json");assert.ok(guards.dryRunWritesNothing&&guards.finalEntryConflictRollsBackAll&&guards.queueReplayAddsNoJobs);assert.equal(guards.newAudioIntents,1);
});
test("новый рассказ воспроизводится в двух прогулках без изменения остальных глав",()=>{
 const walks=load("./walks-verification.json");const ui=load("./ui-verification.json");
 assert.ok(walks.addressLocationPhotoPreserved&&walks.receiptAndUploadMatch);assert.equal(walks.walks.length,2);assert.equal(ui.walks.length,2);assert.deepEqual(ui.javascriptErrors,[]);
 assert.equal(walks.walks.reduce((n,w)=>n+w.unchangedChaptersChecked,0),38);
 for(const w of walks.walks){assert.ok(w.documentUnchanged&&w.chapterAudioMatches);assert.ok(w.currentAudioDurationSec>=900);assert.equal(w.unchangedChapterAudio.length,w.unchangedChaptersChecked);assert.ok(w.unchangedChapterAudio.every(c=>c.originalAudioPreserved));const played=ui.walks.find(v=>v.walkId===w.id);assert.equal(played.chapterId,w.chapterId);assert.equal(played.sha256,result.audio.sha256);assert.ok(played.pauseChecked&&played.playing.some(s=>s.timeSec>1&&!s.paused&&s.error===null));assert.equal(played.expandedParagraphsChecked,change.story.paragraphs.length);}
});
