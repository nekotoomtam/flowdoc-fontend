import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {chromium} from '@playwright/test';

const base=process.env.FLOWDOC_PHASE1_URL??'http://127.0.0.1:5175';
const output=resolve(process.env.FLOWDOC_PHASE1_EVIDENCE??'experiments/phase1-local');
await mkdir(output,{recursive:true});
const browser=await chromium.launch({channel:'msedge'});
const context=await browser.newContext({viewport:{width:1440,height:900}});
await context.addInitScript(()=>sessionStorage.setItem('flowdoc:benchmark-preview','1'));
const errors=[];
const rounded=n=>Math.round(n*10)/10;
const measures=(page,name)=>page.evaluate(key=>performance.getEntriesByName(key).map(e=>({ms:e.duration,detail:e.detail})),name);
const waitMeasures=(page,name,length)=>page.waitForFunction(([key,n])=>performance.getEntriesByName(key).length>=n,[name,length]);
const collect=(samples)=>{const sorted=[...samples].sort((a,b)=>a-b);return {samples:samples.length,medianMs:rounded(sorted[Math.ceil(sorted.length/2)-1]),p95Ms:rounded(sorted[Math.ceil(sorted.length*.95)-1]),maxMs:rounded(sorted.at(-1))};};
async function openFromLibrary(){
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
  await page.goto(base+'/library.html?phase1=1');
  const card=page.locator('[data-doc-key=stage6-uat-editor-phase1]').getByRole('button',{name:/^เปิดแก้ไข UAT/});
  await card.click();
  await page.waitForURL('**/phase1-editor.html?id=*');
  await waitMeasures(page,'flowdoc:open-from-library',1);
  return page;
}
const section=page=>page.locator('#tree [data-kind=section]').first();
const area=page=>page.locator('#tree [data-kind=area]').first();
const format=page=>page.locator('#tree [data-kind=format]').first();
const input=page=>page.locator('#section-name');
const save=page=>page.locator('#save');
const revision=async page=>Number(await page.locator('body').getAttribute('data-revision'));
const getDraft=async(page)=>{const id=new URL(page.url()).searchParams.get('id');const response=await page.request.get(base+'/api/editor-phase1/drafts/'+id);assert.equal(response.status(),200);return (await response.json()).value;};
const isRename=r=>r.request().method()==='PUT'&&r.url().includes('/api/editor-phase1/drafts/');
const expectPreview=r=>r.request().method()==='POST'&&r.url().endsWith('/preview');
async function runPreview(page){
  const count=(await measures(page,'flowdoc:engine-preview')).length;
  const received=page.waitForResponse(expectPreview);
  const tab=page.locator('#preview-tab');
  if(await tab.getAttribute('aria-pressed')==='false')await tab.click();
  else await page.locator('#refresh-preview').click();
  const response=await received;
  assert.equal(response.status(),200,await response.text());
  const data=await response.json();
  await waitMeasures(page,'flowdoc:engine-preview',count+1);
  assert.equal(Number(await page.locator('#preview-paper').getAttribute('data-revision')),data.revision);
  assert.equal(data.pages.length,data.pageCount);
  assert.match(data.layoutHash,/^[a-f0-9]{64}$/);assert.equal(data.renderPath,'engine-layout');
  return {data,entry:(await measures(page,'flowdoc:engine-preview')).at(-1)};
}
try {
  const a=await openFromLibrary(),b=await openFromLibrary();
  const before=await getDraft(a);
  assert.equal(before.templateId,(await getDraft(b)).templateId);
  const staleRevision=await revision(a);
  assert.equal(staleRevision,await revision(b));
  assert.equal(before.definition.nodeModelVersion,20);
  assert.ok(await a.locator('#tree').getByText('หัวกระดาษ',{exact:true}).count());
  assert.ok(await a.locator('#variables').getByText(/headerBanner/).count());
  const oldPreview=await runPreview(a);
  assert.equal(oldPreview.data.revision,staleRevision);
  await a.locator('#define-tab').click();
  await a.locator('#advanced-details > summary').click();
  await b.locator('#advanced-details > summary').click();
  const name='UAT เฟส 1 · '+new Date().toISOString();
  await input(a).fill(name);
  const aReply=a.waitForResponse(isRename);
  await save(a).click();
  assert.equal((await aReply).status(),200);
  await a.waitForFunction(r=>Number(document.body.dataset.revision)===r,[staleRevision+1].at(0));
  assert.equal(await input(a).inputValue(),name);
  const after=await getDraft(a);
  const expected=structuredClone(before.definition);expected.sections[0].label=name;
  assert.deepEqual(after.definition,expected);
  const endpoint=new URL(a.url()).searchParams.get('id');
  const outOfDate=await a.request.post(base+'/api/editor-phase1/drafts/'+endpoint+'/preview',{data:{expectedRevision:staleRevision}});
  assert.equal(outOfDate.status(),409);
  assert.equal((await outOfDate.json()).error,'STALE_CURRENT');

  await input(b).fill('ชื่อที่ฉบับเก่าพยายามบันทึก');
  const bReply=b.waitForResponse(isRename);
  await save(b).click();
  const rejected=await bReply;
  assert.equal(rejected.status(),409);
  assert.equal((await rejected.json()).issues[0].code,'STALE_CURRENT');
  await b.locator('#conflict').waitFor({state:'visible'});
  assert.equal(await input(b).inputValue(),'ชื่อที่ฉบับเก่าพยายามบันทึก');
  assert.equal(await save(b).isDisabled(),true);
  await b.screenshot({path:join(output,'stale-revision.png')});
  await b.locator('#reload').click();
  await b.waitForFunction(r=>Number(document.body.dataset.revision)===r,after.revision);
  assert.equal(await input(b).inputValue(),name);
  await a.close();await b.close();

  const reopened=await openFromLibrary();
  assert.equal(await input(reopened).inputValue(),name);
  assert.equal(await revision(reopened),after.revision);
  assert.deepEqual((await getDraft(reopened)).definition,expected);
  const current=await runPreview(reopened);
  assert.equal(current.data.revision,after.revision);
  assert.equal(current.data.fingerprint,after.fingerprint);
  const pages=current.data.pages;
  for(const [i,page] of pages.entries()){
    const actual=await reopened.locator('#preview-paper svg text').evaluateAll(nodes=>nodes.map(n=>({text:n.textContent,x:Number(n.getAttribute('x')),y:Number(n.getAttribute('y'))})));
    assert.deepEqual(actual,page.lines.map(n=>({text:n.text,x:n.xPt,y:n.yPt+n.baselineOffsetPt})));
    if(i+1<pages.length)await reopened.locator('#next-page').click();
  }
  await reopened.screenshot({path:join(output,'engine-preview.png')});
  await reopened.locator('#define-tab').click();
  await reopened.screenshot({path:join(output,'editor.png')});
  const cdp=await context.newCDPSession(reopened);
  await cdp.send('HeapProfiler.collectGarbage');
  const heapBefore=await cdp.send('Runtime.getHeapUsage');
  const open=[],tree=[],render=[],engine=[],lab=[];
  for(let i=0;i<12;i++){
    const page=await openFromLibrary();
    const entry=(await measures(page,'flowdoc:open-from-library')).at(-1);
    open.push(entry.ms+entry.detail.navigationMs);
    const parts=page.locator('#tree .tree-row').filter({has:area(page)}).locator('.toggle[aria-expanded=false]');
    if(await parts.count())await parts.click();
    for(const node of [area(page),format(page),section(page)])await node.click();
    await waitMeasures(page,'flowdoc:tree-selection',3);
    tree.push(...(await measures(page,'flowdoc:tree-selection')).map(e=>e.ms));
    const result=await runPreview(page);
    assert.equal(result.data.revision,after.revision);
    assert.equal(result.data.layoutHash,current.data.layoutHash);
    render.push(result.entry.ms);engine.push(result.data.engineMs);lab.push(result.data.renderMs);
    await page.close();
  }
  for(let i=0;i<12;i++){
    const parts=reopened.locator('#tree .tree-row').filter({has:area(reopened)}).locator('.toggle[aria-expanded=false]');
    if(await parts.count())await parts.click();
    for(const node of [area(reopened),format(reopened),section(reopened)])await node.click();
  }
  await cdp.send('HeapProfiler.collectGarbage');
  const heapAfter=await cdp.send('Runtime.getHeapUsage');
  assert.deepEqual(errors,[]);
  const result={
    scope:'Windows Microsoft Edge, 1440x900, Vite loopback and warm Oracle lab bridge, full UAT Model 20 clone',
    browser:browser.version(),templateId:before.templateId,revisionBefore:staleRevision,revisionAfter:after.revision,
    workflow:{reopenedSavedLabel:true,otherDefinitionFieldsUnchanged:true,staleSaveHttp:409,staleSaveCode:'STALE_CURRENT',
      unsavedTextPreserved:true,stalePreviewHttp:409,explicitConflictReload:true},
    timings:{libraryClickToDefinitionPaint:collect(open),treeSelectionToPaint:collect(tree),previewClickToPaint:collect(render),
      coreGeneratePdf:collect(engine),labComposeResourcesAndEngine:collect(lab)},
    preview:{pageCount:current.data.pageCount,fingerprint:after.fingerprint,layoutHash:current.data.layoutHash,
      renderPath:current.data.renderPath,allPageLinesAndCoordinatesMatched:true,
      fonts:'Engine-matched Sarabun 300 and 400; SVG painted by the browser; solid test banner'},
    browserHeap:{beforeTreeLoopBytes:heapBefore.usedSize,after36SelectionsBytes:heapAfter.usedSize,forcedGc:true,
      scope:'single renderer JS heap, indicative only'},
    rawMs:{open,tree,render,engine,lab},
  };
  await writeFile(join(output,'phase1-baseline.json'),JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify({...result,rawMs:undefined},null,2));
}finally{await browser.close();}
