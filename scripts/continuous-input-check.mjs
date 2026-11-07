// Regression gate: sample WHILE typing, without waiting for Engine settlement.
import {chromium} from '@playwright/test';
import fs from 'node:fs';
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
try {
  const page=await browser.newPage({viewport:{width:1280,height:900}});
  await page.goto('http://127.0.0.1:5173/');
  await page.waitForFunction(()=>window.spike?.snapshot().paintedRevision===0);
  await page.click('#target');
  const samples=[];
  for(let i=0;i<60;i++){
    await page.keyboard.insertText('ก');
    samples.push(await page.evaluate(()=>{
      const s=window.spike.snapshot();
      const line=document.querySelector('[data-member="21"] .engine-line');
      const paper=document.querySelector(`.paper[data-page="${line.dataset.page}"]`).getBoundingClientRect();
      const bounds=line.getBoundingClientRect();
      return {at:performance.now(),revision:s.revision,paintedRevision:s.paintedRevision,
        overflowPt:Math.max(0,(bounds.right-paper.left)*.75-296),caretOffset:s.selection.offset};
    }));
    await page.waitForTimeout(35);
  }
  fs.mkdirSync('artifacts',{recursive:true});
  await page.screenshot({path:'artifacts/continuous-input-overflow.png',fullPage:true});
  const maxOverflowPt=Math.max(...samples.map(s=>s.overflowPt));
  const pass=maxOverflowPt<=.5;
  const report={status:pass?'PASS':'FAIL',scenario:'60 Thai characters at 35 ms gaps, measured during input before waiting for layout',
    maxOverflowPt,typingDurationMs:samples.at(-1).at-samples[0].at,
    layoutUpdatesDuringInput:new Set(samples.map(s=>s.paintedRevision)).size-1,
    userFeedback:'Unusable: feedback cannot keep up with typing; text crosses neighboring columns.',
    conclusion:'Settled layout parity does not pass interactive editing acceptance.',samples};
  fs.writeFileSync('artifacts/continuous-input-report.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify({...report,samples:undefined}));
  if(!pass)process.exitCode=1;
}finally{await browser.close()}
