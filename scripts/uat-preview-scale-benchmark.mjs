import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {setTimeout as sleep} from 'node:timers/promises';
import {chromium} from '@playwright/test';

// Version 1 freezes inputs and cadence for a later comparison in a host page.
// Run with FLOWDOC_PAPER_DRAFT_ID and FLOWDOC_TRIAL_EVIDENCE set.
// An optional FLOWDOC_PREVIEW_HOST_URL must contain one iframe pointed at the same Editor draft.
const profiles = [
  {id:'small', rows:2, minPages:4},
  {id:'medium', rows:24, minPages:20},
  {id:'large', rows:80, minPages:70},
  {id:'hundreds', rows:190, minPages:300},
];
const transport=process.env.FLOWDOC_PREVIEW_TRANSPORT??'full';
const engine=process.env.FLOWDOC_PREVIEW_ENGINE??'stable';
assert.ok(['stable','resume'].includes(engine));
assert.ok(['full','delta'].includes(transport));
const rates = process.env.FLOWDOC_PREVIEW_20_ONLY==='1'?[20,20]:[10,20,20];
const strokes = 40;
const menuText = 'ทดสอบข้อมูลภาษาไทยสำหรับการจัดหน้า '.repeat(44).trimEnd();
const targetText = 'เมนูวัดผลภาษาไทย';
const base = process.env.FLOWDOC_PHASE1_URL ?? 'http://127.0.0.1:5175';
const draftId = process.env.FLOWDOC_PAPER_DRAFT_ID;
const hostUrl = process.env.FLOWDOC_PREVIEW_HOST_URL;
const selected = process.env.FLOWDOC_PREVIEW_PROFILE;
const expectedFingerprint = process.env.FLOWDOC_PREVIEW_EXPECTED_FINGERPRINT;
const out = process.env.FLOWDOC_TRIAL_EVIDENCE;
assert.ok(draftId && out, 'Set FLOWDOC_PAPER_DRAFT_ID and FLOWDOC_TRIAL_EVIDENCE');
assert.ok(!selected || profiles.some(profile => profile.id === selected), 'Unknown preview profile');
const api = '/api/editor-phase1/drafts/'+draftId;
const output = resolve(out);
const browser = await chromium.launch({channel:'msedge'});
const evidence = {
  version:1, draftId, editorCommit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),
  benchmarkSha256:createHash('sha256').update(await readFile(new URL(import.meta.url))).digest('hex'),
  browser:browser.version(), platform:process.platform, viewport:{width:1280,height:900}, hostUrl:hostUrl??null,
  transport, engine, rates, strokes, menuCodeUnits:menuText.length, profiles:[], limitations:[
    'CDP Thai keydown repeats model a held Thai key. Physical keyboard/IME are separate checks.',
    'Input-to-paint uses the second animation frame as a visible-paint proxy.',
    'Memory is browser JS heap and DOM counters. Engine process RSS and GPU memory are separate checks.',
  ],
};
function stats(values) {
  if (!values.length) return {n:0};
  const sorted = [...values].sort((a,b)=>a-b);
  const at = q => Number(sorted[Math.ceil(q*sorted.length)-1].toFixed(1));
  return {n:sorted.length,p50:at(.5),p95:at(.95),max:at(1)};
}
function instrument() {
  const measure = window.flowdocPreviewBenchmark = {inputs:[], paints:{}, frames:[], sampleFrames:false};
  const afterPaint = fn => requestAnimationFrame(()=>requestAnimationFrame(()=>fn(performance.now())));
  addEventListener('input', event=>{
    if (event.target.id !== 'trial-paper-value') return;
    const start = performance.now(), length = event.target.value.length;
    afterPaint(end=>measure.inputs.push({start,end,length}));
  },{capture:true});
  addEventListener('DOMContentLoaded',()=>{
    const paper = document.querySelector('#preview-paper');
    if (!paper) return;
    new MutationObserver(()=>{
      const run = paper.dataset.run;
      if (run) afterPaint(end=>{if(paper.dataset.run===run)measure.paints[run]=end;});
    }).observe(paper,{attributes:true,attributeFilter:['data-run']});
  },{once:true});
  let prior = 0;
  function frame(now) {
    if (measure.sampleFrames && prior) measure.frames.push(now-prior);
    prior=now;
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
const matchingPost = response => response.request().method()==='POST' && response.url().endsWith(api+'/preview');
async function checkResponse(response) {
  const body = await response.json();
  assert.equal(response.status(),200,JSON.stringify(body.issues??body.error));
  assert.equal(body.renderPath,'engine-layout');
  return body;
}
async function memory(cdp, editor) {
  const first = editor.locator('#preview-paper .preview-page').first();
  await first.evaluate(element=>element.scrollIntoView({block:'start'}));
  await first.locator('svg').waitFor({state:'visible'});
  await sleep(500);
  const mountedPages = await editor.locator('#preview-paper .preview-page svg').count();
  const {usedSize:beforeGc} = await cdp.send('Runtime.getHeapUsage');
  await cdp.send('HeapProfiler.collectGarbage');
  const {usedSize:retained} = await cdp.send('Runtime.getHeapUsage');
  return {mountedPages,beforeGcJsBytes:beforeGc,retainedJsBytes:retained,...await cdp.send('Memory.getDOMCounters')};
}
async function scrollProbe(editor, page, pageCount) {
  const durations = [];
  let coldJumps=0,wheelDeltaPx=0;
  const slots = editor.locator('#preview-paper .preview-page');
  await editor.evaluate(()=>{window.flowdocPreviewBenchmark.frames=[];window.flowdocPreviewBenchmark.sampleFrames=true;});
  try {
    for (const index of [pageCount-1, Math.floor(pageCount/2), 0]) {
      const sheet = slots.nth(index);
      if(!await sheet.locator('svg').count())coldJumps++;
      const started = performance.now();
      await sheet.evaluate(element=>element.scrollIntoView({block:'center'}));
      await sheet.locator('svg').waitFor({state:'visible',timeout:15000});
      await editor.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      durations.push(performance.now()-started);
    }
    const box=await slots.first().locator('svg').boundingBox();
    await page.mouse.move(box.x+box.width/2,Math.max(1,Math.min(evidence.viewport.height-1,box.y+box.height/2)));
    const startY=await editor.evaluate(()=>scrollY);
    for(let index=0;index<12;index++){
      await page.mouse.wheel(0,620);
      await sleep(50);
    }
    wheelDeltaPx=await editor.evaluate(()=>scrollY)-startY;
    assert.ok(wheelDeltaPx>0,'Wheel must move the document');
  } finally {
    await editor.evaluate(()=>{window.flowdocPreviewBenchmark.sampleFrames=false;});
  }
  const frames = await editor.evaluate(()=>window.flowdocPreviewBenchmark.frames);
  return {coldJumps,wheelDeltaPx,jumpToPaintMs:stats(durations),frameMs:stats(frames),framesOver50Ms:frames.filter(ms=>ms>50).length};
}
async function runProfile(profile) {
  const context = await browser.newContext({viewport:evidence.viewport});
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(instrument);
  if(transport==='full')await page.addInitScript(()=>sessionStorage.setItem('flowdoc:full-trial-transport','1'));
  const result={...profile, bursts:[]};
  evidence.profiles.push(result);
  try {
    const original = await page.request.get(base+api);
    assert.equal(original.status(),200);
    const saved = (await original.json()).value;
    if(expectedFingerprint)assert.equal(saved.fingerprint,expectedFingerprint,'Use the same definition as the comparison baseline');
    if(evidence.fingerprint)assert.equal(saved.fingerprint,evidence.fingerprint,'Definition changed during the run');
    evidence.revision=saved.revision;
    evidence.fingerprint=saved.fingerprint;
    const editorUrl = base+'/phase1-editor.html?id='+draftId+(engine==='resume'?'&previewEngine=resume':'');
    await page.goto(hostUrl??editorUrl);
    const editor = hostUrl ? await page.locator('iframe').elementHandle().then(iframe=>iframe.contentFrame()) : page.mainFrame();
    assert.ok(editor);
    await editor.waitForURL(editorUrl);
    const inputCdp = await context.newCDPSession(page);
    const cdp = editor===page.mainFrame()?inputCdp:await context.newCDPSession(editor).catch(error=>{
      if(!error.message.includes('separate CDP session'))throw error;
      return inputCdp;
    });
    result.heapScope=cdp===inputCdp?'page renderer':'iframe renderer';
    const open = page.waitForResponse(matchingPost,{timeout:125000});
    void open.catch(()=>{});
    await editor.getByRole('button',{name:'ลองข้อมูล / Preview',exact:true}).click();
    const initial = await checkResponse(await open);
    if(evidence.engineVersion)assert.equal(initial.engineVersion,evidence.engineVersion,'Engine changed during the run');
    evidence.engineVersion=initial.engineVersion;
    const request = (await open).request().postDataJSON().trial;
    const formatIndex = request.sections[0].data.parts.findIndex(part=>part.format==='summary-dynamic');
    assert.ok(formatIndex>=0);
    const key = JSON.stringify(['sections',0,'data','parts',formatIndex,'data','groups',0,'members',1,'menu']);
    const target = editor.locator('[data-trial-key='+await editor.evaluate(value=>CSS.escape(value),key)+']');
    const paper = editor.locator('#preview-paper');
    const form = editor.locator('#trial-form');
    const members = form.getByRole('group',{name:/^members/});
    const fields = members.locator(':scope > .trial-rows > details').getByLabel(/^menu/);
    const value = trial => trial.sections[0].data.parts[formatIndex].data.groups[0].members[1]?.menu;
    const requestValue=request=>{
      const input=request.postDataJSON();
      return input.trial?value(input.trial):input.trialPatch?.changes.find(change=>JSON.stringify(change.path)===key)?.value;
    };
    const waitForValue = expected=>{
      const pending=page.waitForResponse(response=>
        matchingPost(response) && requestValue(response.request())===expected,{timeout:125000});
      void pending.catch(()=>{});
      return pending;
    };
    const painted = run=>editor.waitForFunction(id=>Boolean(window.flowdocPreviewBenchmark.paints[id]),run,{timeout:20000});
    await painted(initial.previewId);
    const ready = waitForValue(targetText);
    await members.evaluate((group,{rows,text,targetText})=>{
      const add = [...group.querySelectorAll('button')].find(button=>button.textContent==='+ เพิ่มรายการ');
      for(let index=1;index<rows;index++) add.click();
      const menus = [...group.querySelectorAll(':scope > .trial-rows > details')].map(row=>
        [...row.querySelectorAll('label')].find(label=>label.textContent.trim().startsWith('menu')).querySelector('textarea'));
      menus.forEach((input,index)=>{input.value=index===1?targetText:index===0?'แถวข้างเคียง':text;});
      menus[1].dispatchEvent(new InputEvent('input',{bubbles:true}));
    },{rows:profile.rows,text:menuText,targetText});
    const setup = await checkResponse(await ready);
    await painted(setup.previewId);
    result.pages=setup.pageCount;
    result.payloadBytes=Buffer.byteLength((await ready).request().postData());
    result.setupLabMs=setup.renderMs;result.setupLayoutHash=setup.layoutHash;
    result.setupPageKeysHash=createHash('sha256').update(JSON.stringify(setup.pageKeys??[])).digest('hex');
    if(engine==='resume')assert.ok(setup.resume?.slices>0);
    result.setupResume=setup.resume;
    assert.ok(setup.pageCount>=profile.minPages,'Expected '+profile.minPages+' pages, got '+setup.pageCount);
    let targetIndex=-1;
    for(let index=0;index<setup.pageCount;index++){
      const response=await page.request.get(base+api+'/preview-runs/'+setup.previewId+'/pages/'+index);
      const projected=(await response.json()).page;
      if(projected?.lines.some(line=>line.edit?.key===key)){targetIndex=index;break;}
    }
    assert.ok(targetIndex>=0,'Target row must have an Engine edit hit');
    result.warmScroll=await scrollProbe(editor,page,setup.pageCount);
    result.memory=[await memory(cdp,editor)];
    let expected=targetText,acknowledged=setup.previewId;
    let pageCount=setup.pageCount;
    for(const hz of rates){
      const slot = paper.locator('.preview-page').nth(targetIndex);
      await slot.evaluate(element=>element.scrollIntoView({block:'center'}));
      const textarea=editor.locator('#trial-paper-value');
      if(await textarea.isVisible())await textarea.press('Escape');
      await target.first().click();
      await textarea.evaluate(input=>input.setSelectionRange(4,4));
      await editor.evaluate(()=>{window.flowdocPreviewBenchmark.inputs=[];window.flowdocPreviewBenchmark.paints={};});
      const before=expected;
      expected=before.slice(0,4)+'ก'.repeat(strokes)+before.slice(4);
      const final = waitForValue(expected);
      const responses=[];
      const observe = response=>{
        if(!matchingPost(response))return;
        const request=response.request(), input=request.postDataJSON(), length=requestValue(request)?.length;
        responses.push(response.json().then(body=>({length,run:body.previewId,status:response.status(),
          engineMs:body.engineMs,labMs:body.renderMs,bytes:Buffer.byteLength(request.postData()),
          base:input.trialPatch?.basePreviewId,fields:input.trialPatch?.changes.map(change=>JSON.stringify(change.path)),
          ttfbMs:request.timing().responseStart,resume:body.resume,
        }),()=>({length,status:response.status()})));
      };
      page.on('response',observe);
      let release;
      try {
        const started=performance.now();
        for(let index=0;index<strokes;index++){
          const delay=started+index*1000/hz-performance.now();
          if(delay>0)await sleep(delay);
          await inputCdp.send('Input.dispatchKeyEvent',{type:'keyDown',key:'ก',code:'KeyD',text:'ก',autoRepeat:index>0});
        }
        release=await editor.evaluate(()=>performance.now());
      } finally {
        await inputCdp.send('Input.dispatchKeyEvent',{type:'keyUp',key:'ก',code:'KeyD'});
      }
      assert.equal(await textarea.inputValue(),expected);
      assert.equal(await fields.nth(1).inputValue(),expected);
      const last = await checkResponse(await final);
      await painted(last.previewId);
      page.off('response',observe);
      assert.equal(await textarea.evaluate(input=>input===document.activeElement&&input.selectionStart===44),true);
      assert.equal(await fields.nth(0).inputValue(),'แถวข้างเคียง');
      const {inputs,paints}=await editor.evaluate(()=>window.flowdocPreviewBenchmark);
      assert.equal(inputs.length,strokes);
      const requests=await Promise.all(responses);
      for(const request of requests){
        assert.equal(request.status,200);
        assert.equal(Boolean(request.resume),engine==='resume');
        if(transport==='delta'){
          assert.equal(request.base,acknowledged);
          assert.deepEqual(request.fields,[key]);
        }else assert.equal(request.base,undefined);
        acknowledged=request.run;
      }
      assert.equal(acknowledged,last.previewId);
      assert.equal(await paper.getAttribute('data-run'),last.previewId);
      const visible=requests.filter(item=>paints[item.run]).map(item=>({...item,paint:paints[item.run]})).sort((a,b)=>a.paint-b.paint);
      const during=visible.filter(item=>item.paint<=release);
      const byLength=new Map(inputs.map(input=>[input.length,input]));
      pageCount=last.pageCount;
      targetIndex=last.pageIndex;
      result.bursts.push({hz,pageCount,updatesBeforeKeyup:during.length,requestStatuses:requests.map(item=>item.status),
        requestBytes:requests.map(item=>item.bytes),requestTtfbMs:requests.map(item=>item.ttfbMs),resume:requests.map(item=>item.resume),
        finalLayoutHash:last.layoutHash,finalPageKeysHash:createHash('sha256').update(JSON.stringify(last.pageKeys??[])).digest('hex'),
        deliveredInputIntervalMs:stats(inputs.slice(1).map((item,index)=>item.start-inputs[index].start)),
        inputToPaintMs:stats(inputs.map(item=>item.end-item.start)),
        inputToEnginePaintMs:stats(visible.flatMap(item=>byLength.has(item.length)?[item.paint-byLength.get(item.length).start]:[])),
        engineComputeMs:stats(visible.map(item=>item.engineMs)),labRenderMs:stats(visible.map(item=>item.labMs)),
        longestGapUntilPaperMs:stats(visible.map((item,index)=>item.paint-(visible[index-1]?.paint??inputs[0].start))).max,
        finalInputToPaperMs:paints[last.previewId]-inputs.at(-1).start,
        scroll:await scrollProbe(editor,page,pageCount),
      });
      result.memory.push(await memory(cdp,editor));
    }
    result.retainedJsDelta=result.memory.at(-1).retainedJsBytes-result.memory[0].retainedJsBytes;
    result.retainedDomDelta=result.memory.at(-1).nodes-result.memory[0].nodes;
    assert.deepEqual(errors,[]);
    const finalDraft = (await (await page.request.get(base+api)).json()).value;
    assert.equal(finalDraft.revision,saved.revision);
    assert.equal(finalDraft.fingerprint,saved.fingerprint);
    result.status='measured';
    result.burstsWithoutPaperUpdate=result.bursts.filter(burst=>burst.updatesBeforeKeyup===0).length;
  } catch(error) {
    result.status='failed';
    result.error=error.stack??String(error);
    console.error(profile.id,result.error);
  } finally {
    await context.close();
    console.log(profile.id,result.status,result.pages??'no pages');
  }
}
try {
  await mkdir(output,{recursive:true});
  for(const profile of profiles.filter(item=>!selected||selected===item.id)){
    await runProfile(profile);
    await writeFile(join(output,'preview-scale-v1.json'),JSON.stringify(evidence,null,2)+'\n');
  }
  if(evidence.profiles.some(profile=>profile.status!=='measured'))process.exitCode=1;
} finally {
  await browser.close();
}
