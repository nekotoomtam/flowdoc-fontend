import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {chromium} from '@playwright/test';

const base=process.env.FLOWDOC_PHASE1_URL??'http://127.0.0.1:5175';
const id=process.env.FLOWDOC_PAPER_DRAFT_ID;
assert.ok(id,'Set FLOWDOC_PAPER_DRAFT_ID to a saved UAT draft created from blank');
const output=resolve(process.env.FLOWDOC_PAPER_EVIDENCE??'experiments/uat-paper-toolbar-local');
await mkdir(output,{recursive:true});
const browser=await chromium.launch({channel:'msedge'});
const page=await browser.newPage({viewport:{width:1280,height:850}});
page.setDefaultTimeout(6000);
const errors=[],writes=[];
page.on('pageerror',error=>errors.push(error.message));
page.on('request',request=>{
  if(new URL(request.url()).pathname.startsWith('/api/')&&request.method()!=='GET')writes.push(request.url());
});
const tools=page.locator('#paper-actions');
const paper=page.locator('#paper');
const tree=page.locator('#tree');
const undo=()=>page.locator('#undo-structure').click();
const photo=name=>page.screenshot({path:join(output,name+'.png')});
const menu=label=>tools.getByText(label,{exact:true});
async function command(group,label){
  await menu(group).click();
  await tools.getByRole('button',{name:label,exact:true}).click();
}
try{
  await page.goto(base+'/phase1-editor.html?id='+encodeURIComponent(id));
  await menu('+ เพิ่ม').waitFor();
  assert.match(await page.locator('#paper-selection').textContent(),/Section/);
  for(const label of ['+ เพิ่ม','แก้ไข','จัดตำแหน่ง'])assert.ok(await menu(label).isVisible());
  await photo('05-paper-toolbar-on-open');
  await command('+ เพิ่ม','+ เพิ่ม Section');
  const form=page.locator('#structure-form');
  await form.locator('[name=label]').fill('ทดสอบปุ่มเหนือกระดาษ');
  await form.getByRole('button',{name:'ยืนยัน',exact:true}).click();
  assert.equal(await tree.locator('[data-kind=section]').count(),2);
  await undo();
  assert.equal(await tree.locator('[data-kind=section]').count(),1);

  await tree.locator('[data-kind=format]').getByText('cover',{exact:true}).click();
  const blocks=paper.locator('.definition-format > .definition-block');
  const order=()=>blocks.evaluateAll(rows=>rows.map(row=>row.querySelector('[data-paper-ref]')?.dataset.paperRef));
  const before=await order();
  assert.ok(before.length>1);
  await page.getByRole('button',{name:'แสดงจุดเลือก',exact:true}).click();
  await blocks.nth(1).locator(':scope > button[data-paper-ref]').first().click();
  await command('จัดตำแหน่ง','เลื่อนขึ้น');
  assert.deepEqual(await order(),[before[1],before[0],...before.slice(2)]);
  await undo();
  assert.deepEqual(await order(),before);
  await page.getByRole('button',{name:'ซ่อนจุดเลือก',exact:true}).click();

  const text=paper.getByRole('button',{name:'Copyright © TTT Brother CO., LTD.',exact:true});
  await text.click();
  await command('แก้ไข','แก้ข้อความ');
  await page.locator('#inline-value').fill('ข้อความที่แก้จากกระดาษ');
  await page.locator('#inline-value').press('Enter');
  await paper.getByRole('button',{name:'ข้อความที่แก้จากกระดาษ',exact:true}).waitFor();
  await undo();
  await text.waitFor();
  await text.click();
  await tools.getByRole('button',{name:'เลือกส่วนแม่',exact:true}).click();
  await command('แก้ไข','แก้รูปแบบรายการนี้');
  const dialog=page.locator('#visual-definition-dialog');
  await dialog.waitFor();
  assert.match(await dialog.getByRole('heading').textContent(),/แก้รูปแบบ/);
  assert.ok(await dialog.locator('details[open]').count()>0);
  await dialog.getByRole('button',{name:'ปิด',exact:true}).click();
  await menu('จัดตำแหน่ง').click();
  await photo('06-paper-move-menu');
  await page.setViewportSize({width:640,height:850});
  await page.reload();
  await menu('+ เพิ่ม').waitFor();
  const toolbar=await tools.boundingBox();
  assert.ok(toolbar&&toolbar.y+toolbar.height<850,'Paper actions are visible on open in a narrow window');
  assert.deepEqual(errors,[]);
  assert.deepEqual(writes,[]);
  console.log(JSON.stringify({id,addedSection:true,reorderedOnPaper:true,editedText:true,openedSelectedStyle:true,changesUndone:true,writes:0}));
}finally{await browser.close();}
