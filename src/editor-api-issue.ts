import type {Trial} from './editor-trial';

export type IssueContext={
  url:string;
  templateId:string;
  docKey:string;
  revision:number;
  fingerprint:string;
  currentRun:()=>string|undefined;
  needsPrintLayout:()=>boolean;
  openPrintLayout:()=>void;
  snapshot:()=>Promise<Pick<Trial,'data'|'sections'|'images'>>;
  openPreview:()=>void;
  refreshSource:()=>void;
};
type Receipt={templateId:string;docKey:string;revision:number;draftFingerprint:string;version:number;taskId:string;pdfUrl:string;sha256:string;byteLength:number};

export function issuePanel(ctx:IssueContext,signal:AbortSignal){
  const panel=document.createElement('section');
  panel.className='api-issue-panel';panel.hidden=true;
  const heading=document.createElement('h3');heading.textContent='ออกเอกสาร PDF';
  const status=document.createElement('p');status.id='api-issue-status';status.setAttribute('role','status');
  const action=document.createElement('button');action.id='api-issue';action.type='button';action.className='primary';
  action.textContent='ออก PDF ผ่าน API';
  const go=document.createElement('button');go.id='api-open-preview';go.type='button';go.textContent='เปิด Preview';go.onclick=ctx.openPreview;
  const task=document.createElement('code');task.id='api-issued-task';task.hidden=true;
  const link=document.createElement('a');link.id='api-issued-pdf';link.textContent='ดาวน์โหลด PDF';link.hidden=true;
  panel.append(heading,status,action,go,task,link);
  let busy=false,stale=false;
  function ready(){
    const available=!!ctx.currentRun();
    action.disabled=busy||!available;
    go.hidden=available;
    if(ctx.needsPrintLayout()){
      go.textContent='ดูหน้าที่จะออก PDF';go.onclick=ctx.openPrintLayout;
      status.textContent='ตรวจหน้าที่จะออก PDF เพื่อใช้ช่องว่างตามที่กรอก';
      return;
    }
    status.textContent=available?'ใช้ข้อมูลและรูปจาก Preview ล่าสุด · Revision '+ctx.revision:'เปิด Preview เพื่อตรวจข้อมูลก่อนออกเอกสาร';
  }
  void fetch(ctx.url,{signal}).then(async response=>{
    if(!response.ok||!(await response.json()).available||signal.aborted)return;
    panel.hidden=false;ready();
  }).catch(()=>{});
  action.onclick=async()=>{
    const previewId=ctx.currentRun();
    if(busy||!previewId||signal.aborted)return;
    busy=true;action.disabled=true;link.hidden=true;task.hidden=true;
    status.textContent='กำลังออกเอกสารผ่าน Service…';
    try{
      const trial=await ctx.snapshot();
      if(signal.aborted)return;
      if(ctx.currentRun()!==previewId)throw Error('ข้อมูลเปลี่ยนแล้ว กรุณาเปิด Preview อีกครั้ง');
      const response=await fetch(ctx.url,{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({expectedRevision:ctx.revision,fingerprint:ctx.fingerprint,previewId,trial}),
        signal:AbortSignal.any([signal,AbortSignal.timeout(180000)])});
      if(!response.ok){
        const error=await response.json().catch(()=>({}));
        if(error.error==='PREVIEW_PLACEHOLDERS'){
          stale=true;go.hidden=false;go.textContent='ดูหน้าที่จะออก PDF';go.onclick=ctx.openPrintLayout;
          throw Error('ตรวจหน้าที่จะออก PDF เพื่อใช้ช่องว่างตามที่กรอก');
        }
        if(response.status===409){
          stale=true;go.hidden=false;go.textContent='โหลดฉบับล่าสุด';go.onclick=ctx.refreshSource;
          throw Error('ฉบับหรือข้อมูล Preview เปลี่ยนแล้ว กรุณาตรวจ Preview อีกครั้ง');
        }
        if(error.error==='INCOMPLETE_PDF')throw Error('เอกสารที่สร้างมีเนื้อหาไม่ครบ กรุณาตรวจรูปและข้อมูลใน Preview');
        if(response.status===422)throw Error('ตรวจข้อมูลที่จำเป็นและภาพใน Preview ก่อนออกเอกสาร');
        if(response.status===403||response.status===404)throw Error('ฉบับนี้ยังใช้คำสั่งออกเอกสารไม่ได้');
        throw Error('Service ออกเอกสารไม่สำเร็จ กรุณาลองอีกครั้ง');
      }
      const receipt=await response.json() as Receipt;
      const pdf=new URL(receipt.pdfUrl,location.origin);
      if(receipt.templateId!==ctx.templateId||receipt.docKey!==ctx.docKey||receipt.revision!==ctx.revision||
        receipt.draftFingerprint!==ctx.fingerprint||!receipt.taskId||!receipt.pdfUrl||pdf.origin!==location.origin||
        pdf.protocol!==location.protocol||pdf.username||pdf.password||!(receipt.byteLength>0)||!receipt.sha256)throw Error('ยืนยันไฟล์ของงานนี้ไม่ได้');
      if(signal.aborted)return;
      task.textContent=receipt.taskId;task.hidden=false;
      link.href=pdf.href;link.download=ctx.docKey+'.pdf';link.hidden=false;
      status.textContent='ออกเอกสารแล้ว · เวอร์ชัน '+receipt.version+' · รหัสงาน';
    }catch(cause){
      if(!signal.aborted)status.textContent=cause instanceof Error?cause.message:'ออกเอกสารไม่สำเร็จ';
    }finally{
      busy=false;action.disabled=stale||!link.hidden||!ctx.currentRun();
    }
  };
  return panel;
}
