import {confirmPublication} from './confirm-publication';
import type {Trial} from './editor-trial';

export type IssueContext={
  url:string;
  templateId:string;
  name:string;
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

export function issuePanel(ctx:IssueContext,signal:AbortSignal,surface:'api'|'preview'='api'){
  const panel=document.createElement('section');
  panel.className='api-issue-panel';panel.hidden=true;
  const heading=document.createElement('h3');heading.textContent='ออกเอกสาร PDF';
  const status=document.createElement('p');status.id=surface+'-issue-status';status.setAttribute('role','status');
  const action=document.createElement('button');action.id=surface+'-issue';action.type='button';action.className='primary';
  action.textContent='เผยแพร่รุ่นนี้และออก PDF';
  const go=document.createElement('button');go.id=surface+'-open-preview';go.type='button';go.textContent='เปิด Preview';go.onclick=ctx.openPreview;
  const task=document.createElement('code');task.id=surface+'-issued-task';task.hidden=true;
  const link=document.createElement('a');link.id=surface+'-issued-pdf';link.textContent='ดาวน์โหลด PDF';link.hidden=true;
  if(surface==='preview'){
    panel.className='preview-issue-panel';
    action.textContent='ออก PDF';
    panel.append(action,link,status,task,go);
  }else panel.append(heading,status,action,go,task,link);
  let busy=false,stale=false,managed=false;
  function ready(){
    const available=!!ctx.currentRun();
    action.disabled=busy||!available;
    go.hidden=available;
    if(ctx.needsPrintLayout()){
      go.textContent='ดูหน้าที่จะออก PDF';go.onclick=ctx.openPrintLayout;
      status.textContent='ตรวจหน้าที่จะออก PDF เพื่อใช้ช่องว่างตามที่กรอก';
      return;
    }
    if(surface==='preview'){status.textContent='';return;}
    status.textContent=available?'ใช้ข้อมูลและรูปจาก Preview ล่าสุด · Revision '+ctx.revision:'เปิด Preview เพื่อตรวจข้อมูลก่อนออกเอกสาร';
  }
  function unavailable(reason:string){
    if(signal.aborted||surface!=='api')return;
    panel.hidden=false;action.hidden=true;go.hidden=true;
    heading.textContent='เผยแพร่เพื่อเรียกผ่าน API';
    status.textContent=reason;
    const request=document.createElement('textarea');
    request.readOnly=true;request.rows=3;request.setAttribute('aria-label','ข้อความถึงผู้ดูแล Service');
    request.value='ถึงผู้ดูแล Service ออกเอกสารของ Lab · '+reason+' กรุณาตรวจแม่แบบ '+ctx.docKey+
      ' (ID '+ctx.templateId+') รุ่น '+ctx.revision+' เพื่อเผยแพร่และออก PDF';
    const copy=document.createElement('button');copy.type='button';copy.textContent='คัดลอกคำขอให้ผู้ดูแล Service';
    copy.onclick=async()=>{
      try{await navigator.clipboard.writeText(request.value);copy.textContent='คัดลอกแล้ว · ส่งให้ผู้ดูแล Service';}
      catch{request.focus();request.select();}
    };
    panel.append(request,copy);
  }
  void fetch(ctx.url,{signal}).then(async response=>{
    if(signal.aborted)return;
    const result=await response.json();
    if(response.ok&&result.available===true){
      managed=result.managed===true;
      if(managed&&surface==='api')action.textContent='ออก PDF จากรุ่นที่เผยแพร่ตรงกับ Preview';
      panel.hidden=false;ready();return;
    }
    if(result.error==='ISSUE_NOT_AVAILABLE')unavailable('แม่แบบนี้ยังไม่ได้เปิดสิทธิ์ออกเอกสาร');
    else if(result.reason==='service_unconfigured')unavailable('Editor นี้ยังไม่ได้เชื่อม Service สำหรับเผยแพร่และออก PDF');
    else if(response.status===403)unavailable('คำขอถูกปฏิเสธ กรุณาให้ผู้ดูแลตรวจสิทธิ์');
    else unavailable('ยังยืนยันการเชื่อมต่อและสิทธิ์ของแม่แบบไม่ได้');
  }).catch(()=>unavailable('ตรวจสถานะ Service ไม่สำเร็จ กรุณาให้ผู้ดูแลตรวจการเชื่อมต่อ'));
  action.onclick=async()=>{
    const previewId=ctx.currentRun();
    if(busy||!previewId||signal.aborted)return;
    if(!managed&&(!await confirmPublication(ctx.name,ctx.revision)||signal.aborted||!action.isConnected))return;
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
        if(error.error==='PUBLISH_DRAFT_FIRST')throw Error('ร่างนี้ต่างจากรุ่นที่เผยแพร่ล่าสุด กรุณาเผยแพร่ร่างจากคลังก่อนออก PDF ฉบับนี้');
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
      if(signal.aborted||ctx.currentRun()!==previewId)return;
      if(surface==='preview')action.hidden=true;
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
