import { pageText } from './domain.mjs';

function problem(code) {const error=new Error(code);error.code=code;return error;}

function joinPdfItems(items) {
  let output='';
  for(const item of items) {
    if(typeof item?.str!=='string'||!item.str)continue;
    output+=item.str;
    output+=item.hasEOL?'\n':' ';
  }
  return output.replace(/[ \t]+\n/g,'\n').replace(/[ \t]{2,}/g,' ').trim();
}

export async function sourceText(page,{maximumCharacters=14000}={}) {
  if(page?.contentType!=='application/pdf')return pageText(page?.html??'').slice(0,maximumCharacters);
  if(!Buffer.isBuffer(page.bytes)||!page.bytes.length)throw problem('SOURCE_EMPTY');
  let document;
  try {
    const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');
    document=await getDocument({data:new Uint8Array(page.bytes),disableWorker:true,isEvalSupported:false,useSystemFonts:true}).promise;
    const pages=[];
    for(let number=1;number<=document.numPages&&pages.join('\n').length<maximumCharacters;number++) {
      const pdfPage=await document.getPage(number);
      pages.push(joinPdfItems((await pdfPage.getTextContent()).items));
      pdfPage.cleanup();
    }
    return pages.join('\n\n').replace(/\n{3,}/g,'\n\n').trim().slice(0,maximumCharacters);
  } catch(error) {
    if(error?.code==='SOURCE_EMPTY')throw error;
    throw problem('SOURCE_INVALID');
  } finally {await document?.destroy?.();}
}
