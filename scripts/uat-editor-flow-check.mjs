import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {chromium} from '@playwright/test';

const base=process.env.FLOWDOC_PHASE1_URL??'http://127.0.0.1:5175';
const output=resolve(process.env.FLOWDOC_UAT_FLOW_EVIDENCE??'experiments/uat-flow-local');
await mkdir(output,{recursive:true});
const browser=await chromium.launch({channel:'msedge'});
const page=await browser.newPage({viewport:{width:1280,height:800}});
const originalText='Module Scope';
const testText='Module Scope · ตรวจ flow';
const calls=[];
page.on('request',request=>{if(new URL(request.url()).pathname.startsWith('/api/'))calls.push(request.method()+' '+request.url());});
let initial, endpoint, savedRevision;
async function open(){
  await page.goto(base+'/library.html?phase1=1');
  await page.locator('[data-doc-key=stage6-uat-editor-phase1]').getByRole('button',{name:/^เปิดแก้ไข UAT/}).click();
  await page.locator('#paper .definition-format').waitFor();
  return base+'/api/editor-phase1/drafts/'+new URL(page.url()).searchParams.get('id');
}
async function read(){
  const response=await page.request.get(endpoint);
  assert.equal(response.status(),200);return (await response.json()).value;
}
async function save(){
  const response=page.waitForResponse(response=>response.request().method()==='PUT'&&response.url()===endpoint+'/structure');
  await page.getByRole('button',{name:'บันทึกโครง',exact:true}).click();
  const result=await response;
  assert.equal(result.status(),200,await result.text());
  await page.getByRole('button',{name:'บันทึกโครง',exact:true}).waitFor();
  return (await result.json()).value;
}
const paperText=text=>page.locator('#paper').getByRole('button',{name:text,exact:true});
try{
  endpoint=await open();initial=await read();
  assert.equal(await page.getByRole('button',{name:'บันทึกโครง',exact:true}).isDisabled(),true);
  await page.screenshot({path:join(output,'01-editor-entry.png')});
  await page.locator('.format-picker summary').click();
  await page.locator('.format-picker').getByRole('button',{name:'summary-dynamic',exact:true}).click();
  await paperText('{{menu}}').click();
  assert.match(await page.locator('#path').textContent(),/summary-dynamic.*เซลล์ 2/);
  assert.match(await page.locator('#variable-detail').textContent(),/members\[\].*menu/);
  await page.getByRole('button',{name:'ขยายกระดาษ'}).click();
  assert.equal(await page.locator('#paper-zoom').textContent(),'125%');
  await page.getByRole('button',{name:'ย่อกระดาษ'}).click();
  await page.screenshot({path:join(output,'02-selected-variable.png')});
  await page.locator('.format-picker summary').click();
  await page.locator('.format-picker').getByRole('button',{name:'cover',exact:true}).click();
  await paperText(originalText).dblclick();
  await page.getByLabel('แก้ข้อความบนกระดาษ').waitFor();
  assert.equal(await page.getByLabel('แก้ข้อความบนกระดาษ').inputValue(),originalText);
  await page.getByLabel('แก้ข้อความบนกระดาษ').fill(testText);
  await page.screenshot({path:join(output,'03-inline-editor.png')});
  await page.getByRole('button',{name:'ใช้ข้อความนี้',exact:true}).click();
  await paperText(testText).waitFor();
  assert.equal(await page.getByRole('button',{name:'บันทึกโครง',exact:true}).isEnabled(),true);
  assert.deepEqual((await read()).definition,initial.definition);
  const after=await save();
  savedRevision=after.revision;
  assert.equal(savedRevision,initial.revision+1);
  const expect=structuredClone(initial.definition);
  const cover=Object.values(expect.areaFormats).find(f=>f.key==='cover');
  const matches=Object.values(cover.fragment.nodes).flatMap(n=>n.children??[]).filter(c=>c.type==='text'&&c.text===originalText);
  assert.equal(matches.length,1);matches[0].text=testText;
  assert.deepEqual(after.definition,expect);
  await open();await paperText(testText).waitFor();
  await page.screenshot({path:join(output,'04-saved-and-reopened.png')});
  await paperText(testText).click();
  await page.getByRole('button',{name:'แก้ข้อความ',exact:true}).click();
  await page.getByLabel('แก้ข้อความบนกระดาษ').fill(originalText);
  await page.getByRole('button',{name:'ใช้ข้อความนี้',exact:true}).click();
  const restored=await save();assert.equal(restored.revision,savedRevision+1);
  assert.deepEqual((await read()).definition,initial.definition);
  assert.ok(calls.every(call=>!call.includes('/preview')));
  const result={fromRevision:initial.revision,savedRevision,restoredRevision:restored.revision,
    directPaperEdit:true,sameNodeOnly:true,reopenConfirmed:true,zoomConfirmed:true,previewRequests:0};
  await writeFile(join(output,'flow-verification.json'),JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify(result));
}finally{
  if(savedRevision&&initial){
    const current=await read().catch(()=>null);
    if(current?.revision===savedRevision){
      await page.request.put(endpoint+'/structure',{data:{definition:initial.definition,
        expectedRevision:savedRevision,idempotencyKey:randomUUID()}});
    }
  }
  await browser.close();
}
