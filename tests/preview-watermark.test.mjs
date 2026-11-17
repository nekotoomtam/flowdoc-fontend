import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PDFDocument} from 'pdf-lib';
import JSZip from 'jszip';
import {stampPreviewPdf,stampPreviewDocx} from '../scripts/preview-watermark.mjs';

const artwork=await readFile(new URL('../public/preview-watermark.png',import.meta.url));
const w='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const r='http://schemas.openxmlformats.org/officeDocument/2006/relationships';

async function files(t){
  const dir=await mkdtemp(join(tmpdir(),'flowdoc-preview-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  return {source:join(dir,'source'),target:join(dir,'target')};
}

test('Preview PDF stamps every page while preserving page dimensions and original content streams',async t=>{
  const {source,target}=await files(t);
  const original=await PDFDocument.create();
  const sizes=[[595,842],[842,595],[300,400]];
  for(const size of sizes)original.addPage(size).drawText('Original content');
  await writeFile(source,await original.save());
  await stampPreviewPdf(source,target,artwork,{maxBytes:2**20});
  const marked=await PDFDocument.load(await readFile(target));
  assert.deepEqual(marked.getPages().map(page=>Object.values(page.getSize())),sizes);
  for(const page of marked.getPages()){
    assert.equal(page.node.Contents().size(),4);
    assert.match(page.node.Resources().toString(),/Image-/);
  }
  assert.equal((await PDFDocument.load(await readFile(source))).getPageCount(),3);
  await assert.rejects(stampPreviewPdf(source,target,artwork,{maxBytes:10}),/limit/i);
});

test('Preview Word supplies missing header types and stamps existing headers while preserving document content',async t=>{
  const {source,target}=await files(t);
  const original=new JSZip();
  const document=`<w:document xmlns:w="${w}" xmlns:r="${r}"><w:body><w:p><w:r><w:t>Body unchanged</w:t></w:r></w:p><w:sectPr><w:headerReference w:type="first" r:id="rId5"/><w:pgSz w:w="11906" w:h="16838"/><w:titlePg/></w:sectPr></w:body></w:document>`;
  original.file('word/document.xml',document);
  original.file('[Content_Types].xml','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>');
  original.file('word/_rels/document.xml.rels',`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId5" Type="${r}/header" Target="header1.xml"/></Relationships>`);
  original.file('word/header1.xml',`<w:hdr xmlns:w="${w}"><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Existing header</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:p/></w:hdr>`);
  await writeFile(source,await original.generateAsync({type:'nodebuffer'}));
  await stampPreviewDocx(source,target,artwork,{maxBytes:2**20});
  const marked=await JSZip.loadAsync(await readFile(target));
  const output=await marked.file('word/document.xml').async('string');
  assert.match(output,/<w:p><w:r><w:t>Body unchanged<\/w:t><\/w:r><\/w:p>/);
  for(const type of ['default','first','even'])assert.match(output,new RegExp('w:type="'+type+'"'));
  const first=await marked.file('word/header1.xml').async('string');
  assert.match(first,/<w:t>Existing header<\/w:t>/);
  assert.match(first,/<\/w:tbl><w:p><w:r[^>]*>\s*<w:drawing>/);
  assert.match(first,/wp:anchor[^>]+behindDoc="0"/);
  const headers=marked.file(/^word\/[^/]+\.xml$/).filter(file=>file.name!=='word/document.xml');
  assert.equal(headers.length,2);
  for(const header of headers)assert.match(await header.async('string'),/ฉบับทดลอง · PREVIEW/);
  assert.deepEqual(await marked.file('word/media/flowdoc-preview-watermark.png').async('nodebuffer'),artwork);
});
