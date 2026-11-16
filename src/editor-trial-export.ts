import {wordMediaType} from './editor-postman';
import type {Trial} from './editor-trial';

type Snapshot=Pick<Trial,'data'|'sections'|'images'>;
type Format='pdf'|'docx';
type Context={url:string;docKey:string;revision:number;fingerprint:string;snapshot:()=>Promise<Snapshot>};
const mediaType={pdf:'application/pdf',docx:wordMediaType};

export function installTrialExport(menu:HTMLDetailsElement,status:HTMLElement,context:()=>Context|undefined){
  const buttons=[...menu.querySelectorAll<HTMLButtonElement>('button[data-export-format]')];
  const summary=menu.querySelector('summary')!;
  let pending=false,noticeTimer:number|undefined;
  function inform(message:string,expires=false){
    window.clearTimeout(noticeTimer);
    status.textContent=message;status.hidden=false;
    if(expires)noticeTimer=window.setTimeout(()=>{status.hidden=true;},5000);
  }
  async function download(format:Format){
    const task=context();
    if(!task||pending)return;
    menu.open=false;
    summary.focus();
    pending=true;
    buttons.forEach(button=>button.disabled=true);
    inform('กำลังสร้างไฟล์จากข้อมูลทดลอง…');
    try{
      const trial=await task.snapshot();
      const response=await fetch(task.url,{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({format,expectedRevision:task.revision,fingerprint:task.fingerprint,trial}),
        signal:AbortSignal.timeout(180000)});
      if(!response.ok){
        const error=await response.json();
        if(error.error==='STALE_CURRENT')throw Error('โครงมีฉบับใหม่แล้ว กรุณาเปิดฉบับล่าสุดก่อนออกไฟล์');
        if(error.error==='font_not_ready')throw Error('ฟอนต์ของโครงยังไม่พร้อมสำหรับออกไฟล์');
        if(error.error==='invalid_image')throw Error('ตรวจไฟล์รูปที่แนบแล้วลองใหม่');
        if(error.error==='export_busy'||error.error==='lab_busy')throw Error('กำลังออกไฟล์อีกชุด ลองใหม่เมื่อเสร็จ');
        if(error.error==='body_too_large')throw Error('ข้อมูลทดลองและรูปมีขนาดรวมเกิน 4 MB');
        const issue=error.issues?.[0];
        throw Error(issue?'ตรวจข้อมูลทดลอง · '+(issue.path??'')+' · '+issue.code:'ออกไฟล์ไม่สำเร็จ ลองใหม่อีกครั้ง');
      }
      if(response.headers.get('Content-Type')!==mediaType[format])throw Error('ไม่ได้รับไฟล์ '+format.toUpperCase()+' จาก Engine');
      const file=await response.blob(),url=URL.createObjectURL(file);
      const link=document.createElement('a');
      link.href=url;link.download='preview-'+task.docKey+'.'+format;link.click();
      setTimeout(()=>URL.revokeObjectURL(url),30000);
      const warnings=Number(response.headers.get('X-FlowDoc-Warnings'));
      inform('ดาวน์โหลด '+(format==='docx'?'Word':'PDF')+' แล้ว'+(warnings?' · Engine แจ้งเตือน '+warnings+' รายการ':''),true);
    }catch(error){inform(error instanceof Error?error.message:'ออกไฟล์ไม่สำเร็จ');}
    finally{pending=false;buttons.forEach(button=>button.disabled=false);}
  }
  for(const button of buttons)button.onclick=()=>void download(button.dataset.exportFormat==='docx'?'docx':'pdf');
}
