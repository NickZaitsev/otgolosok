import { failure } from "./domain.mjs";
import { draftPrompt, reviewPrompt } from "./prompts.mjs";
import { requestStructured } from "./model-output.mjs";

const limits = profile => profile === "description-v1" ? {minWords:20,maxWords:100,minParagraphs:1,maxParagraphs:3} : {minWords:100,maxWords:250,minParagraphs:2,maxParagraphs:6};

export function parseStoryText(text,{profile="story-v1"}={}) {
  if(typeof text!=="string")throw failure("INVALID_DRAFT","Writer returned no text.");
  const paragraphs=text.replace(/\r\n?/g,"\n").split(/\n\s*\n/u).map(value=>value.trim()).filter(Boolean);
  const wordCount=paragraphs.join(" ").split(/\s+/u).filter(Boolean).length,rule=limits(profile);
  if(paragraphs.length<rule.minParagraphs||paragraphs.length>rule.maxParagraphs)throw failure("INVALID_DRAFT",`Expected ${rule.minParagraphs}-${rule.maxParagraphs} paragraphs; got ${paragraphs.length}.`);
  if(paragraphs.some(value=>value.length>2000))throw failure("INVALID_DRAFT","A paragraph exceeds 2000 characters.");
  if(wordCount<rule.minWords||wordCount>rule.maxWords)throw failure("INVALID_DRAFT",`Expected ${rule.minWords}-${rule.maxWords} words; got ${wordCount}.`);
  return {paragraphs:paragraphs.map(value=>({text:value,factIds:[]})),wordCount};
}

function acceptReview(value,paragraphCount,evidence) {
  if(typeof value?.approved!=="boolean"||!Array.isArray(value.issues)||!Array.isArray(value.paragraphFacts))throw failure("INVALID_MODEL_OUTPUT");
  if(!value.approved||value.issues.length)throw Object.assign(failure("REVIEW_REQUIRED"),{issues:value.issues});
  const available=new Set(evidence.facts.map(fact=>fact.id)),byParagraph=new Map();
  for(const item of value.paragraphFacts){if(!Number.isInteger(item?.paragraph)||item.paragraph<1||item.paragraph>paragraphCount||!Array.isArray(item.factIds)||!item.factIds.length||item.factIds.some(id=>!available.has(id)))throw failure("INVALID_MODEL_OUTPUT");byParagraph.set(item.paragraph,[...new Set(item.factIds)]);}
  if(byParagraph.size!==paragraphCount)throw failure("INVALID_MODEL_OUTPUT");
  return byParagraph;
}

export async function writeStory(evidence,{profile="story-v1",provider,address=evidence.resolvedAddress,signal,onCandidate=()=>{},onReview=()=>{}}={}) {
  let effectiveProfile=profile,result=await provider.response(draftPrompt(evidence,effectiveProfile),{model:provider.writerModel,signal,timeoutMs:180000,maxTokens:3200});
  let parsed;
  try{parsed=parseStoryText(result.text,{profile:effectiveProfile});}
  catch(error){
    const words=typeof result.text==="string"?result.text.trim().split(/\s+/u).filter(Boolean).length:0;
    if(profile==="story-v1"&&words>=20&&words<100){effectiveProfile="description-v1";parsed=parseStoryText(result.text,{profile:effectiveProfile});}
    else {onCandidate({text:String(result.text??"").slice(0,32000),validationIssues:[{code:error.code,path:"text",actual:error.message}]});result=await provider.response(`${draftPrompt(evidence,effectiveProfile)}\n\nПредыдущий текст не прошёл проверку: ${error.message}. Верни полный исправленный текст.`,{model:provider.writerModel,signal,timeoutMs:180000,maxTokens:3200});parsed=parseStoryText(result.text,{profile:effectiveProfile});}
  }
  onCandidate({text:result.text.slice(0,32000),validationIssues:[]});
  const draft={title:evidence.placeName,address:evidence.resolvedAddress,paragraphs:parsed.paragraphs,wordCount:parsed.wordCount,effectiveProfile};
  let review=await requestStructured(provider,reviewPrompt(address,{...draft,paragraphs:draft.paragraphs.map((p,index)=>({paragraph:index+1,text:p.text}))},evidence),{signal,timeoutMs:120000,maxTokens:1800});
  onReview(review.value);
  let links;
  try{links=acceptReview(review.value,draft.paragraphs.length,evidence);}
  catch(error){
    if(error.code!=="REVIEW_REQUIRED"||!error.issues?.length)throw error;
    result=await provider.response(`${draftPrompt(evidence,effectiveProfile)}\n\nИсправь только блокирующие замечания редактора: ${JSON.stringify(error.issues)}. Отклонённый текст: ${JSON.stringify(result.text).slice(0,12000)}`,{model:provider.writerModel,signal,timeoutMs:180000,maxTokens:3200});
    parsed=parseStoryText(result.text,{profile:effectiveProfile});draft.paragraphs=parsed.paragraphs;draft.wordCount=parsed.wordCount;
    review=await requestStructured(provider,reviewPrompt(address,{...draft,paragraphs:draft.paragraphs.map((p,index)=>({paragraph:index+1,text:p.text}))},evidence),{signal,timeoutMs:120000,maxTokens:1800});onReview(review.value);links=acceptReview(review.value,draft.paragraphs.length,evidence);
  }
  draft.paragraphs=draft.paragraphs.map((paragraph,index)=>({...paragraph,factIds:links.get(index+1)}));
  const used=new Set(draft.paragraphs.flatMap(paragraph=>paragraph.factIds));
  return {...draft,verification:"automatic",requestedProfile:profile,audioDisposition:effectiveProfile==="story-v1"?"eligible":"not_applicable_short_text",sources:evidence.sources.map(({id,url,title,publisher})=>({id,url,title,publisher})),facts:evidence.facts.filter(fact=>used.has(fact.id)).map(fact=>({id:fact.id,claim:fact.claim,sourceIds:fact.evidence.map(proof=>proof.sourceId)}))};
}
