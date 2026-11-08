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
  await photo('01-uat-cover-ready-from-blank');
  const title=await nextRender(()=>form.getByLabel(/^title/).fill('ชื่อจากฟอร์ม'));
  assert.equal(title.request.sections[0].data.parts[0].data.title,'ชื่อจากฟอร์ม');
  assert.ok(await paper.getByRole('button',{name:'แก้ค่า ชื่อจากฟอร์ม',exact:true}).isVisible());
  await paper.getByRole('button',{name:'แก้ค่า ชื่อจากฟอร์ม',exact:true}).click();
  await nextRender(()=>editor.fill('ชื่อจากกระดาษ'));
  assert.equal(await form.getByLabel(/^title/).inputValue(),'ชื่อจากกระดาษ');

  // A fresh view starts from the Format selected in the saved definition editor.
  await page.reload();
  const tree=page.locator('#tree');
  await tree.getByRole('button',{name:'ขยายหรือยุบ parts',exact:true}).click();
  await tree.locator('[data-kind=format]').getByText('summary-dynamic',{exact:true}).click();
  const blankTable=await nextRender(open);
  const sample=blankTable.request.sections[0].data.parts[0];
  assert.equal(sample.format,'summary-dynamic');
  assert.equal(sample.data.groups[0].members[0].menu,'');
  assert.ok(await paper.getByRole('button',{name:'พิมพ์ค่า menu',exact:true}).isVisible());
  const members=form.getByRole('group',{name:/^members/});
  await nextRender(()=>members.getByRole('button',{name:'+ เพิ่มรายการ',exact:true}).click());
  const rows=members.locator(':scope > .trial-rows > details');
  const first=rows.nth(0).getByLabel(/^menu/),second=rows.nth(1).getByLabel(/^menu/);
  await nextRender(()=>first.fill('เมนูเหมือนกัน'));
  await nextRender(()=>second.fill('เมนูเหมือนกัน'));
  if(asset)await nextRender(async()=>{
    await form.getByLabel(/headerBanner/).setInputFiles({name:'trial-banner.png',mimeType:'image/png',buffer:await readFile(asset)});
  });
  const identical=paper.getByRole('button',{name:'แก้ค่า เมนูเหมือนกัน',exact:true});
  assert.equal(await identical.count(),2);
  await identical.nth(1).click();
  await editor.evaluate(input=>input.setSelectionRange(4,4));
  const paperResult=await nextRender(()=>page.keyboard.insertText('ไทย'));
  assert.deepEqual(paperResult.request.sections[0].data.parts[0].data.groups[0].members.map(row=>row.menu),
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
  assert.deepEqual(await read(),original);
  assert.deepEqual(writes,[]);
  assert.deepEqual(errors,[]);
  const result={draftId:id,revision:original.revision,initialBlank:true,seededFromSelectedFormat:true,automaticBothDirections:true,
    renderPath:'engine-layout',pdfHashReturned:false,distinctRenderRuns:runs.length,repeatedRowOwnership:true,
    tabAndShiftTab:true,caretAfterPageReflow:true,expandedPages:expanded.body.pageCount,definitionWrites:0};
  await writeFile(join(output,'trial-preview-verification.json'),JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify(result));
}finally{await browser.close();}
