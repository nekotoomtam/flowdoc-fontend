import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {chromium} from '@playwright/test';

const base=process.env.FLOWDOC_PHASE1_URL??'http://127.0.0.1:5175';
const source=process.env.FLOWDOC_PAPER_DRAFT_ID;
assert.ok(source,'Set FLOWDOC_PAPER_DRAFT_ID to a saved UAT Model 20 draft');
const out=resolve(process.env.FLOWDOC_TRIAL_EVIDENCE??'experiments/uat-continuous-local');
await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'msedge'});
const page=await browser.newPage({viewport:{width:1280,height:900}});
page.setDefaultTimeout(20000);
const api=base+'/api/editor-phase1/drafts';
try{
  const read=await page.request.get(api+'/'+source);
  const original=(await read.json()).value.definition;
  const definition=structuredClone(original);
  definition.docKey='editor-draft-continuous-'+Date.now().toString(36);
  definition.name='UAT ตรวจ Section ต่อเนื่อง';
  const section=randomUUID(),layout=randomUUID(),style=Object.keys(definition.styles)[0];
  definition.pageLayouts[layout]={page:{size:'A4',orientation:'landscape',
    margin:Object.fromEntries(['top','right','bottom','left'].map(side=>[side,{value:36,unit:'pt'}]))}};
  const text=(id,key)=>({id,type:'text-block',role:{role:'paragraph'},props:{textStyleId:style},
    children:[{id:id+'-leaf',type:'field-ref',scope:'section',key}]});
  definition.sections.push({id:section,sectionKey:'S0002',label:'ส่วนทดสอบที่สอง',nameBase:'ส่วนทดสอบที่สอง',pageLayoutId:layout,
    inputSchema:{type:'object',fields:{firstValue:{type:'string'},secondValue:{type:'string'}}},
    source:{kind:'authored',repeats:[],fragment:{rootIds:['start','break','end'],nodes:{
      start:text('start','firstValue'),break:{id:'break',type:'page-break'},end:text('end','secondValue'),
    }}}});
  const created=await page.request.post(api,{data:{definition,idempotencyKey:randomUUID()}});
  const saved=await created.json();
  assert.equal(created.status(),201,JSON.stringify(saved.issues??saved.error));
  const draft=saved.value,route='/api/editor-phase1/drafts/'+draft.templateId;
  await page.goto(base+'/phase1-editor.html?id='+draft.templateId);
  const authored=page.locator('#paper .definition-section');
  await authored.nth(1).waitFor();
  assert.equal(await authored.count(),2);
  assert.equal(await authored.nth(1).locator('.definition-sheet').count(),2);
  const bounds=await authored.evaluateAll(items=>items.map(item=>{
    const box=item.getBoundingClientRect();return [box.top,box.bottom];
  }));
  assert.ok(bounds[0][1]<bounds[1][0]);
  assert.equal(await page.locator('#variables [data-scope=local]').count(),Object.keys(original.areaFormats).length);
  assert.equal(await page.locator('#variables [data-variable-path=secondValue]').count(),1);
  assert.equal(await page.locator('#variables [data-variable-path="groups[].members[].menu"]').count(),1);
  await authored.nth(1).locator('.definition-section-control').click();
  assert.equal(await authored.count(),2);
  await page.screenshot({path:join(out,'04-authoring-section-stack.png')});

  const post=()=>page.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith(route+'/preview'),{timeout:120000});
  const started=post();
  await page.getByRole('button',{name:'ลองข้อมูล / Preview',exact:true}).click();
  const first=await started,preview=await first.json();
  assert.equal(first.status(),200,JSON.stringify(preview.issues??preview.error));
  assert.equal(preview.renderPath,'engine-layout');
  const entries=first.request().postDataJSON().trial.sections;
  assert.equal(entries.length,2);
  assert.equal(entries[0].data.parts.length,Object.keys(original.areaFormats).length);
  assert.equal(entries[1].data.secondValue,'');
  const captions=preview.pageSizes.map(page=>page[2]);
  assert.equal(captions.at(-1),'ส่วนทดสอบที่สอง');
  assert.equal(captions.at(-2),'ส่วนทดสอบที่สอง');
  assert.notEqual(captions[0],captions.at(-1));
  const pages=page.locator('#preview-paper .preview-page');
  await pages.last().waitFor();
  assert.equal(await pages.count(),preview.pageCount);
  await pages.last().scrollIntoViewIfNeeded();
  const last=pages.last();
  await last.getByRole('button',{name:'พิมพ์ค่า secondValue',exact:true}).waitFor();
  assert.ok(await pages.nth(preview.pageCount-2).evaluate(el=>el.nextElementSibling?.classList.contains('preview-page')));
  const secondRun=post();
  await last.getByRole('button',{name:'พิมพ์ค่า secondValue',exact:true}).click();
  await page.keyboard.insertText('พิมพ์จากหน้าท้าย');
  assert.equal(await page.locator('#trial-form').getByLabel(/^secondValue/).inputValue(),'พิมพ์จากหน้าท้าย');
  const edited=await secondRun,reply=await edited.json();
  assert.equal(edited.status(),200,JSON.stringify(reply.issues??reply.error));
  assert.equal(reply.pageIndex,preview.pageCount-1);
  await last.getByRole('button',{name:'แก้ค่า พิมพ์จากหน้าท้าย',exact:true}).waitFor();
  await page.screenshot({path:join(out,'05-preview-continuous-last-section.png')});
  const result={templateId:draft.templateId,sections:2,formats:Object.keys(original.areaFormats).length,
    authoringSectionSheets:3,previewPages:preview.pageCount,previewPageLabels:captions,lazyScrollToLast:true,
    editedLastSectionValue:true};
  await writeFile(join(out,'continuous-section-verification.json'),JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify(result));
}finally{await browser.close();}
