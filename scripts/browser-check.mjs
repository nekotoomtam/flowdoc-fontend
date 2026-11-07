import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
fs.mkdirSync('artifacts',{recursive:true});
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
try{
 const page=await browser.newPage({viewport:{width:1280,height:900}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:5173');
 const settled=()=>page.waitForFunction(()=>window.spike&&window.spike.snapshot().paintedRevision===window.spike.snapshot().revision&&!window.spike.snapshot().inFlight,{},{timeout:30000});
 const snap=()=>page.evaluate(()=>window.spike.snapshot());
 await settled();const baseline=await snap();assert.equal(baseline.layout.pages.length,2);
 const originalView=await page.evaluate(()=>{window.originalView=window.spike.view;return true});
 await page.click('#target');const before=await snap();assert.equal(before.selection.member,21);assert.equal(before.selection.offset,9);
 const initial=before.layout.rows[21].text;
 const insertion='ทดสอบแก้ไขข้อมูลภาษาไทยกลางคำและตรวจสอบการแบ่งหน้ากระดาษ'.repeat(3);
 const cdp=await page.context().newCDPSession(page);
 for(const text of [insertion.slice(0,8),insertion.slice(0,36),insertion]){
   await cdp.send('Input.imeSetComposition',{text,selectionStart:text.length,selectionEnd:text.length});
 }
 await page.waitForTimeout(500);
 const composing=await snap();assert.equal(composing.composing,true);assert.equal(composing.paintedRevision,baseline.paintedRevision);
 await cdp.send('Input.insertText',{text:insertion});
 await settled();const after=await snap();
 assert.equal(after.layout.rows[21].text,initial.slice(0,9)+insertion+initial.slice(9));
 assert.deepEqual([...new Set(after.layout.rows[21].lines.map(l=>l.page))],[1,2]);
 assert.equal(after.selection.member,21);assert.equal(after.selection.offset,9+insertion.length);
 assert.equal(after.engineResponse.requestHash,createHash('sha256').update(JSON.stringify(after.request)).digest('hex'));
 function ownerCheck(state){for(let i=0;i<34;i++)if(i!==21)assert.deepEqual(state.request.sections[0].data.parts[0].data.groups[0].members[i],baseline.request.sections[0].data.parts[0].data.groups[0].members[i]);}
 ownerCheck(after);
 // Inspect actual DOM placement and line content, not just the projection model.
 const domLines=await page.evaluate(()=>Array.from(document.querySelectorAll('[data-member="21"] .engine-line')).map(el=>{const rect=el.getBoundingClientRect(),paper=document.querySelector(`.paper[data-page="${el.dataset.page}"]`).getBoundingClientRect();return {text:el.textContent,page:+el.dataset.page,from:+el.dataset.from,to:+el.dataset.to,xPt:(rect.left-paper.left)*.75,yPt:(rect.top-paper.top)*.75}}));
 assert.equal(domLines.length,after.layout.rows[21].lines.length);
 domLines.forEach((line,i)=>{const engine=after.layout.rows[21].lines[i];assert.equal(line.text,engine.text);assert.equal(line.page,engine.page);assert.ok(Math.abs(line.xPt-engine.xPt)<.1);assert.ok(Math.abs(line.yPt-engine.yPt)<.1)});
 // Click into the continuation on page 2 using real mouse coordinates.
 const continuation=page.locator('[data-member="21"] .engine-line[data-page="2"]').nth(1);
 await continuation.scrollIntoViewIfNeeded();
 const clickPoint=await continuation.evaluate(el=>{const t=el.firstChild;const range=document.createRange();range.setStart(t,4);range.setEnd(t,5);const r=range.getBoundingClientRect();return{x:r.left+.2,y:(r.top+r.bottom)/2}});
 await page.mouse.click(clickPoint.x,clickPoint.y);await page.waitForTimeout(80);
 const clicked=await snap();assert.equal(clicked.selection.member,21);assert.ok(clicked.selection.offset>after.layout.rows[21].lines[0].to);
 const clickOffset=clicked.selection.offset;const old=after.layout.rows[21].text;
 const second='แก้ตรงนี้';
 await cdp.send('Input.imeSetComposition',{text:second,selectionStart:second.length,selectionEnd:second.length});await cdp.send('Input.insertText',{text:second});
 await settled();const continuationEdit=await snap();assert.equal(continuationEdit.layout.rows[21].text,old.slice(0,clickOffset)+second+old.slice(clickOffset));ownerCheck(continuationEdit);
 const anchor=continuationEdit.selection;
 await page.evaluate(()=>window.scrollTo(0,0));await page.waitForTimeout(100);
 await page.locator('[data-member="21"] .engine-line[data-page="2"]').first().scrollIntoViewIfNeeded();await page.waitForTimeout(100);
 const returned=await snap();assert.deepEqual(returned.selection,anchor);
 const caretInLine=await page.evaluate(()=>{const s=window.spike.snapshot();return Array.from(document.querySelectorAll('[data-member="21"] .engine-line')).some(el=>{const r=el.getBoundingClientRect();return s.caret.left>=r.left-1&&s.caret.right<=r.right+1&&s.caret.top>=r.top-1&&s.caret.bottom<=r.bottom+1})});assert.equal(caretInLine,true);
 await page.keyboard.insertText('ต่อ');await settled();const continued=await snap();const value=continuationEdit.layout.rows[21].text;assert.equal(continued.layout.rows[21].text,value.slice(0,anchor.offset)+'ต่อ'+value.slice(anchor.offset));ownerCheck(continued);
 // Return to the part of the SAME cell remaining at the foot of page 1.
 const firstPart=page.locator('[data-member="21"] .engine-line[data-page="1"]').first();await firstPart.scrollIntoViewIfNeeded();
 const firstPoint=await firstPart.evaluate(el=>{const t=el.firstChild,r=document.createRange();r.setStart(t,2);r.setEnd(t,3);const b=r.getBoundingClientRect();return{x:b.left+.2,y:(b.top+b.bottom)/2}});await page.mouse.click(firstPoint.x,firstPoint.y);await page.waitForTimeout(80);
 const firstClick=await snap();assert.equal(firstClick.selection.member,21);const at=firstClick.selection.offset;
 await page.keyboard.insertText('ใหม่');await settled();const firstEdit=await snap();assert.equal(firstEdit.layout.rows[21].text,continued.layout.rows[21].text.slice(0,at)+'ใหม่'+continued.layout.rows[21].text.slice(at));ownerCheck(firstEdit);
 await page.keyboard.press('Control+z');await settled();const undone=await snap();assert.equal(undone.layout.rows[21].text,continued.layout.rows[21].text);
 await page.keyboard.press('Control+y');await settled();assert.equal((await snap()).layout.rows[21].text,firstEdit.layout.rows[21].text);
 // A response for an older edit must not overwrite newer typing or its caret.
 const staleBefore=await snap(),staleText=staleBefore.layout.rows[21].text,staleAt=staleBefore.selection.offset;
 await page.keyboard.insertText('ก');await page.waitForFunction(()=>window.spike.snapshot().inFlight);
 await page.keyboard.insertText('ข');await settled();const rapid=await snap();
 assert.ok(rapid.discarded>staleBefore.discarded);
 assert.equal(rapid.layout.rows[21].text,staleText.slice(0,staleAt)+'กข'+staleText.slice(staleAt));
 assert.equal(rapid.selection.member,21);assert.equal(rapid.selection.offset,staleAt+2);ownerCheck(rapid);
 assert.equal(await page.evaluate(()=>window.originalView===window.spike.view),originalView);
 await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:'artifacts/engine-split-two-pages.png',fullPage:true});
 assert.deepEqual(errors,[]);
 const report={status:'PASS_BOUNDED_EXPERIMENT',checks:{engineSplitPages:true,domLineTextAndPosition:true,compositionDeferred:true,caretAfterReflow:true,clickAndEditContinuation:true,scrollCaret:true,correctOwner:true,editFirstFragment:true,undoRedo:true,sameEditorView:true,staleResponseRejected:true},baseline,after,domLines,clicked,continuationEdit,returned,continued,firstEdit,rapid,errors,limitations:['CDP composition, not physical OS Thai IME','2 pages / 34 rows only; full UAT and large-document resource bounds not qualified','Engine round-trip latency; stale geometry remains visible while awaiting latest revision','Glyph pixel parity and printer output not tested']};
 fs.writeFileSync('artifacts/split-browser-report.json',JSON.stringify(report,null,2));
 fs.writeFileSync('artifacts/split-edited-request.json',JSON.stringify(after.request,null,2));
 console.log(JSON.stringify({status:report.status,checks:report.checks,enginePages:[...new Set(after.layout.rows[21].lines.map(l=>l.page))],latenciesMs:firstEdit.latencies.map(Math.round)}));
}finally{await browser.close()}
