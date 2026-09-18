import { pageText } from './domain.mjs';

function problem(code) {const error=new Error(code);error.code=code;return error;}

export function classifySourceText(text, html='') {
  const normalized=text.toLocaleLowerCase('en-US');
  if(/killbot user verification|checking your browser|verify you are human|captcha/i.test(normalized))throw problem('SOURCE_BLOCKED');
  if(text.length<300&&/<script\b/i.test(html)&&/(?:__next_data__|webpack|javascript)/i.test(html))throw problem('SOURCE_DYNAMIC_CONTENT');
  return text;
}

function joinPdfItems(items) {
  let output='';
  for(const item of items) {
    if(typeof item?.str!=='string'||!item.str)continue;
    output+=item.str;
    output+=item.hasEOL?'\n':' ';
  }
  return output.replace(/[ \t]+\n/g,'\n').replace(/[ \t]{2,}/g,' ').trim();
}

export async function sourceText(page,{maximumCharacters=14000,keywords=[]}={}) {
  if(page?.contentType!=='application/pdf')return classifySourceText(pageText(page?.html??'').slice(0,maximumCharacters),page?.html??'');
  if(!Buffer.isBuffer(page.bytes)||!page.bytes.length)throw problem('SOURCE_EMPTY');
  let document;
  try {
    const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');
    document=await getDocument({data:new Uint8Array(page.bytes),disableWorker:true,isEvalSupported:false,useSystemFonts:true}).promise;
    const pages=[];
    for(let number=1;number<=document.numPages&&number<=500;number++) {
      const pdfPage=await document.getPage(number);
      const value=joinPdfItems((await pdfPage.getTextContent()).items);
      if(value)pages.push({number,text:value});
      pdfPage.cleanup();
    }
    if(!pages.length)throw problem('SOURCE_NO_TEXT');
    const terms=keywords.flatMap(value=>String(value??'').normalize('NFKC').toLocaleLowerCase('ru').split(/[^\p{L}\p{N}]+/u)).filter(term=>term.length>=4);
    const ranked=pages.map(page=>({...page,score:terms.reduce((score,term)=>score+(page.text.toLocaleLowerCase('ru').includes(term)?1:0),0)}));
    if(terms.length)ranked.sort((a,b)=>b.score-a.score||a.number-b.number);
    const selected=[];let length=0;
    for(const page of ranked){if(length>=maximumCharacters)break;selected.push(page);length+=page.text.length+2;}
    selected.sort((a,b)=>a.number-b.number);
    return classifySourceText(selected.map(page=>`[стр. ${page.number}] ${page.text}`).join('\n\n').replace(/\n{3,}/g,'\n\n').trim().slice(0,maximumCharacters));
  } catch(error) {
    if(['SOURCE_EMPTY','SOURCE_NO_TEXT','SOURCE_BLOCKED','SOURCE_DYNAMIC_CONTENT'].includes(error?.code))throw error;
    throw problem('SOURCE_INVALID');
  } finally {await document?.destroy?.();}
}
