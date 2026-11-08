import assert from 'node:assert/strict';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {chromium} from '@playwright/test';

const base=process.env.FLOWDOC_PHASE1_URL??'http://127.0.0.1:5175';
const output=resolve(process.env.FLOWDOC_PHASE2_EVIDENCE??'experiments/phase2-local');
const baseline=process.env.FLOWDOC_PHASE1_BASELINE;
await mkdir(output,{recursive:true});
const browser=await chromium.launch({channel:'msedge'});
const context=await browser.newContext({viewport:{width:1440,height:900}});
await context.addInitScript(()=>sessionStorage.setItem('flowdoc:benchmark-preview','1'));
const rows=[], errors=[], mutation=[], saves=[];
const by=(p,id)=>p.locator('#'+id);
const ref=(sectionId,formatId='',band='',nodeId='')=>JSON.stringify([sectionId,formatId,band,nodeId]);
const tree=(p,kind)=>p.locator('#tree [data-kind="'+kind+'"]').first();
const selected=p=>p.locator('#tree [aria-current=true]');
const chosen=async p=>JSON.parse(await selected(p).getAttribute('data-ref'));
const action=(p,name)=>by(p,'actions').getByRole('button',{name,exact:true});
const measure=(p,name)=>p.evaluate(key=>performance.getEntriesByName(key).map(e=>({ms:e.duration,detail:e.detail})),name);
const wait=(p,name,count)=>p.waitForFunction(([key,n])=>performance.getEntriesByName(key).length>=n,[name,count]);
const address=(p,suffix='')=>base+'/api/editor-phase1/drafts/'+new URL(p.url()).searchParams.get('id')+suffix;
const reply=async p=>{const response=await p.request.get(address(p));assert.equal(response.status(),200);return (await response.json()).value;};
async function open(){
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.bringToFront();
  await page.goto(base+'/library.html?phase1=1');
  await page.locator('[data-doc-key=stage6-uat-editor-phase1]').getByRole('button',{name:/^เปิดแก้ไข UAT/}).click();
  await wait(page,'flowdoc:open-from-library',1);
  await page.locator('#advanced-details > summary').click();
  return page;
}
async function pick(p,refValue){
  const value=JSON.parse(refValue);
  const ids=[value[3],value[1],value[0]].filter(Boolean);
  // Expand by accessible names only when the item has not been materialized.
  const control=()=>p.locator('#tree button[data-ref]').filter({visible:true}).evaluateAll((nodes,expected)=>nodes.findIndex(n=>n.dataset.ref===expected),refValue);
  let pos=await control();
  if(pos<0){
    for(let i=0;i<12&&pos<0;i++){
      const closed=p.locator('#tree button.toggle[aria-expanded=false]:visible');
      if(!await closed.count())break;
      const candidate=await closed.evaluateAll((nodes,keys)=>nodes.findIndex(n=>keys.includes(n.nextElementSibling.dataset.nodeId)),ids.slice(1));
      await closed.nth(candidate<0?0:candidate).click();
      pos=await control();
    }
  }
  assert.ok(pos>=0,'Tree did not show '+refValue);
  await p.locator('#tree button[data-ref]:visible').nth(pos).click();
}
async function form(p,values={}){
  const f=by(p,'structure-form');
  for(const [key,value] of Object.entries(values)){
    const el=f.locator('[name="'+key+'"]');
    if(await el.evaluate(e=>e.tagName)==='SELECT')await el.selectOption(value);
    else await el.fill(value);
  }
  await f.getByRole('button',{name:'ยืนยัน',exact:true}).click();
}
async function edit(p,fn){
  const n=(await measure(p,'flowdoc:structure-edit')).length;
  await fn();await wait(p,'flowdoc:structure-edit',n+1);
  mutation.push((await measure(p,'flowdoc:structure-edit')).at(-1));
  assert.equal(await by(p,'structure-pending').isVisible(),true);
}
const addSection=(p,label)=>edit(p,async()=>{await by(p,'add-section').click();await form(p,{label});});
const addArea=(p,key,format)=>edit(p,async()=>{await action(p,'+ เพิ่ม Area').click();await form(p,{key,format});});
const addFormat=(p,key)=>edit(p,async()=>{await action(p,'+ เพิ่ม Format').click();await form(p,{key});});
const addNode=(p,type)=>edit(p,async()=>{await action(p,'+ เพิ่ม node').click();await form(p,{type});});
const del=p=>edit(p,async()=>{await action(p,'ลบรายการนี้').click();await form(p);});
const move=(p,target)=>edit(p,async()=>{await action(p,'ย้ายไป…').click();await form(p,{target});});
const run=(p,name)=>edit(p,()=>action(p,name).click());
const step=async(name,fn)=>{await fn();rows.push(name);console.log('PASS '+name);};
async function save(p){
  const count=(await measure(p,'flowdoc:structure-save')).length;
  const event=p.waitForResponse(r=>r.request().method()==='PUT'&&r.url().endsWith('/structure'));
  await by(p,'save-structure').click();
  const response=await event, body=await response.json();
  assert.equal(response.status(),200,JSON.stringify(body));
  await wait(p,'flowdoc:structure-save',count+1);
  saves.push((await measure(p,'flowdoc:structure-save')).at(-1).ms);
  return body.value;
}
function verifyGraph(fragment){
  const seen=new Set();
  function visit(id){
    assert.ok(!seen.has(id),'Multiple parents '+id);
    const node=fragment.nodes[id];assert.ok(node,'Missing child '+id);seen.add(id);
    for(const child of node.rowIds??node.cellIds??node.childIds??node.columns?.flatMap(c=>c.childIds??[])??[])visit(child);
  }
  fragment.rootIds.forEach(visit);
  assert.equal(seen.size,Object.keys(fragment.nodes).length);
}
const stat=values=>{const a=[...values].sort((x,y)=>x-y);const r=x=>Math.round(x*10)/10;return{samples:a.length,medianMs:r(a[Math.ceil(a.length/2)-1]),p95Ms:r(a[Math.ceil(a.length*.95)-1]),maxMs:r(a.at(-1))};};
try{
 const p=await open(), stale=await open();
 await p.bringToFront();
 const initial=await reply(p), def=initial.definition, original=def.sections[0].id, mark=Date.now().toString().slice(-7);
 const scope='P2'+mark;
 await writeFile(join(output,'initial-draft.json'),JSON.stringify(initial,null,2)+'\n');
 const summary=Object.keys(def.areaFormats).find(k=>def.areaFormats[k].key==='summary-dynamic');
 assert.ok(summary);
 let a,b,alpha,beta,fmt,table,row,second,firstCell,secondCell,child,extra,grouped;
 await step('เลือก Area จากกระดาษแล้ว Tree เปิดกิ่งให้เห็นตำแหน่ง',async()=>{
   const root=tree(p,'section'),toggle=root.locator('..').locator('button.toggle');
   await toggle.click();
   assert.equal(await tree(p,'area').isVisible(),false);
   await by(p,'paper').getByRole('button',{name:'parts',exact:true}).click();
   assert.equal(await tree(p,'area').isVisible(),true);
   assert.equal(await tree(p,'area').getAttribute('aria-current'),'true');
 });
 await step('เพิ่ม Section A แล้วจัดลำดับขึ้น',async()=>{await addSection(p,'เฟส 2 A '+mark);[a]=await chosen(p);await run(p,'เลื่อนขึ้น');assert.equal(JSON.parse(await tree(p,'section').getAttribute('data-ref'))[0],a);});
 await step('เพิ่ม Area alpha พร้อม Format แรก',async()=>{await addArea(p,scope+'alpha','base');alpha=(await chosen(p))[3];});
 await step('เพิ่ม Format อีกหนึ่งตัวใน Area alpha',async()=>{await addFormat(p,'transfer');fmt=(await chosen(p))[1];});
 await step('เพิ่ม Section B และ Area beta',async()=>{await addSection(p,'เฟส 2 B '+mark);[b]=await chosen(p);await addArea(p,scope+'beta','destination');beta=(await chosen(p))[3];});
 await step('ย้าย Area alpha ข้าม Section และรักษา node id',async()=>{await pick(p,ref(a,'','',alpha));await move(p,ref(b));assert.deepEqual(await chosen(p),[b,'','',alpha]);});
 await step('ย้าย Format ข้าม Area โดยคง Format id',async()=>{await pick(p,ref(b,fmt));await move(p,ref(b,'','',beta));assert.deepEqual(await chosen(p),[b,fmt,'','']);});
 await step('เพิ่ม table และแถว พร้อมสร้าง cell ที่ Core ต้องการ',async()=>{await addNode(p,'table');table=(await chosen(p))[3];await run(p,'+ เพิ่มแถว');second=(await chosen(p))[3];});
 await step('เลื่อนแถว แล้วลบเฉพาะแถวที่ย้าย',async()=>{await run(p,'เลื่อนขึ้น');await del(p);assert.equal((await chosen(p))[3],table);});
 await step('เพิ่มข้อความในเซลล์ แล้วย้ายไปอีกเซลล์ในแถวเดิม',async()=>{
   const rowButton=p.locator('#tree [data-kind=table-row]:visible').first();
   row=await rowButton.getAttribute('data-node-id');
   await rowButton.locator('..').getByRole('button',{name:/ขยายหรือยุบ/}).click();
   const cells=p.locator('#tree [data-kind=table-cell]:visible');
   firstCell=await cells.nth(0).getAttribute('data-node-id');secondCell=await cells.nth(1).getAttribute('data-node-id');
   await pick(p,ref(b,fmt,'',firstCell));await addNode(p,'text-block');child=(await chosen(p))[3];
   await move(p,ref(b,fmt,'',secondCell));assert.equal((await chosen(p))[3],child);
 });
 await step('ผสานเซลล์ขวา แยกเซลล์ แล้วย้อนให้กลับเป็นผสาน',async()=>{
   await pick(p,ref(b,fmt,'',firstCell));await run(p,'ผสานกับเซลล์ขวา');await run(p,'แยกเซลล์');
   await by(p,'undo-structure').click();
   assert.equal(await by(p,'structure-pending').isVisible(),true);
 });
 await step('เพิ่ม line ใน Format และเลื่อนลำดับ node',async()=>{await pick(p,ref(b,fmt));await addNode(p,'line');extra=(await chosen(p))[3];await run(p,'เลื่อนขึ้น');});
 await step('สร้าง Row Group จาก schema groups[].members[] ของ UAT',async()=>{
   await pick(p,ref(original,summary));await addNode(p,'table');grouped=(await chosen(p))[3];
   await edit(p,async()=>{await action(p,'+ เพิ่ม Row Group').click();await form(p,{source:'0'});});
 });
 const saved=await save(p);
 await step('Service/Core รับโครงทั้งชุดและเปิดใหม่แล้วความสัมพันธ์ตรง',async()=>{
   assert.equal(saved.revision,initial.revision+1);
   const reload=await open();const persisted=await reply(reload);assert.deepEqual(persisted.definition,saved.definition);
   const doc=persisted.definition, sa=doc.sections.find(s=>s.id===a),sb=doc.sections.find(s=>s.id===b);
   assert.equal(doc.sections[0].id,a);assert.equal(sa.source.kind,'blank');
   const alphaField=sb.inputSchema.fields[scope+'alpha'], betaField=sb.inputSchema.fields[scope+'beta'];
   assert.equal(sb.source.fragment.nodes[alpha].props.areaId,alphaField.areaId);
   assert.equal(sb.source.fragment.nodes[beta].props.areaId,betaField.areaId);
   const f=doc.areaFormats[fmt],n=f.fragment.nodes;
   assert.equal(f.ownerAreaId,betaField.areaId);assert.equal(n[table].rowIds.length,1);assert.equal(n[table].rowIds[0],row);
   assert.ok(!n[second]);assert.equal(n[firstCell].props.colSpan,2);
   assert.ok(n[firstCell].childIds.includes(child));assert.ok(!n[secondCell]);
   assert.ok(f.fragment.rootIds.indexOf(extra)<f.fragment.rootIds.indexOf(table));
   const group=doc.areaFormats[summary].rowGroups.find(g=>g.tableId===grouped);
   assert.equal(group.rowTemplateIds.length,3);assert.equal(group.memberRepeat.source.key,'members');
   for(const section of doc.sections)if(section.source.fragment)verifyGraph(section.source.fragment);
   for(const format of Object.values(doc.areaFormats))verifyGraph(format.fragment);
   await by(reload,'preview-tab').click();
   await wait(reload,'flowdoc:engine-preview',1);
   const modified=(await measure(reload,'flowdoc:engine-preview')).at(-1);
   assert.equal(modified.detail.revision,saved.revision);
   assert.ok(modified.detail.pageCount>=2);
   await reload.close();await p.bringToFront();
 });
 await step('ฉบับโครงเก่าบันทึกทับไม่ได้และการแก้ค้างอยู่',async()=>{
   await stale.bringToFront();await addSection(stale,'ชื่อจาก revision เก่า');
   const event=stale.waitForResponse(r=>r.request().method()==='PUT'&&r.url().endsWith('/structure'));
   await by(stale,'save-structure').click();const res=await event;
   assert.equal(res.status(),409);assert.equal((await res.json()).issues[0].code,'STALE_CURRENT');
   await by(stale,'conflict').waitFor({state:'visible'});
   assert.equal(await by(stale,'structure-pending').isVisible(),true);
   assert.equal((await reply(stale)).revision,saved.revision);
   await stale.close();await p.bringToFront();
 });
 await step('Core ปฏิเสธโครง node มีสอง parent ผ่านทางบันทึกจริง',async()=>{
   const bad=structuredClone(saved.definition);bad.areaFormats[fmt].fragment.rootIds.push(child);
   const response=await p.request.put(address(p,'/structure'),{data:{definition:bad,expectedRevision:saved.revision,idempotencyKey:randomUUID()}});
   assert.equal(response.status(),422);assert.equal((await response.json()).issues[0].code,'INVALID_TEMPLATE');
   assert.equal((await reply(p)).revision,saved.revision);
 });
 await p.screenshot({path:join(output,'structure-editor.png')});
 await step('ลบข้อความและ line แยกโดยไม่ลบตัวแม่',async()=>{
   await pick(p,ref(b,fmt,'',firstCell));
   const controls=p.locator('#tree [data-ref]:visible');
   const position=await controls.evaluateAll((items,k)=>items.findIndex(x=>x.dataset.nodeId===k),child);
   if(position<0)await selected(p).locator('..').getByRole('button',{name:/ขยายหรือยุบ/}).click();
   await pick(p,ref(b,fmt,'',child));await del(p);
   await pick(p,ref(b,fmt,'',extra));await del(p);
 });
 await step('ลบ Format และป้องกันการลบ Format สุดท้ายของ Area',async()=>{
   await pick(p,ref(b,fmt));await del(p);
   const destination=Object.keys(saved.definition.areaFormats).find(k=>saved.definition.areaFormats[k].key==='destination');
   await pick(p,ref(b,destination));await action(p,'ลบรายการนี้').click();await form(p);
   assert.match(await by(p,'structure-error').textContent(),/อย่างน้อยหนึ่ง Format/);
   await by(p,'structure-form').getByRole('button',{name:'ยกเลิก'}).click();
 });
 await step('ลบ Area และ Section พร้อมจัดการลูกที่เป็นเจ้าของ',async()=>{
   await pick(p,ref(b,'','',alpha));await del(p);
   await pick(p,ref(a));await del(p);
   await pick(p,ref(b));await del(p);
 });
 await step('ลบตาราง Row Group โดยเก็บตาราง UAT เดิม',async()=>{
   await pick(p,ref(original,summary));await pick(p,ref(original,summary,'',grouped));await del(p);
 });
 const restored=await save(p);
 assert.deepEqual(restored.definition,def);
 assert.equal(restored.revision,saved.revision+1);
 rows.push('นิยามหลังเก็บงานทดสอบกลับตรงกับก่อนทดสอบทุกฟิลด์');
 const openMs=[],treeMs=[],previewMs=[],engineMs=[],labMs=[];
 let layoutHash, pageCount;
 for(let i=0;i<12;i++){
   const page=await open();
   const start=(await measure(page,'flowdoc:open-from-library')).at(-1);
   openMs.push(start.ms+start.detail.navigationMs);
   const areaToggle=tree(page,'area').locator('..').locator('.toggle[aria-expanded=false]');
   if(await areaToggle.count())await areaToggle.click();
   for(const node of [tree(page,'area'),tree(page,'format'),tree(page,'section')])await node.click();
   await wait(page,'flowdoc:tree-selection',3);
   treeMs.push(...(await measure(page,'flowdoc:tree-selection')).map(x=>x.ms));
   await by(page,'preview-tab').click();
   await wait(page,'flowdoc:engine-preview',1);
   const view=(await measure(page,'flowdoc:engine-preview')).at(-1);
   assert.equal(view.detail.revision,restored.revision);
   layoutHash??=view.detail.layoutHash;assert.equal(view.detail.layoutHash,layoutHash);
   pageCount??=view.detail.pageCount;assert.equal(view.detail.pageCount,pageCount);
   previewMs.push(view.ms);engineMs.push(view.detail.engineMs);labMs.push(view.detail.renderMs);
   await page.close();
 }
 const timings={libraryClickToDefinitionPaint:stat(openMs),treeSelectionToPaint:stat(treeMs),previewClickToPaint:stat(previewMs),
   coreGeneratePdf:stat(engineMs),labComposeResourcesAndEngine:stat(labMs),localStructureEditToPaint:stat(mutation.map(x=>x.ms)),structureSaveToPaint:stat(saves)};
 const phase1=baseline?JSON.parse(await readFile(baseline,'utf8')):null;
 if(phase1){assert.equal(layoutHash,phase1.preview.layoutHash);assert.equal(pageCount,phase1.preview.pageCount);}
 assert.deepEqual(errors,[]);
 const report={browser:browser.version(),viewport:[1440,900],testDraft:initial.templateId,revisions:[initial.revision,saved.revision,restored.revision],
   cases:rows,timings,phase1Timings:phase1?.timings,layoutHash,pageCount,
   rawMs:{openMs,treeMs,previewMs,engineMs,labMs,mutation,saves}};
 await writeFile(join(output,'phase2-baseline.json'),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({...report,cases:rows.length,rawMs:undefined},null,2));
} finally {await browser.close();}
