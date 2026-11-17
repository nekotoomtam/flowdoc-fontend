type Share = {id:string;revision:number;expiresAt:string;url?:string};
type Context = {endpoint:string;revision:number;fingerprint:string};

const control=<T extends HTMLElement>(id:string)=>document.getElementById(id)! as T;
const expires=(time:string)=>new Intl.DateTimeFormat('th-TH',{dateStyle:'medium',timeStyle:'short'}).format(new Date(time));

export function installPreviewShare(context:()=>Context|undefined){
  const open=control<HTMLButtonElement>('open-preview-share');
  const dialog=control<HTMLDialogElement>('preview-share-dialog');
  const create=control<HTMLButtonElement>('create-preview-share');
  const copy=control<HTMLButtonElement>('copy-preview-share');
  const link=control<HTMLInputElement>('preview-share-link');
  const copyRow=control('preview-share-copy-row');
  const list=control('preview-share-list');
  const status=control('preview-share-status');
  let endpoint:string|undefined;
  let pending=false;

  async function refresh(){
    if(!endpoint)return;
    const response=await fetch(endpoint,{cache:'no-store'});
    if(!response.ok)throw Error('เปิดรายการลิงก์ไม่ได้');
    const {shares}=await response.json() as {shares:Share[]};
    const rows=shares.map(share=>{
      const row=document.createElement('div');
      row.className='preview-share-item';
      const label=document.createElement('span');
      label.textContent='Revision '+share.revision+' · หมดอายุ '+expires(share.expiresAt);
      const revoke=document.createElement('button');
      revoke.type='button';revoke.textContent='ยกเลิก';
      revoke.setAttribute('aria-label','ยกเลิกลิงก์ Revision '+share.revision+' หมดอายุ '+expires(share.expiresAt));
      revoke.onclick=async()=>{
        revoke.disabled=true;
        try{
          const reply=await fetch(endpoint+'/'+share.id,{method:'DELETE'});
          if(!reply.ok&&reply.status!==404)throw Error();
          if(link.dataset.shareId===share.id){copyRow.hidden=true;link.value='';}
          await refresh();
          status.textContent='ยกเลิกลิงก์แล้ว';
        }catch{status.textContent='ยกเลิกลิงก์ไม่สำเร็จ ลองอีกครั้ง';revoke.disabled=false;}
      };
      row.append(label,revoke);
      return row;
    });
    list.replaceChildren(...rows);
  }

  open.onclick=()=>{
    const draft=context();
    if(!draft)return;
    endpoint=draft.endpoint+'/preview-shares';
    status.textContent='';copyRow.hidden=true;link.value='';
    list.replaceChildren();dialog.showModal();
    void refresh().catch(()=>{status.textContent='เปิดรายการลิงก์ไม่ได้ ลองอีกครั้ง';});
  };
  create.onclick=async()=>{
    const draft=context();
    if(!draft||!endpoint||pending)return;
    pending=true;create.disabled=true;status.textContent='กำลังสร้างลิงก์…';
    try{
      const reply=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({expectedRevision:draft.revision,fingerprint:draft.fingerprint})});
      if(reply.status===409)throw Error('มีโครงฉบับใหม่ กรุณาโหลดฉบับล่าสุดก่อนสร้างลิงก์');
      if(reply.status===429)throw Error('ลิงก์ที่ใช้งานอยู่เต็ม กรุณายกเลิกลิงก์เก่าก่อน');
      if(!reply.ok)throw Error('สร้างลิงก์ไม่ได้ ลองอีกครั้ง');
      const share=await reply.json() as Share;
      link.value=share.url??'';link.dataset.shareId=share.id;copyRow.hidden=false;
      status.textContent='ลิงก์ใช้ได้ถึง '+expires(share.expiresAt);
      link.focus();link.select();
      void refresh().catch(()=>{});
    }catch(error){status.textContent=error instanceof Error?error.message:'สร้างลิงก์ไม่ได้';}
    finally{pending=false;create.disabled=false;}
  };
  copy.onclick=async()=>{
    try{await navigator.clipboard.writeText(link.value);status.textContent='คัดลอกลิงก์แล้ว';}
    catch{link.focus();link.select();status.textContent='กด Ctrl+C หรือ ⌘C เพื่อคัดลอกลิงก์';}
  };
  dialog.addEventListener('close',()=>{copyRow.hidden=true;link.value='';open.focus();});
}
