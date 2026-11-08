import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {chromium} from '@playwright/test';

const id=process.env.FLOWDOC_PAPER_DRAFT_ID,asset=process.env.FLOWDOC_TRIAL_IMAGE;
assert.ok(id&&asset,'Set a saved Model 20 UAT draft ID and a PNG test file');
const base=process.env.FLOWDOC_PHASE1_URL??'http://127.0.0.1:5175';
const output=resolve(process.env.FLOWDOC_TRIAL_EVIDENCE??'experiments/uat-trial-local');
await mkdir(output,{recursive:true});
const browser=await chromium.launch({channel:'msedge'});
const page=await browser.newPage({viewport:{width:1280,height:900}});
page.setDefaultTimeout(12000);
const errors=[],writes=[];
page.on('pageerror',error=>errors.push(error.message));
page.on('request',request=>{if(['PUT','PATCH','DELETE'].includes(request.method()))writes.push(request.url());});
const form=page.locator('#trial-form'),paper=page.locator('#preview-paper');
const render=form.getByRole('button',{name:'จัดหน้าจากข้อมูลนี้',exact:true});
const path='/api/editor-phase1/drafts/'+id;
const read=async()=>(await (await page.request.get(base+path)).json()).value;
async function sectionEntry(format){
  await form.getByRole('button',{name:'+ เพิ่ม Format ในพื้นที่',exact:true}).click();
  const entries=form.locator('fieldset').filter({has:page.locator('legend').filter({hasText:'พื้นที่ parts'})})
    .locator(':scope > .trial-rows > details');
  const entry=entries.nth((await entries.count())-1);
  await entry.getByRole('combobox',{name:'Format',exact:true}).selectOption(format);
  return entry;
}
async function preview(){
  const response=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith(path+'/preview'),{timeout:120000});
  await render.click();
  const reply=await response,body=await reply.json();
  assert.equal(reply.status(),200,JSON.stringify(body.issues??body.error));
  return {body,request:reply.request().postDataJSON()};
}
try{
  const original=await read();
  await page.goto(base+'/phase1-editor.html?id='+id);
  await page.getByRole('button',{name:'ลองข้อมูล / Preview',exact:true}).click();
  await form.getByLabel(/headerBanner/).setInputFiles({name:'trial-banner.png',mimeType:'image/png',buffer:await readFile(asset)});
  await form.getByLabel(/docVersion/).fill('ทดลอง 42');
  const heading=await sectionEntry('heading');
  await heading.getByLabel(/title/).fill('ทดสอบกระดาษเสมือน');
  await heading.getByLabel(/anchor/).fill('trial-heading');
  await sectionEntry('break');
  const summary=await sectionEntry('summary-dynamic');
  const groupField=summary.locator('fieldset').filter({has:page.locator('legend').filter({hasText:/^groups/})}).first();
  await groupField.getByRole('button',{name:'+ เพิ่มรายการ',exact:true}).first().click();
  const group=groupField.locator(':scope > .trial-rows > details').first();
  await group.getByLabel(/^name/).fill('กลุ่มทดลอง');
  await group.getByRole('button',{name:'+ เพิ่มรายการ',exact:true}).click();
  const member=group.locator('fieldset .trial-rows > details').first();
  for(const [name,value] of Object.entries({menu:'เมนูทดสอบ',cases:'7',pass:'6',fail:'1'}))
    await member.getByLabel(new RegExp('^'+name)).fill(value);
  const result=await preview();
  assert.ok(result.body.previewId&&result.body.pageCount>=2);
  assert.deepEqual(result.request.trial.sections[0].data.parts.map(part=>part.format),['heading','break','summary-dynamic']);
  assert.equal(result.request.trial.sections[0].data.parts[2].data.groups[0].members[0].menu,'เมนูทดสอบ');
  await paper.locator('svg').waitFor();
  assert.ok(await paper.locator('image').count()>0);
  assert.match(await paper.locator('[aria-label]').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('aria-label')).join(' ')),/ทดสอบกระดาษเสมือน/);
  await page.screenshot({path:join(output,'preview-input-and-paper.png')});
  const nextResponse=page.waitForResponse(r=>r.url().includes('/preview-runs/'+result.body.previewId+'/pages/1'));
  await page.getByRole('button',{name:'หน้าถัดไป',exact:true}).click();
  const second=await (await nextResponse).json();
  assert.ok(second.page.lines.some(line=>line.text.includes('เมนูทดสอบ')));
  await page.getByText(/^2 \/ /).waitFor();
  await page.screenshot({path:join(output,'preview-nested-table.png')});
  await heading.getByLabel(/title/).fill('ทดลองฉบับใหม่');
  assert.equal(await paper.locator('svg').count(),0);
  const updated=await preview();
  assert.notEqual(updated.body.previewId,result.body.previewId);
  assert.ok(updated.body.pages[0].lines.some(line=>line.text.includes('ทดลองฉบับใหม่')));
  assert.deepEqual(await read(),original);
  assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);
  const proof={draftId:id,revision:original.revision,pages:result.body.pageCount,realEngine:result.body.engineVersion,
    nestedArray:true,imageUpload:true,orderedFormats:true,changedInputRerendered:true,definitionWrites:0};
  await writeFile(join(output,'trial-preview-verification.json'),JSON.stringify(proof,null,2)+'\n');
  console.log(JSON.stringify(proof));
}finally{await browser.close();}
