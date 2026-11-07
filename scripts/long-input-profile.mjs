import {chromium} from '@playwright/test';
import fs from 'node:fs';
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const watchdog=setTimeout(()=>{browser.close().catch(()=>{});process.exitCode=1},55000);
const results=[];let stopReason=null;
try{
 const page=await browser.newPage();await page.goto('http://127.0.0.1:5173');await page.waitForFunction(()=>window.spike?.snapshot().paintedRevision===0);
 outer: for(const kind of ['repeated','thai-words'])for(const length of [256,1024,4096]){
   const text=(kind==='repeated'?'ก':'ทดสอบการจัดการข้อมูลภาษาไทย ').repeat(length).slice(0,length);
   const result=await page.evaluate(async({text,kind,length})=>{
     let heartbeatMax=0,last=performance.now();const interval=setInterval(()=>{const now=performance.now();heartbeatMax=Math.max(heartbeatMax,now-last);last=now},10);
     await new Promise(r=>setTimeout(r,30));
     const view=window.spike.view;let from,to;view.state.doc.forEach((n,p)=>{if(n.attrs.member===21){from=p+1;to=p+1+n.content.size}});
     const start=performance.now();view.dispatch(view.state.tr.insertText(text,from,to));
     while(window.spike.snapshot().paintedRevision!==window.spike.snapshot().revision){await new Promise(r=>setTimeout(r,10));if(window.spike.snapshot().error)throw Error(window.spike.snapshot().error)}
     const elapsed=performance.now()-start;await new Promise(r=>setTimeout(r,25));clearInterval(interval);
     const state=window.spike.snapshot();
     return{kind,length,elapsedMs:elapsed,layoutAndPaintMs:state.latencies.at(-1),mainThreadHeartbeatMaxMs:heartbeatMax,pages:state.layout.pages.length,renderedLines:document.querySelectorAll('.engine-line').length};
   },{text,kind,length});results.push(result);console.log(JSON.stringify(result));if(result.elapsedMs>2000){stopReason='Case exceeded 2-second responsiveness budget; stop scaling';break outer}
 }
}finally{clearTimeout(watchdog);fs.writeFileSync('artifacts/long-input-profile.json',JSON.stringify({candidate:'6d31865',status:'DIAGNOSTIC_NOT_ACCEPTANCE',stopReason,results},null,2));await browser.close()}
