import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
fs.mkdirSync('artifacts',{recursive:true});
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
try{
 const page=await browser.newPage({viewport:{width:1280,height:900}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:5173');await page.waitForFunction(()=>window.spike?.snapshot().rows.length===34);await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(200);
 const snap=()=>page.evaluate(()=>window.spike.snapshot());
 const baseline=await snap();assert.equal(Math.max(...baseline.rows.map(r=>r.page)),2);
 await page.click('#target');await page.waitForTimeout(150);
 const before=await snap();assert.equal(before.selection.member,21);assert.equal(before.selection.offset,9);
 const initial=before.rows[21].text;
 const insertion='ทดสอบแก้ไขข้อมูลภาษาไทยกลางคำและตรวจสอบการแบ่งหน้ากระดาษ'.repeat(3);
 // CDP composition exercises Chromium's composition event path; not a physical Thai IME.
 const cdp=await page.context().newCDPSession(page);
 await cdp.send('Input.imeSetComposition',{text:insertion,selectionStart:insertion.length,selectionEnd:insertion.length});
 await cdp.send('Input.insertText',{text:insertion});
 await page.waitForTimeout(500);
 const after=await snap();assert.equal(after.rows[21].text,initial.slice(0,9)+insertion+initial.slice(9));
 const browserLines=await page.evaluate(()=>{const el=document.querySelector('[data-member="21"] .menu');const text=el.firstChild;const lines=[];for(let i=0;i<text.length;i++){const range=document.createRange();range.setStart(text,i);range.setEnd(text,i+1);const rect=range.getBoundingClientRect();let line=lines.find(l=>Math.abs(l.top-rect.top)<1);if(!line){line={top:rect.top,text:''};lines.push(line)}line.text+=text.textContent[i]}return lines.map(l=>l.text)});
 assert.equal(after.selection.member,21);assert.equal(after.selection.offset,9+insertion.length);assert.equal(after.rows[21].page,2);
 for(let i=0;i<34;i++)if(i!==21)assert.deepEqual(after.request.sections[0].data.parts[0].data.groups[0].members[i],baseline.request.sections[0].data.parts[0].data.groups[0].members[i]);
 const anchor=after.selection;await page.evaluate(()=>window.scrollTo(0,0));await page.waitForTimeout(80);await page.evaluate(()=>document.querySelector('[data-member="21"]').scrollIntoView({block:'center'}));await page.waitForTimeout(80);
 const returned=await snap();assert.deepEqual(returned.selection,anchor);
 const rect=await page.locator('[data-member="21"] .menu').boundingBox();assert.ok(returned.caret.left>=rect.x-1&&returned.caret.right<=rect.x+rect.width+1);assert.ok(returned.caret.top>=rect.y-1&&returned.caret.bottom<=rect.y+rect.height+1);
 await page.keyboard.insertText('ต่อ');const continued=await snap();assert.equal(continued.rows[21].text,initial.slice(0,9)+insertion+'ต่อ'+initial.slice(9));
 await page.keyboard.press('Control+z');await page.waitForTimeout(150); // history can group adjacent composition; verify restoration via complete undo.
 for(let i=0;i<4&&(await snap()).rows[21].text!==initial;i++)await page.keyboard.press('Control+z');
 assert.equal((await snap()).rows[21].text,initial);
 for(let i=0;i<5&&(await snap()).rows[21].text!==continued.rows[21].text;i++)await page.keyboard.press('Control+y');
 assert.equal((await snap()).rows[21].text,continued.rows[21].text);
 await page.waitForTimeout(250);await page.evaluate(()=>window.scrollTo(0,0));await page.waitForTimeout(100);await page.screenshot({path:'artifacts/edited-two-pages.png',fullPage:true});
 fs.writeFileSync('artifacts/edited-request.json',JSON.stringify(after.request,null,2));
 fs.writeFileSync('artifacts/browser-report.json',JSON.stringify({baseline,edited:after,browserLines,returned,continued,errors,checks:{twoPages:true,middleComposition:true,correctOwner:true,scrollCaret:true,continueTyping:true,undoRedo:true},limitations:['CDP composition, not physical OS IME','Whole-row pagination, not Engine-compatible split rows']},null,2));
 assert.deepEqual(errors,[]);console.log(JSON.stringify({checks:'PASS',beforePage:before.rows[21].page,afterPage:after.rows[21].page,compositionEvents:after.compositionEvents}));
}finally{await browser.close()}
