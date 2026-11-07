import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
fs.mkdirSync('artifacts',{recursive:true});
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
try{
 const page=await browser.newPage({viewport:{width:1280,height:900},recordVideo:{dir:'artifacts/video',size:{width:1280,height:900}}}),errors=[],apiCalls=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.url().includes('/api/layout'))apiCalls.push(r.url())});
 await page.goto('http://127.0.0.1:5173');await page.waitForFunction(()=>window.spike?.snapshot().paintedRevision===0);
 await page.click('#target');
 const snapshot=()=>page.evaluate(()=>window.spike.snapshot());
 const baseline=await snapshot(),baseText=baseline.request.sections[0].data.parts[0].data.groups[0].members[21].menu;
 const checkpoints=[{name:'baseline',state:baseline}];
 // Monitor every browser frame, including frames between keystrokes and before settlement.
 await page.evaluate(()=>{
  window.liveFrames=[];window.captureLive=true;
  function frame(){if(!window.captureLive)return;const s=window.spike.snapshot();let overflow=0,overlap=0,offPage=0;
   const groups=new Map();
   for(const el of document.querySelectorAll('.engine-line')){
    const r=el.getBoundingClientRect(),p=document.querySelector(`.paper[data-page="${el.dataset.page}"]`).getBoundingClientRect();
    overflow=Math.max(overflow,(r.right-p.left)*.75-296,191-(r.left-p.left)*.75);
    offPage=Math.max(offPage,36-(r.top-p.top)*.75,(r.bottom-p.top)*.75-(841.8897637795276-36));
    const k=el.dataset.page;if(!groups.has(k))groups.set(k,[]);groups.get(k).push(r);
   }
   for(const values of groups.values()){values.sort((a,b)=>a.top-b.top);for(let i=1;i<values.length;i++)overlap=Math.max(overlap,(values[i-1].bottom-values[i].top)*.75)}
   window.liveFrames.push({at:performance.now(),revision:s.revision,paintedRevision:s.paintedRevision,overflowPt:overflow,overlapPt:overlap,offPagePt:offPage});requestAnimationFrame(frame);
  }requestAnimationFrame(frame);
 });
 const text='ก'.repeat(90)+'ทดสอบแก้ไขข้อมูลภาษาไทยกลางคำให้ต่อหน้ากระดาษและเลื่อนกลับมาตรวจสอบ'.repeat(2);
 let inserted='';const samples=[];let index=0;
 for(const ch of text){
  await page.keyboard.insertText(ch);inserted+=ch;index++;
  const s=await snapshot();
  assert.equal(s.request.sections[0].data.parts[0].data.groups[0].members[21].menu,baseText.slice(0,9)+inserted+baseText.slice(9));
  assert.equal(s.selection.member,21);assert.equal(s.selection.offset,9+inserted.length);
  assert.ok(s.caret.top>=66&&s.caret.bottom<=900,`caret left viewport at character ${index}`);
  assert.equal(s.revision,s.paintedRevision,'layout must be current at input callback, not after an idle wait');
  samples.push({revision:s.revision,ms:s.inputLatencies.at(-1),nextRow:s.layout.rows[22].lines[0]});
  if([30,90,150,text.length].includes(index))checkpoints.push({name:`input-${index}`,state:s});
  await page.waitForTimeout(20);
 }
 const after=await snapshot();
 assert.deepEqual([...new Set(after.layout.rows[21].lines.map(l=>l.page))],[1,2]);
 assert.notDeepEqual(after.layout.rows[22].lines[0],baseline.layout.rows[22].lines[0],'following row must move');
 for(let i=0;i<34;i++)if(i!==21)assert.deepEqual(after.request.sections[0].data.parts[0].data.groups[0].members[i],baseline.request.sections[0].data.parts[0].data.groups[0].members[i]);
 const anchor=after.selection;await page.evaluate(()=>window.scrollTo(0,0));await page.waitForTimeout(80);
 await page.locator('[data-member="21"] .engine-line[data-page="2"]').last().scrollIntoViewIfNeeded();
 assert.deepEqual((await snapshot()).selection,anchor);
 await page.keyboard.insertText('ต่อ');const continued=await snapshot();
 assert.equal(continued.request.sections[0].data.parts[0].data.groups[0].members[21].menu,baseText.slice(0,9)+inserted+'ต่อ'+baseText.slice(9));
 // Observe all frames up to and including the final edit.
 await page.waitForTimeout(80);const frames=await page.evaluate(()=>{window.captureLive=false;return window.liveFrames});
 assert.equal(apiCalls.length,0,'interactive layout must not depend on a server response');assert.deepEqual(errors,[]);
 const maxOverflowPt=Math.max(...frames.map(f=>f.overflowPt));const maxOverlapPt=Math.max(...frames.map(f=>f.overlapPt));const maxOffPagePt=Math.max(...frames.map(f=>f.offPagePt));
 assert.ok(maxOverflowPt<.5,`overflow ${maxOverflowPt}`);assert.ok(maxOverlapPt<.5,`overlap ${maxOverlapPt}`);assert.ok(maxOffPagePt<.5,`offpage ${maxOffPagePt}`);
 assert.ok(frames.every(f=>f.revision===f.paintedRevision),'a browser frame displayed stale layout');
 // Oracle comparison runs AFTER the input test, from the harness, not from the editor.
 const parity=[];
 for(const checkpoint of checkpoints){const response=await fetch('http://127.0.0.1:5173/api/layout',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(checkpoint.state.request)});const native=await response.json();assert.equal(response.status,200,JSON.stringify(native));assert.deepEqual(checkpoint.state.layout,native.layout,`native mismatch at ${checkpoint.name}`);parity.push({name:checkpoint.name,equal:true,requestHash:native.requestHash,engineMs:native.engineMs})}
 await page.screenshot({path:'artifacts/continuous-local-boundary.png'});await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:'artifacts/continuous-local-two-pages.png',fullPage:true});
 const sorted=samples.map(s=>s.ms).sort((a,b)=>a-b);
 const report={status:'PASS_BOUNDED_LIVE_INPUT',characters:text.length,frameCount:frames.length,maxOverflowPt,maxOverlapPt,maxOffPagePt,staleFrames:frames.filter(f=>f.revision!==f.paintedRevision).length,interactiveApiRequests:apiCalls.length,inputToLayoutMs:{median:sorted[Math.floor(sorted.length*.5)],p95:sorted[Math.floor(sorted.length*.95)],max:sorted.at(-1)},checks:{continuousThai:true,splitAcrossPages:true,followingRowsMove:true,caretAndOwnerEveryInput:true,scrollAndContinue:true,nativeLayoutExactAtCheckpoints:true},parity,frames,samples,limitations:['Physical OS IME not certified','Fixed UAT 34-row fixture; not a general authoring adapter','Large-document performance and printer pixels not qualified']};
 fs.writeFileSync('artifacts/live-input-report.json',JSON.stringify(report,null,2));fs.writeFileSync('artifacts/live-input-checkpoints.json',JSON.stringify(checkpoints,null,2));
 const video=page.video();await page.context().close();await video.saveAs('artifacts/live-input.webm');
 console.log(JSON.stringify({...report,frames:undefined,samples:undefined}));
}finally{await browser.close()}
