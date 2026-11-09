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
const reports=[];
const stats=samples=>{
  const values=[...samples].sort((a,b)=>a-b);
  return Number(values[Math.ceil(values.length*.95)-1].toFixed(1));
};

function instrument(){
  const NativeWorker=window.Worker;
  const evidence=window.previewProof={submitted:new Map(),layout:[],discarded:[],paints:new Map(),inputs:[],errors:[]};
  const afterPaint=next=>requestAnimationFrame(()=>requestAnimationFrame(next));
  window.Worker=class extends NativeWorker{
    constructor(...args){
      super(...args);
      evidence.worker=this;
      this.addEventListener('message',({data})=>{
        if(data.kind==='superseded')evidence.discarded.push(data.revision);
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
    new MutationObserver(()=>{
      const run=paper.dataset.run;
      if(run)afterPaint(()=>{if(paper.dataset.run===run)evidence.paints.set(run,performance.now());});
    }).observe(paper,{attributes:true,attributeFilter:['data-run']});
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
    await target.first().click();
    await fields.nth(member).evaluate(input=>{window.testField=input;});
    let value=startValue;
    const bursts=[];
    for(let repeat=0;repeat<2;repeat++){
      await editor.evaluate(input=>input.setSelectionRange(4,4));
      await page.evaluate(()=>{window.previewProof.inputs=[];});
      const prior=(await waitForLayout(page,{key,expected:value})).inputRevision;
      value=value.slice(0,4)+'ก'.repeat(strokes)+value.slice(4);
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
      assert.equal(await editor.evaluate(input=>input===document.activeElement&&input.selectionStart===44),true);
      const measured=await page.evaluate(({prior,last})=>{
        const proof=window.previewProof;
        return {inputs:proof.inputs,layouts:proof.layout.filter(run=>run.inputRevision>prior&&run.inputRevision<=last)
          .map(run=>({...run,paint:proof.paints.get(run.previewId)}))};
      },{prior,last:final.inputRevision});
      assert.equal(measured.inputs.length,strokes);
      assert.ok(measured.inputs.every(input=>input.matches));
      const painted=measured.layouts.filter(run=>run.paint!==undefined);
      bursts.push({updatesBeforeKeyup:painted.filter(run=>run.paint<=keyup).length,
        feedbackP95Ms:stats(measured.inputs.map(input=>input.paint-input.at)),
        finalInputToPaperMs:Number((painted.at(-1).paint-measured.inputs.at(-1).at).toFixed(1)),
        revisions:painted.map(run=>run.inputRevision),engineMs:painted.map(run=>run.engineMs),
        workerMs:painted.map(run=>run.renderMs)});
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
      return latest!==run.previewId&&paper.dataset.run===latest;
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
  }
}finally{await browser.close();}
