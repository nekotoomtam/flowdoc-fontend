import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {chromium} from '@playwright/test';
import {applyTrialValueChanges} from './trial-value-delta.mjs';

const id=process.env.FLOWDOC_PAPER_DRAFT_ID;
assert.ok(id,'Set FLOWDOC_PAPER_DRAFT_ID to the saved Model 20 UAT draft');
const asset=process.env.FLOWDOC_TRIAL_IMAGE;
const base=process.env.FLOWDOC_PHASE1_URL??'http://127.0.0.1:5175';
const canvas=process.env.FLOWDOC_PREVIEW_RENDERER==='canvas';
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
const coverInk=()=>paper.locator('.preview-page-sheet').first().evaluate(sheet=>
  sheet.querySelector('canvas')?.toDataURL()??sheet.querySelector('svg').outerHTML);
async function whilePreviewHeld(action,check){
  const release=Promise.withResolvers(),entered=Promise.withResolvers();
  const route='**/drafts/'+id+'/preview';
  const hold=async request=>{entered.resolve();await release.promise;await request.continue();};
  await page.route(route,hold,{times:1});
  try{
    await action();
    await entered.promise;
    await check();
  }finally{release.resolve();}
}
const snapshots=new Map();
const requestValue=(request,part,index)=> {
  const {trial,trialPatch}=request.postDataJSON();
  return trial?trial.sections[0].data.parts[part].data.groups[0].members[index].menu:
    trialPatch?.changes.find(({path})=>JSON.stringify(path)===JSON.stringify(['sections',0,'data','parts',part,'data','groups',0,'members',index,'menu']))?.value;
};
function snapshot(reply,body){
  const {trial,trialPatch}=reply.request().postDataJSON();
  const input=trial??applyTrialValueChanges(snapshots.get(trialPatch.basePreviewId),trialPatch);
  snapshots.set(body.previewId,input);
  return input;
}
const snapshotTasks=new Set();
const refreshSnapshots=reply=>{
  if(reply.status()!==200||reply.request().method()!=='POST'||!reply.url().endsWith(path+'/preview'))return;
  const task=reply.json().then(body=>snapshot(reply,body)).catch(error=>errors.push(error.message));
  snapshotTasks.add(task);
  void task.finally(()=>snapshotTasks.delete(task));
};
page.on('response',refreshSnapshots);
async function nextRender(action){
  const response=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith(path+'/preview'),{timeout:120000});
  void response.catch(()=>{});
  await action();
  const reply=await response,body=await reply.json();
  assert.equal(reply.status(),200,JSON.stringify(body.issues??body.error));
  assert.equal(body.renderPath,'engine-layout');
  assert.equal(Object.hasOwn(body,'pdfHash'),false);
  assert.ok(body.previewId&&body.pages.length===1);
  await page.waitForFunction(run=>document.querySelector('#preview-paper').dataset.run===run,body.previewId);
  assert.equal(await paper.locator('.preview-page').count(),body.pageCount);
  runs.push(body.previewId);
  return {body,request:snapshot(reply,body)};
}
const open=()=>page.getByRole('button',{name:'ลองข้อมูล / Preview',exact:true}).click();
try{
  const original=await read();
  await page.goto(base+'/phase1-editor.html?id='+id+(canvas?'&previewRenderer=canvas':''));
  const blank=await nextRender(open);
  assert.equal(blank.request.sections[0].data.parts[0].format,'cover');
  assert.equal(blank.request.sections[0].data.parts[0].data.title,'');
  await paper.locator('.preview-page').first().getByRole('button',{name:'พิมพ์ค่า title',exact:true}).waitFor();
  if(canvas)await paper.locator('canvas').first().waitFor();
  assert.equal(await form.getByRole('button',{name:'จัดหน้าจากข้อมูลนี้',exact:true}).count(),0);
  const contents=form.getByText('สารบัญอัตโนมัติ · contents',{exact:true}).locator('..');
  await contents.waitFor();
  assert.equal(await contents.locator('button,select,textarea,input').count(),0);
  assert.equal(await form.locator('select[data-format] option[value=contents]').count(),0);
  assert.equal(blank.request.sections[0].data.parts.filter(entry=>entry.format==='contents').length,1);
  await photo('01-uat-cover-ready-from-blank');
  const cover=form.getByText('รายการ 1 · cover',{exact:true}).locator('..');
  const localTitle='ชื่อจากฟอร์ม';
  const beforeTitle=await paper.getAttribute('data-run');
  const blankInk=await coverInk();
  const title=await nextRender(()=>whilePreviewHeld(()=>cover.getByLabel(/^title/).fill(localTitle),async()=>{
    assert.equal(await cover.getByLabel(/^title/).inputValue(),localTitle);
    assert.equal(await paper.getAttribute('data-run'),beforeTitle);
    assert.equal(await coverInk(),blankInk);
  }));
  assert.equal(title.request.sections[0].data.parts[0].data.title,'ชื่อจากฟอร์ม');
  assert.ok(await paper.getByRole('button',{name:'แก้ค่า ชื่อจากฟอร์ม',exact:true}).isVisible());
  const titleInk=await coverInk();
  const titleHit=paper.getByRole('button',{name:'แก้ค่า ชื่อจากฟอร์ม',exact:true});
  await titleHit.scrollIntoViewIfNeeded();
  const titleBox=await titleHit.boundingBox();
  assert.ok(titleBox);
  await page.mouse.move(titleBox.x+2,titleBox.y+titleBox.height/2);
  await page.mouse.down();
  await page.mouse.move(titleBox.x+Math.min(130,titleBox.width-2),titleBox.y+titleBox.height/2,{steps:6});
  await page.mouse.up();
  assert.equal(await editor.evaluate(input=>input===document.activeElement&&input.selectionEnd>input.selectionStart),true);
  assert.equal(await coverInk(),titleInk);
  await nextRender(()=>whilePreviewHeld(()=>editor.fill('ชื่อจากกระดาษ'),async()=>{
    assert.equal(await cover.getByLabel(/^title/).inputValue(),'ชื่อจากกระดาษ');
    assert.equal(await editor.evaluate(input=>getComputedStyle(input).opacity),'0');
    assert.equal(await coverInk(),titleInk);
    await page.locator('#trial-paper-markers .paper-caret').waitFor();
    await photo('01b-typing-with-engine-paper');
    await editor.press('Escape');
    assert.equal(await coverInk(),titleInk);
  }));
  assert.equal(await cover.getByLabel(/^title/).inputValue(),'ชื่อจากกระดาษ');
  assert.notEqual(await coverInk(),titleInk);
  await photo('01c-engine-paper-settled');

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
      requestValue(request,formatIndex,1)===burstValue;
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
  await paper.locator('.preview-page').nth(expanded.body.pageIndex-1).evaluate(page=>page.scrollIntoView());
  await paper.locator('.preview-page').nth(expanded.body.pageIndex).evaluate(page=>page.scrollIntoView());
  assert.equal(await editor.evaluate(el=>el===document.activeElement&&el.selectionStart===1507),true);
  const continued=await nextRender(()=>page.keyboard.insertText('ต่อ'));
  assert.equal(await editor.evaluate(el=>el===document.activeElement&&el.selectionStart===1510),true);
  assert.equal(continued.request.sections[0].data.parts[formatIndex].data.groups[0].members[1].menu,'เมนูไทย'+long+'ต่อเหมือนกัน');
  assert.equal(await first.inputValue(),'เมนูเหมือนกัน');

  // Repeated keydown without keyup exercises the browser's auto-repeat path.
  await first.focus();
  await first.evaluate(input=>input.setSelectionRange(input.value.length,input.value.length));
  const beforeHold=await paper.getAttribute('data-run');
  const heldValue='เมนูเหมือนกัน'+'a'.repeat(70);
  const heldResponse=page.waitForResponse(response=>{
    const request=response.request();
    return request.method()==='POST'&&response.url().endsWith(path+'/preview')&&
      requestValue(request,formatIndex,0)===heldValue;
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
  assert.equal(await second.inputValue(),'เมนูไทย'+long+'ต่อเหมือนกัน');
  assert.equal(await first.evaluate(input=>input===document.activeElement&&input.selectionStart===input.value.length),true);
  page.off('response',refreshSnapshots);
  await Promise.all(snapshotTasks);

  // Hold a real older result across a structural change. Its source paths must never become clickable.
  const stale=Promise.withResolvers(), release=Promise.withResolvers();
  const previewRoute='**/drafts/'+id+'/preview';
  const oldValue='ผลเก่าที่ต้องทิ้ง',newValue='ค่าล่าสุดหลังเพิ่มแถว';
  const intercept=async route=>{
    if(route.request().method()!=='POST'||requestValue(route.request(),formatIndex,0)!==oldValue)return route.continue();
    try{
      const response=await route.fetch();
      const body=await response.json();
      assert.equal(response.status(),200);
      stale.resolve(body.previewId);
      await release.promise;
      await route.fulfill({response});
    }catch(error){stale.reject(error);throw error;}
  };
  await page.route(previewRoute,intercept);
  await first.fill(oldValue);
  const staleId=await Promise.race([stale.promise,new Promise((_,reject)=>{
    const timer=setTimeout(()=>reject(Error('Expected held preview response')),25000);timer.unref();
  })]);
  await paper.evaluate(element=>{
    window.mountedTrialRuns=[];
    new MutationObserver(()=>window.mountedTrialRuns.push(element.dataset.run))
      .observe(element,{attributes:true,attributeFilter:['data-run']});
  });
  await members.getByRole('button',{name:'+ เพิ่มรายการ',exact:true}).click();
  await first.fill(newValue);
  const newestResponse=page.waitForResponse(response=>response.request().method()==='POST'&&response.url().endsWith(path+'/preview')&&
    response.request().postDataJSON().trial&&requestValue(response.request(),formatIndex,0)===newValue,{timeout:120000});
  release.resolve();
  const newest=await newestResponse, newestBody=await newest.json();
  assert.equal(newest.status(),200);
  assert.equal(newest.request().postDataJSON().trial.sections[0].data.parts[formatIndex].data.groups[0].members.length,3);
  await page.waitForFunction(run=>document.querySelector('#preview-paper').dataset.run===run,newestBody.previewId);
  assert.deepEqual(await page.evaluate(()=>window.mountedTrialRuns),[newestBody.previewId]);
  assert.notEqual(staleId,newestBody.previewId);
  assert.equal(await first.inputValue(),newValue);
  await page.unroute(previewRoute,intercept);
  const missingBase={basePreviewId:'00000000-0000-4000-8000-000000000000',changes:[]};
  const expired=await page.request.post(base+path+'/preview',{data:{expectedRevision:original.revision,trialPatch:missingBase}});
  assert.equal(expired.status(),409);
  assert.equal((await expired.json()).error,'trial_base_unavailable');
  const wrongRevision=await page.request.post(base+path+'/preview',{data:{expectedRevision:original.revision+1,trialPatch:missingBase}});
  assert.equal(wrongRevision.status(),409);
  assert.equal((await wrongRevision.json()).error,'STALE_CURRENT');
  let expiredPatchAttempts=0;
  const expireOnce=route=>{
    if(route.request().method()==='POST'&&route.request().postDataJSON().trialPatch){
      expiredPatchAttempts++;
      return route.fulfill({status:409,json:{error:'trial_base_unavailable'}});
    }
    return route.continue();
  };
  await page.route(previewRoute,expireOnce);
  const recoveredValue='ค่าหลังเริ่มฐานใหม่';
  const recoveredResponse=page.waitForResponse(response=>response.request().method()==='POST'&&response.url().endsWith(path+'/preview')&&
    response.request().postDataJSON().trial&&requestValue(response.request(),formatIndex,0)===recoveredValue,{timeout:120000});
  await first.fill(recoveredValue);
  const recovered=await recoveredResponse;
  assert.equal(recovered.status(),200);
  const recoveredBody=await recovered.json();
  await page.waitForFunction(run=>document.querySelector('#preview-paper').dataset.run===run,recoveredBody.previewId);
  assert.equal(expiredPatchAttempts,1);
  assert.equal(await first.inputValue(),recoveredValue);
  await page.unroute(previewRoute,expireOnce);
  assert.deepEqual(await read(),original);
  assert.deepEqual(writes,[]);
  assert.deepEqual(errors,[]);
  const result={draftId:id,revision:original.revision,initialBlank:true,allFormatsSeeded:true,continuousPreview:true,automaticBothDirections:true,
    renderPath:'engine-layout',pdfHashReturned:false,distinctRenderRuns:runs.length,repeatedRowOwnership:true,
    derivedContents:true,duplicateContentsRejected:true,unsupportedGlyphRejected:true,continuousThaiStrokes:burst.length,updatesDuringTyping:[...updates.values()],
    heldFormKeydowns:70,engineUpdatesBeforeKeyup:heldRuns.size,staleRenderDropped:true,staleRevisionRejected:true,missingBaseRejected:true,missingBaseRecovered:true,
    finalThaiEngineMs:Math.round(final.engineMs),finalThaiLabRenderMs:Math.round(final.renderMs),
    tabAndShiftTab:true,caretAfterPageReflow:true,scrollBackAndContinue:true,
    engineInkUnchangedUntilEngineReply:true,selectionUsesPaperGeometry:true,expandedPages:expanded.body.pageCount,definitionWrites:0};
  await writeFile(join(output,'trial-preview-verification.json'),JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify(result));
}finally{await browser.close();}
