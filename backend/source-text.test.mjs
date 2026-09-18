import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceText } from './source-text.mjs';

function pdfFixture(text) {
  const escape=value=>value.replaceAll('\\','\\\\').replaceAll('(','\\(').replaceAll(')','\\)');
  const objects=[
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${text.length+35} >>\nstream\nBT /F1 12 Tf 72 720 Td (${escape(text)}) Tj ET\nendstream`,
  ];
  let output='%PDF-1.4\n',offsets=[0];
  objects.forEach((object,index)=>{offsets.push(Buffer.byteLength(output));output+=`${index+1} 0 obj\n${object}\nendobj\n`;});
  const xref=Buffer.byteLength(output);output+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`;
  for(const offset of offsets.slice(1))output+=`${String(offset).padStart(10,'0')} 00000 n \n`;
  output+=`trailer << /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(output);
}

test('extracts normalized text from HTML sources',async()=>{
  assert.equal(await sourceText({contentType:'text/html',html:'<main>Дом &laquo;А&raquo;</main>'}),'Дом «А»');
});

test('extracts text from a real PDF fixture',async()=>{
  const bytes=pdfFixture('Moscow monument archival history '.repeat(15));
  const text=await sourceText({contentType:'application/pdf',bytes});
  assert.match(text,/Moscow monument archival history/);
  assert.ok(text.length>30);
});

test('rejects empty and malformed PDF sources',async()=>{
  await assert.rejects(sourceText({contentType:'application/pdf',bytes:Buffer.alloc(0)}),{code:'SOURCE_EMPTY'});
  await assert.rejects(sourceText({contentType:'application/pdf',bytes:Buffer.from('not a pdf')}),{code:'SOURCE_INVALID'});
});
