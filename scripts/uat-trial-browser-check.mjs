import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {chromium} from '@playwright/test';

const id=process.env.FLOWDOC_PAPER_DRAFT_ID;
assert.ok(id,'Set FLOWDOC_PAPER_DRAFT_ID to the saved Model 20 UAT draft');
const asset=process.env.FLOWDOC_TRIAL_IMAGE;
const base=process.env.FLOWDOC_PHASE1_URL??'http://127.0.0.1:5175';
const output=resolve(process.env.FLOWDOC_TRIAL_EVIDENCE??'experiments/uat-trial-local');
await mkdir(output,{recursive:true});
const browser=await chromium.launch({channel:'msedge'});
const page=await browser.newPage({viewport:{width:1280,height:900}});
page.setDefaultTimeout(25000);
const errors=[],writes=[],runs=[];
page.on('pageerror',error=>errors.push(error.message));
page.on('request',request=>{if(['PUT','PATCH','DELETE'].includes(request.method()))writes.push(request.url());});
const path='/api/editor-phase1/drafts/'+id;
const form=page.locator('#trial-form'),paper=page.locator('#preview-paper'),editor=page.locator('#trial-paper-value');
const read=async()=>(await (await page.request.get(base+path)).json()).value;
const photo=name=>page.screenshot({path:join(output,name+'.png')});
async function nextRender(action){
  const response=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith(path+'/preview'),{timeout:120000});
  await action();
  const reply=await response,body=await reply.json();
  assert.equal(reply.status(),200,JSON.stringify(body.issues??body.error));
  assert.equal(body.renderPath,'engine-layout');
  assert.equal(Object.hasOwn(body,'pdfHash'),false);
  assert.ok(body.previewId&&body.pages.length===1);
  await page.waitForFunction(run=>document.querySelector('#preview-paper').dataset.run===run,body.previewId);
  assert.equal(await paper.locator('.preview-page').count(),body.pageCount);
  runs.push(body.previewId);
  return {body,request:reply.request().postDataJSON().trial};
}
const open=()=>page.getByRole('button',{name:'ลองข้อมูล / Preview',exact:true}).click();
try{
  const original=await read();
  await page.goto(base+'/phase1-editor.html?id='+id);
  const blank=await nextRender(open);
  assert.equal(blank.request.sections[0].data.parts[0].format,'cover');
  assert.equal(blank.request.sections[0].data.parts[0].data.title,'');
  assert.ok(await paper.getByRole('button',{name:'พิมพ์ค่า title',exact:true}).isVisible());
  assert.equal(await form.getByRole('button',{name:'จัดหน้าจากข้อมูลนี้',exact:true}).count(),0);
  const contents=form.getByText('สารบัญอัตโนมัติ · contents',{exact:true}).locator('..');
  await contents.waitFor();
  assert.equal(await contents.locator('button,select,textarea,input').count(),0);
  assert.equal(await form.locator('select[data-format] option[value=contents]').count(),0);
  assert.equal(blank.request.sections[0].data.parts.filter(entry=>entry.format==='contents').length,1);
  await photo('01-uat-cover-ready-from-blank');
  const cover=form.getByText('รายการ 1 · cover',{exact:true}).locator('..');
  const title=await nextRender(()=>cover.getByLabel(/^title/).fill('ชื่อจากฟอร์ม'));
  assert.equal(title.request.sections[0].data.parts[0].data.title,'ชื่อจากฟอร์ม');
  assert.ok(await paper.getByRole('button',{name:'แก้ค่า ชื่อจากฟอร์ม',exact:true}).isVisible());
  await paper.getByRole('button',{name:'แก้ค่า ชื่อจากฟอร์ม',exact:true}).click();
  await nextRender(()=>editor.fill('ชื่อจากกระดาษ'));
  assert.equal(await cover.getByLabel(/^title/).inputValue(),'ชื่อจากกระดาษ');

  const heading=form.locator('summary').filter({hasText:/^รายการ \d+ · heading$/}).first().locator('..');
  await nextRender(()=>heading.getByLabel(/^anchor/).fill('trial-heading'));
  const headingTitle='หัวข้อสารบัญ';
  const toc=await nextRender(()=>heading.getByLabel(/^title/).fill(headingTitle));
  const matches=[];
  for(let index=0;index<toc.body.pageCount;index++){
    const response=await page.request.get(base+path+'/preview-runs/'+toc.body.previewId+'/pages/'+index);
    const projected=(await response.json()).page;
    matches.push(...projected.lines.filter(line=>line.text===headingTitle));
  }
  assert.ok(matches.some(line=>line.edit),'heading retains its variable binding');
  assert.ok(matches.some(line=>!line.edit),'Core draws a read-only contents entry from the heading');
  const duplicate=structuredClone(toc.request);
  duplicate.sections[0].data.parts.push({format:'contents',data:{}});
  const rejected=await page.request.post(base+path+'/preview',{data:{expectedRevision:original.revision,trial:duplicate}});
  assert.equal(rejected.status(),422);
  const rejection=await rejected.json();
  assert.ok(rejection.issues?.some(issue=>issue.code==='INVALID_DATA'&&issue.path.endsWith('.props.scope')),JSON.stringify(rejection));

  const unsupported=structuredClone(toc.request);
  unsupported.sections[0].data.parts[0].data.title=String.fromCodePoint(0x10fffd);
  const invalidGlyph=await page.request.post(base+path+'/preview',{data:{expectedRevision:original.revision,trial:unsupported}});
  assert.equal(invalidGlyph.status(),422);
  const glyphRejection=await invalidGlyph.json();
  assert.ok(glyphRejection.issues?.some(issue=>issue.code==='FONT_GLYPH_MISSING'),JSON.stringify(glyphRejection));

  // A fresh view starts from the Format selected in the saved definition editor.
  await page.reload();
  const tree=page.locator('#tree');
  await tree.getByRole('button',{name:'ขยายหรือยุบ parts',exact:true}).click();
  await tree.locator('[data-kind=format]').getByText('summary-dynamic',{exact:true}).click();
  const blankTable=await nextRender(open);
  const formatIndex=blankTable.request.sections[0].data.parts.findIndex(entry=>entry.format==='summary-dynamic');
  assert.equal(blankTable.request.sections[0].data.parts.length,14);
  const sample=blankTable.request.sections[0].data.parts[formatIndex];
  assert.equal(sample.format,'summary-dynamic');
  assert.equal(sample.data.groups[0].members[0].menu,'');
  let summaryPage=-1;
  for(let index=0;index<blankTable.body.pageCount;index++){
    const response=await page.request.get(base+path+'/preview-runs/'+blankTable.body.previewId+'/pages/'+index);
    const projected=(await response.json()).page;
    if(projected?.lines.some(line=>line.edit?.blank&&JSON.parse(line.edit.key).at(-1)==='menu')){summaryPage=index;break;}
  }
  assert.ok(summaryPage>=0);
  await paper.locator('.preview-page').nth(summaryPage).scrollIntoViewIfNeeded();
  await paper.getByRole('button',{name:'พิมพ์ค่า menu',exact:true}).waitFor();
  const members=form.getByRole('group',{name:/^members/});
  await nextRender(()=>members.getByRole('button',{name:'+ เพิ่มรายการ',exact:true}).click());
  const rows=members.locator(':scope > .trial-rows > details');
  const first=rows.nth(0).getByLabel(/^menu/),second=rows.nth(1).getByLabel(/^menu/);
  await nextRender(()=>first.fill('เมนูเหมือนกัน'));
  await nextRender(()=>second.fill('เมนูเหมือนกัน'));
  if(asset)await nextRender(async()=>{
    await form.getByLabel(/headerBanner/).setInputFiles({name:'trial-banner.png',mimeType:'image/png',buffer:await readFile(asset)});
  });
  await paper.locator('.preview-page').nth(summaryPage).scrollIntoViewIfNeeded();
  const identical=paper.getByRole('button',{name:'แก้ค่า เมนูเหมือนกัน',exact:true});
  await identical.nth(1).waitFor();
  assert.equal(await identical.count(),2);
  await identical.nth(1).click();
  await editor.evaluate(input=>input.setSelectionRange(4,4));
  const paperResult=await nextRender(()=>page.keyboard.insertText('ไทย'));
  assert.deepEqual(paperResult.request.sections[0].data.parts[formatIndex].data.groups[0].members.map(row=>row.menu),
    ['เมนูเหมือนกัน','เมนูไทยเหมือนกัน']);
  assert.equal(await first.inputValue(),'เมนูเหมือนกัน');
  assert.equal(await second.inputValue(),'เมนูไทยเหมือนกัน');
  assert.equal(await editor.evaluate(el=>el===document.activeElement&&el.selectionStart===7),true);
  await editor.press('Tab');
  assert.equal(await editor.inputValue(),'');
  await nextRender(()=>page.keyboard.insertText('8'));
  assert.equal(await rows.nth(1).getByLabel(/^cases/).inputValue(),'8');
  assert.equal(await rows.nth(0).getByLabel(/^cases/).inputValue(),'');
  await editor.press('Shift+Tab');
  assert.equal(await editor.inputValue(),'เมนูไทยเหมือนกัน');
  await photo('02-uat-repeated-row-live-sync');

  const burst='ก'.repeat(85);
  const burstValue='เมนูไทย'+burst+'เหมือนกัน';
  const beforeBurst=await paper.getAttribute('data-run');
  const started=Date.now(),updates=new Map();
  const finalResponse=page.waitForResponse(response=>{
    const request=response.request();
    return request.method()==='POST'&&response.url().endsWith(path+'/preview')&&
      request.postDataJSON().trial.sections[0].data.parts[formatIndex].data.groups[0].members[1].menu===burstValue;
  },{timeout:120000});
  await editor.evaluate(input=>input.setSelectionRange(7,7));
  for(let index=0;index<burst.length;index++){
    await page.keyboard.insertText('ก');
    await new Promise(resolve=>setTimeout(resolve,45));
    const run=await paper.getAttribute('data-run');
    if(run&&run!==beforeBurst&&!updates.has(run))updates.set(run,{stroke:index+1,ms:Date.now()-started});
  }
  assert.ok([...updates.values()].some(update=>update.stroke<burst.length),'Engine preview must update while input continues');
  const final=await (await finalResponse).json();
  await page.waitForFunction(run=>document.querySelector('#preview-paper').dataset.run===run,final.previewId);
  assert.equal(await editor.evaluate(el=>el===document.activeElement&&el.selectionStart===92),true);
  assert.equal(await second.inputValue(),burstValue);
  assert.equal(await first.inputValue(),'เมนูเหมือนกัน');
  await nextRender(()=>editor.fill('เมนูไทยเหมือนกัน'));

  const long='ก'.repeat(1500);
  const expanded=await nextRender(async()=>{
    await editor.evaluate(input=>input.setSelectionRange(7,7));
    await page.keyboard.insertText(long);
  });
  assert.ok(expanded.body.pageCount>blankTable.body.pageCount);
  assert.ok(expanded.body.pageIndex>0);
  assert.equal(await editor.evaluate(el=>el===document.activeElement&&el.selectionStart===1507),true);
  assert.equal(await first.inputValue(),'เมนูเหมือนกัน');
  assert.equal(await second.inputValue(),'เมนูไทย'+long+'เหมือนกัน');
  await photo('03-uat-reflow-caret');

  // Repeated keydown without keyup exercises the browser's auto-repeat path.
  await first.focus();
  await first.evaluate(input=>input.setSelectionRange(input.value.length,input.value.length));
  const beforeHold=await paper.getAttribute('data-run');
  const heldValue='เมนูเหมือนกัน'+'a'.repeat(70);
  const heldResponse=page.waitForResponse(response=>{
    const request=response.request();
    return request.method()==='POST'&&response.url().endsWith(path+'/preview')&&
      request.postDataJSON().trial.sections[0].data.parts[formatIndex].data.groups[0].members[0].menu===heldValue;
  },{timeout:120000});
  const heldRuns=new Set();
  for(let index=0;index<70;index++){
    await page.keyboard.down('a');
    await new Promise(resolve=>setTimeout(resolve,45));
    const run=await paper.getAttribute('data-run');
    if(run&&run!==beforeHold)heldRuns.add(run);
  }
  await page.keyboard.up('a');
  assert.ok(heldRuns.size>0,'Engine preview must update before keyup in the form');
  const held=await (await heldResponse).json();
  await page.waitForFunction(run=>document.querySelector('#preview-paper').dataset.run===run,held.previewId);
  assert.equal(await first.inputValue(),heldValue);
  assert.equal(await second.inputValue(),'เมนูไทย'+long+'เหมือนกัน');
  assert.equal(await first.evaluate(input=>input===document.activeElement&&input.selectionStart===input.value.length),true);
  assert.deepEqual(await read(),original);
  assert.deepEqual(writes,[]);
  assert.deepEqual(errors,[]);
  const result={draftId:id,revision:original.revision,initialBlank:true,allFormatsSeeded:true,continuousPreview:true,automaticBothDirections:true,
    renderPath:'engine-layout',pdfHashReturned:false,distinctRenderRuns:runs.length,repeatedRowOwnership:true,
    derivedContents:true,duplicateContentsRejected:true,unsupportedGlyphRejected:true,continuousThaiStrokes:burst.length,updatesDuringTyping:[...updates.values()],
    heldFormKeydowns:70,engineUpdatesBeforeKeyup:heldRuns.size,
    finalThaiEngineMs:Math.round(final.engineMs),finalThaiLabRenderMs:Math.round(final.renderMs),
    tabAndShiftTab:true,caretAfterPageReflow:true,expandedPages:expanded.body.pageCount,definitionWrites:0};
  await writeFile(join(output,'trial-preview-verification.json'),JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify(result));
}finally{await browser.close();}
