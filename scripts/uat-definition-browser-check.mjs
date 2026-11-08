import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {chromium} from '@playwright/test';

const base=process.env.FLOWDOC_PHASE1_URL??'http://127.0.0.1:5175';
const output=resolve(process.env.FLOWDOC_UAT_OUTLINE_EVIDENCE??'experiments/uat-outline-local');
const browser=await chromium.launch({channel:'msedge'});
const page=await browser.newPage({viewport:{width:1440,height:1000}});
const apiCalls=[], errors=[];
page.on('request',request=>{const url=new URL(request.url());if(url.pathname.startsWith('/api/'))apiCalls.push({method:request.method(),path:url.pathname});});
page.on('pageerror',error=>errors.push(error.message));
const ref=(section,format='',band='',node='',part)=>JSON.stringify([section,format,band,node,...(part?[part]:[])]);
const targets=(host,section,format='',band='')=>{
  const keys=[];
  for(const node of Object.values(host.fragment?.nodes??{})){
    keys.push(ref(section,format,band,node.id));
    for(const [i,inline] of (node.children??[]).entries())keys.push(ref(section,format,band,node.id,'inline:'+(inline.id??i)));
    if(node.type==='columns')for(const i of node.columns.keys())keys.push(ref(section,format,band,node.id,'column:'+i));
  }
  for(const [i,group] of (host.rowGroups??[]).entries())keys.push(ref(section,format,band,group.tableId,'group:'+i));
  for(const [i,repeat] of (host.repeats??[]).entries())keys.push(ref(section,format,band,repeat.tableId,'repeat:'+i));
  for(const [i,repeat] of (host.cellRepeats??[]).entries())keys.push(ref(section,format,band,repeat.cellId,'cell-repeat:'+i));
  return keys;
};
async function activate(key){
  const ok=await page.evaluate(target=>{
    const match=[...document.querySelectorAll('button[data-paper-ref]')].find(button=>button.dataset.paperRef===target);
    if(!match)return false;
    match.click();
    return document.querySelector('#tree button[aria-current=true]')?.dataset.ref===target;
  },key);
  assert.equal(ok,true,'Paper and Tree must select '+key);
}
try{
  await mkdir(output,{recursive:true});
  await page.goto(base+'/library.html?phase1=1');
  await page.locator('[data-doc-key=stage6-uat-editor-phase1]').getByRole('button',{name:/^เปิดแก้ไข UAT/}).click();
  const sectionControl=page.locator('.definition-section-tools .definition-section-control');
  await sectionControl.waitFor();
  assert.equal(apiCalls.length,2);
  assert.ok(apiCalls.every(call=>call.method==='GET'&&!call.path.includes('preview')));
  const draft=await (await page.request.get(base+'/api/editor-phase1/drafts/'+new URL(page.url()).searchParams.get('id'))).json();
  const definition=draft.value.definition;
  const section=definition.sections[0], formats=Object.entries(definition.areaFormats);
  assert.equal(definition.nodeModelVersion,20);assert.equal(formats.length,14);
  assert.equal(await page.locator('#paper .definition-format').count(),1);
  assert.match(await page.locator('#paper .definition-format').textContent(),/^cover/);
  const box=await page.locator('#paper .definition-sheet').evaluate(sheet=>({
    width:sheet.getBoundingClientRect().width,height:sheet.getBoundingClientRect().height,
    top:sheet.querySelector('.definition-band').style.top,margin:getComputedStyle(sheet.querySelector('.definition-body')).paddingLeft
  }));
  assert.ok(Math.abs(box.height/box.width-841.89/595.276)<.05,JSON.stringify(box));
  assert.ok(Math.abs(parseFloat(box.margin)/box.width-36/595.276)<.003,JSON.stringify(box));
  await page.screenshot({path:join(output,'uat-definition-cover.png')});
  const sectionRefs=[ref(section.id),...targets(section.source,section.id)];
  for(const band of ['header','footer'])sectionRefs.push(ref(section.id,'',band),...targets(section[band],section.id,'',band));
  for(const key of sectionRefs)await activate(key);
  const counts=[];
  for(const [id,format] of formats){
    await activate(ref(section.id,id));
    assert.equal(await page.locator('#paper .definition-format').count(),1);
    const keys=targets(format,section.id,id);
    for(const key of keys)await activate(key);
    counts.push({format:format.key,clickTargets:keys.length+1});
  }
  const summary=formats.find(([,f])=>f.key==='summary-dynamic')[0];
  await activate(ref(section.id,summary));
  const token=page.locator('#paper .definition-token').filter({hasText:'{{menu}}'});
  assert.equal(await token.count(),1);
  await token.focus();await page.keyboard.press('Enter');
  assert.match(await page.locator('#tree [aria-current=true]').textContent(),/menu/);
  assert.match(await page.locator('#variable-detail').textContent(),/members\[\].*menu/);
  if(await page.locator('#variable-panel').getAttribute('open')===null)await page.locator('#variable-panel > summary').click();
  await page.locator('#variables .scope').filter({has:page.getByText('Format · summary-dynamic',{exact:true})}).locator('[data-variable-path="totals[].pass"]').click();
  assert.match(await page.locator('#variable-detail').textContent(),/totals\[\]\.pass/);
  await token.click();
  assert.match(await page.locator('#variable-detail').textContent(),/members\[\].*menu/);
  await page.screenshot({path:join(output,'uat-definition-menu-binding.png')});
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await token.click();
  assert.match(await page.locator('#selection').textContent(),/menu/);
  assert.ok(apiCalls.every(call=>call.method==='GET'&&!call.path.includes('preview')));
  assert.deepEqual(errors,[]);
  const result={model:20,revision:draft.value.revision,sectionTargets:sectionRefs.length,formats:counts,
    totalClickTargets:sectionRefs.length+counts.reduce((n,row)=>n+row.clickTargets,0),
    benchmarkSampleRequests:0,writes:0,pageBox:box};
  await writeFile(join(output,'uat-definition-verification.json'),JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify(result,null,2));
}finally{await browser.close();}
