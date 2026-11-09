import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {setTimeout as sleep} from 'node:timers/promises';
import {chromium} from '@playwright/test';

const id=process.env.FLOWDOC_PAPER_DRAFT_ID,output=process.env.FLOWDOC_TRIAL_EVIDENCE;
assert.ok(id&&output,'Set FLOWDOC_PAPER_DRAFT_ID and FLOWDOC_TRIAL_EVIDENCE');
const base=process.env.FLOWDOC_PHASE1_URL??'http://127.0.0.1:5181';
const endpoint='/api/editor-phase1/drafts/'+id;
const browser=await chromium.launch({channel:'msedge'});
const text='ทดสอบข้อมูลภาษาไทยสำหรับการจัดหน้า '.repeat(44).trimEnd();
const short='เมนูวัดผลภาษาไทย';
const rows=190,strokes=40,hz=20;
const renderer=process.env.FLOWDOC_PREVIEW_RENDERER==='canvas'?'canvas':'svg';
const crossPage=process.env.FLOWDOC_PREVIEW_CROSS_PAGE==='1';
const reports=[];
const stats=samples=>{
  const values=[...samples].sort((a,b)=>a-b);
  return Number(values[Math.ceil(values.length*.95)-1].toFixed(1));
};

function instrument(){
  const NativeWorker=window.Worker;
  const evidence=window.previewProof={submitted:new Map(),layout:[],early:[],earlyPaints:new Map(),earlySurfaces:new Map(),
    keptSurfaces:new Map(),discarded:[],paints:new Map(),inputs:[],errors:[]};
  const afterPaint=next=>requestAnimationFrame(()=>requestAnimationFrame(next));
  window.Worker=class extends NativeWorker{
    constructor(...args){
      super(...args);
      evidence.worker=this;
      this.addEventListener('message',({data})=>{
        if(data.kind==='superseded')evidence.discarded.push(data.revision);
        if(data.kind==='editing-pages')evidence.early.push(data);
        if(data.kind!=='layout')return;
        if(data.error){evidence.errors.push(data.error);return;}
        const {pages,...header}=data.preview;
        evidence.layout.push({...header,firstPage:pages[0],inputRevision:data.revision,receivedAt:performance.now()});
      });
    }
    postMessage(message,...options){
      if(message.kind==='layout')evidence.submitted.set(message.revision,{trial:message.trial,at:performance.now()});
      return super.postMessage(message,...options);
    }
  };
  document.addEventListener('DOMContentLoaded',()=>{
    const paper=document.querySelector('#preview-paper');
    new MutationObserver(records=>{
      const run=paper.dataset.run;
      const early=paper.dataset.editingRun;
      if(early)afterPaint(()=>{
        if(paper.dataset.editingRun!==early)return;
        const caretPage=Number(document.querySelector('#trial-paper-markers').dataset.pageIndex);
        evidence.earlyPaints.set(early,{at:performance.now(),caretPage,focused:document.activeElement.id==='trial-paper-value'});
        evidence.earlySurfaces.set(early,{caretPage,surface:paper.querySelector('.preview-page-sheet[data-page-index="'+caretPage+'"]')?.firstElementChild});
      });
      if(run&&records.some(record=>record.attributeName==='data-run'))
        afterPaint(()=>{
          if(paper.dataset.run!==run)return;
          evidence.paints.set(run,performance.now());
          const early=evidence.earlySurfaces.get(run);
          if(early?.surface)evidence.keptSurfaces.set(run,early.surface===
            paper.querySelector('.preview-page-sheet[data-page-index="'+early.caretPage+'"]')?.firstElementChild);
          evidence.earlySurfaces.delete(run);
        });
    }).observe(paper,{attributes:true,attributeFilter:['data-run','data-editing-run']});
  });
  window.addEventListener('input',event=>{
    if(event.target.id!=='trial-paper-value')return;
    const at=performance.now(),value=event.target.value;
    const matches=window.testField.value===value;
    afterPaint(()=>evidence.inputs.push({at,paint:performance.now(),value,matches}));
  });
}
async function waitForLayout(page,expected){
  await page.waitForFunction(({key,expected})=>{
    const proof=window.previewProof;
    if(proof.errors.length)throw Error(proof.errors.at(-1));
    return proof.layout.some(header=>{
      if(!proof.paints.has(header.previewId))return false;
      if(expected===undefined)return true;
      return JSON.parse(key).reduce((value,part)=>value?.[part],proof.submitted.get(header.inputRevision).trial)===expected;
    });
  },expected,{timeout:120000});
  return page.evaluate(()=>window.previewProof.layout.findLast(run=>window.previewProof.paints.has(run.previewId)));
}
function prove(page,run){
  return page.evaluate(run=>new Promise((resolve,reject)=>{
    const worker=window.previewProof.worker,id=crypto.randomUUID();
    const listener=({data})=>{
      if(data.kind!=='proof'||data.id!==id)return;
      worker.removeEventListener('message',listener);
      if(data.error)reject(Error(data.error));else resolve(data);
    };
    worker.addEventListener('message',listener);
    worker.postMessage({kind:'proof',id,run});
  }),run);
}
async function profile(member){
  const page=await browser.newPage({viewport:{width:1280,height:900}});
  const cdp=await page.context().newCDPSession(page);
  const errors=[],serverCalls=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('request',request=>{
    if(new URL(request.url()).pathname.startsWith(endpoint+'/preview'))serverCalls.push(request.url());
  });
  await page.addInitScript(instrument);
  const snapshots=[];
  try{
    const draft=(await (await page.request.get(base+endpoint)).json()).value;
    const fingerprint=process.env.FLOWDOC_PREVIEW_EXPECTED_FINGERPRINT;
    if(fingerprint)assert.equal(draft.fingerprint,fingerprint);
    await page.goto(base+'/phase1-editor.html?id='+id+'&previewEngine=worker&previewRenderer='+renderer);
    await page.getByRole('button',{name:'ลองข้อมูล / Preview',exact:true}).click();
    const blank=await waitForLayout(page,{});
    const initial=await page.evaluate(revision=>window.previewProof.submitted.get(revision).trial,blank.inputRevision);
    const format=initial.sections[0].data.parts.findIndex(part=>part.format==='summary-dynamic');
    assert.ok(format>=0);
    const key=JSON.stringify(['sections',0,'data','parts',format,'data','groups',0,'members',member,'menu']);
    const group=page.locator('#trial-form').getByRole('group',{name:/^members/});
    const fields=group.locator(':scope > .trial-rows > details').getByLabel(/^menu/);
    const expected=member===1?short:text;
    await group.evaluate((node,{rows,text,short})=>{
      const add=[...node.querySelectorAll('button')].find(button=>button.textContent==='+ เพิ่มรายการ');
      for(let index=1;index<rows;index++)add.click();
      const menus=[...node.querySelectorAll(':scope > .trial-rows > details')].map(row=>
        [...row.querySelectorAll('label')].find(label=>label.textContent.trim().startsWith('menu')).querySelector('textarea'));
      menus.forEach((input,index)=>{input.value=index===1?short:index===0?'แถวข้างเคียง':text;});
      menus[1].dispatchEvent(new InputEvent('input',{bubbles:true}));
    },{rows,text,short});
    const setup=await waitForLayout(page,{key,expected});
    assert.equal(setup.pageCount,374);
    assert.equal(setup.renderPath,'browser-wasm');
    const verified=new Map([[setup.inputRevision,await prove(page,setup.previewId)]]);
    if(renderer==='canvas')await page.locator('#preview-paper canvas').first().waitFor();
    const startValue=await fields.nth(member).inputValue();
    const neighbor=await fields.nth(member-1).inputValue();
    const slot=page.locator('.preview-page');
    const target=page.locator('[data-trial-key='+await page.evaluate(value=>CSS.escape(value),key)+']');
    const editor=page.locator('#trial-paper-value');
    await slot.nth(member===1?2:185).evaluate(node=>node.scrollIntoView({block:'center'}));
    const beforeFocus=await target.first().evaluate(hit=>hit.closest('.preview-page-sheet').querySelector('canvas')?.toDataURL());
    await target.first().click();
    assert.equal(await editor.evaluate(input=>getComputedStyle(input).opacity),'0','the browser textarea must never paint a second text layout');
    assert.equal(await target.first().evaluate(hit=>hit.closest('.preview-page-sheet').querySelector('canvas')?.toDataURL()),beforeFocus,
      'focusing a cell must leave the Engine bitmap intact');
    await fields.nth(member).evaluate(input=>{window.testField=input;});
    let value=startValue;
    const bursts=[];
    for(let repeat=0;repeat<2;repeat++){
      let offset=4,startPage;
      if(crossPage&&member===94){
        const boundary=slot.nth(185).locator('[data-trial-key='+await page.evaluate(value=>CSS.escape(value),key)+']').last();
        await slot.nth(185).evaluate(node=>node.scrollIntoView({block:'center'}));
        await boundary.click();
        offset=Number(await boundary.getAttribute('data-end'))-3;
        startPage=185;
      }
      await editor.evaluate((input,offset)=>input.setSelectionRange(offset,offset),offset);
      await page.evaluate(()=>{window.previewProof.inputs=[];});
      const prior=(await waitForLayout(page,{key,expected:value})).inputRevision;
      value=value.slice(0,offset)+'ก'.repeat(strokes)+value.slice(offset);
      let keyup;
      try{
        const started=performance.now();
        for(let index=0;index<strokes;index++){
          const delay=started+index*1000/hz-performance.now();
          if(delay>0)await sleep(delay);
          await cdp.send('Input.dispatchKeyEvent',{type:'keyDown',key:'ก',code:'KeyD',text:'ก',autoRepeat:index>0});
        }
        keyup=await page.evaluate(()=>performance.now());
      }finally{
        await cdp.send('Input.dispatchKeyEvent',{type:'keyUp',key:'ก',code:'KeyD'});
      }
      const final=await waitForLayout(page,{key,expected:value});
      assert.equal(await editor.inputValue(),value);
      assert.equal(await fields.nth(member).inputValue(),value);
      assert.equal(await fields.nth(member-1).inputValue(),neighbor);
      assert.equal(await editor.evaluate((input,expected)=>input===document.activeElement&&input.selectionStart===expected,offset+strokes),true);
      const measured=await page.evaluate(({prior,last})=>{
        const proof=window.previewProof;
        return {inputs:proof.inputs,layouts:proof.layout.filter(run=>run.inputRevision>prior&&run.inputRevision<=last)
          .map(run=>({...run,paint:proof.paints.get(run.previewId)})),
          early:proof.early.filter(run=>run.revision>prior&&run.revision<=last)
            .map(run=>({...run,paint:proof.earlyPaints.get('worker-'+run.revision),keptSurface:proof.keptSurfaces.get('worker-'+run.revision)}))};
      },{prior,last:final.inputRevision});
      assert.equal(measured.inputs.length,strokes);
      assert.ok(measured.inputs.every(input=>input.matches));
      const painted=measured.layouts.filter(run=>run.paint!==undefined);
      const ink=page=>JSON.stringify([page.widthPt,page.heightPt,page.backgroundColor,page.borders,page.fills,page.glyphs,
        page.lines.map(({edit,...line})=>line)]);
      const early=measured.early.filter(run=>run.paint).map(run=>{
        const settled=measured.layouts.find(layout=>layout.inputRevision===run.revision);
        const full=new Map([[settled.pageIndex,settled.firstPage],...(settled.priorityPages??[])]);
        const sameInk=run.pages.every(([index,page])=>full.has(index)&&ink(page)===ink(full.get(index)));
        return {revision:run.revision,focusPage:run.focusPage+1,caretPage:run.paint.caretPage+1,focused:run.paint.focused,sameInk,keptSurface:run.keptSurface,
          inputToPaintMs:Math.round(run.paint.at-measured.inputs[0].at),
          beforeKeyup:run.paint.at<=keyup,leadMs:Math.round((settled.paint??settled.receivedAt)-run.paint.at)};
      });
      bursts.push({updatesBeforeKeyup:painted.filter(run=>run.paint<=keyup).length,
        feedbackP95Ms:stats(measured.inputs.map(input=>input.paint-input.at)),
        finalInputToPaperMs:Number((painted.at(-1).paint-measured.inputs.at(-1).at).toFixed(1)),
        revisions:painted.map(run=>run.inputRevision),engineMs:painted.map(run=>run.engineMs),
        workerMs:painted.map(run=>run.renderMs),startPage:startPage===undefined?undefined:startPage+1,early});
      verified.set(final.inputRevision,await prove(page,final.previewId));
    }
    const observed=await page.evaluate(first=>{
      const proof=window.previewProof;
      return {errors:proof.errors,discarded:proof.discarded,layout:proof.layout.filter(run=>run.inputRevision>=first)
        .map(run=>({run,trial:proof.submitted.get(run.inputRevision).trial}))};
    },setup.inputRevision);
    assert.deepEqual(serverCalls,[],'layout and page reads must stay in the Worker');
    assert.deepEqual(errors,[]);
    assert.deepEqual(observed.errors,[]);
    const revisions=observed.layout.map(({run})=>run.inputRevision);
    assert.deepEqual(revisions,[...new Set(revisions)].sort((a,b)=>a-b));
    const staleRejected=await page.evaluate(({revision,run})=>{
      const proof=window.previewProof,paper=document.querySelector('#preview-paper'),latest=paper.dataset.run;
      proof.worker.dispatchEvent(new MessageEvent('message',{data:{kind:'layout',revision,preview:{...run,pages:[run.firstPage]}}}));
      proof.worker.dispatchEvent(new MessageEvent('message',{data:{kind:'editing-pages',revision,focusPage:run.pageIndex,pages:[[run.pageIndex,run.firstPage]]}}));
      return latest!==run.previewId&&paper.dataset.run===latest&&!paper.dataset.editingRun;
    },{revision:setup.inputRevision,run:setup});
    assert.equal(staleRejected,true);
    for(const {run,trial} of observed.layout){
      const proof=verified.get(run.inputRevision);
      if(!proof)continue;
      const response=await page.request.post(base+endpoint+'/preview',{data:{expectedRevision:draft.revision,trial},timeout:120000});
      assert.equal(response.status(),200);
      const native=await response.json();
      snapshots.push({revision:run.inputRevision,pages:native.pageCount,layoutHash:proof.layoutHash,nativeHash:native.layoutHash,
        layoutExact:native.layoutHash===proof.layoutHash,
        editablePageExact:JSON.stringify(native.pages[0])===JSON.stringify(run.firstPage),
        focusPageExact:native.pageIndex===run.pageIndex});
      if(native.layoutHash!==proof.layoutHash)break;
    }
    return {member:member+1,fingerprint:draft.fingerprint,pages:setup.pageCount,bursts,discarded:observed.discarded.length,staleRejected,snapshots};
  }finally{await page.close();}
}
try{
  await mkdir(resolve(output),{recursive:true});
  for(const member of (process.env.FLOWDOC_EDIT_MEMBER===undefined?[1,94]:[Number(process.env.FLOWDOC_EDIT_MEMBER)])){
    const result=await profile(member);
    reports.push(result);
    await writeFile(resolve(output,'worker-preview.json'),JSON.stringify({hz,strokes,renderer,reports},null,2)+'\n');
    console.log(JSON.stringify(result));
    assert.equal(result.snapshots.length,3);
    assert.ok(result.snapshots.every(sample=>sample.layoutExact&&sample.focusPageExact&&sample.editablePageExact),'Native layout or focus differs');
    assert.ok(result.bursts.every(burst=>burst.early.some(run=>run.beforeKeyup&&run.leadMs>0&&run.sameInk&&run.focused)),
      'a closed Engine page must paint ahead of the full revision and match its ink');
    if(crossPage&&member===94){
      assert.ok(result.bursts.every(burst=>
        burst.early.some(run=>run.beforeKeyup&&run.caretPage>burst.startPage&&run.sameInk&&run.keptSurface)),
        'the visible caret must cross a page while the key is held');
      assert.ok(result.bursts.every(burst=>
        burst.early.some(run=>run.revision===burst.revisions.at(-1)&&run.sameInk&&run.keptSurface)),
        'the last early surface must remain in place after keyup and full confirmation');
    }
  }
}finally{await browser.close();}
