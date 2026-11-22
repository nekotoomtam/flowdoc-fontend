import {confirmPublication} from './confirm-publication';
import {paperView,type Paper,type ReviewPoint} from './baseline-compare';

function el<K extends keyof HTMLElementTagNameMap>(tag:K,text=''){
  const element=document.createElement(tag);element.textContent=text;return element;
}
function button(id:string,label:string){const b=el('button',label);b.id=id;b.type='button';return b;}
type State={pinned:number|null;versions:number[]};
type Copy={id:string;revision:number;fingerprint:string;changes:ReviewPoint[]};

export async function openDraftReview(panel:HTMLElement,url:string,name:string,state:State,source:number,signal:AbortSignal,finish:()=>Promise<void>){
 const latest=state.versions[0],next=latest+1,notes=el('p');notes.setAttribute('role','status');
 const tools=el('div');panel.replaceChildren(el('h3','ร่างจากรุ่น '+source),notes,tools);
 let copy:Copy|undefined,busy=false;
 async function post(action:string,extra:object={}){
   const res=await fetch(url+'/'+action,{method:'POST',signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({
     source,pinned:state.pinned,latest,id:copy?.id,fingerprint:copy?.fingerprint,revision:copy?.revision,...extra
   })});
   if(!res.ok)throw Error(res.status===409?'รุ่นหรือร่างเปลี่ยนแล้ว กรุณาเปิดรายละเอียดอีกครั้ง':'ทำรายการไม่สำเร็จ · '+res.status);
   return res.json();
 }
 async function run(work:()=>Promise<void>){
   if(busy)return;busy=true;tools.inert=true;
   try{await work();}catch(error){if(!signal.aborted)notes.textContent=error instanceof Error?error.message:'เชื่อมต่อไม่ได้';}
   finally{busy=false;tools.inert=false;}
 }
 function edit(){
   notes.textContent='คัดลอกกระดาษรุ่น '+source+' แล้ว';
   const toggle=el('input');toggle.id='draft-table';toggle.type='checkbox';
   const add=el('label');add.append(toggle,' เพิ่มตาราง');
   const column=el('input'),field=el('input');column.id='draft-column';field.id='draft-field';
   column.value='รายละเอียด';field.value='receiptDetail';column.maxLength=100;field.maxLength=64;
   const colLabel=el('label','หัวคอลัมน์'),fieldLabel=el('label','ผูกช่องข้อมูลกับตัวแปรใหม่');colLabel.append(column);fieldLabel.append(field);
   const save=button('draft-save','บันทึกร่าง');const editor=el('div');editor.className='review-fields';editor.append(colLabel,fieldLabel,save);editor.hidden=true;
   toggle.onchange=()=>{editor.hidden=!toggle.checked};
   save.onclick=()=>void run(async()=>{copy=await post('save-review',{column:column.value,field:field.value,nonce:crypto.randomUUID()});summary();});
   tools.replaceChildren(add,editor);
 }
 function summary(){
   notes.textContent=copy!.changes.map(c=>c.label).join('　·　');
   const overlay=button('draft-overlay','ดูจุดต่างบนกระดาษ'),publish=button('draft-publish','เผยแพร่เป็นรุ่น '+next);
   const view=el('div'),info=el('small','หลังเผยแพร่ ระบบรับงาน'+(state.pinned===null?'จะใช้รุ่นล่าสุด':'ยังใช้รุ่น '+state.pinned));
   const changes=copy!.changes;
   async function show(pageIndex=0){
     const response=await post('paper-review',{pageIndex}) as {papers:Paper[]};
     const displayed=el('div');displayed.className='compare-papers';
     const selected=el('p');selected.setAttribute('role','status');
     function pick(kind:string){
       const change=changes.find(c=>c.kind===kind)!;
       for(const box of displayed.querySelectorAll<SVGElement>('[data-review-point]'))box.setAttribute('aria-pressed',String(box.dataset.reviewPoint===kind));
       const mark=displayed.querySelector('[aria-pressed=true]');
       if(mark)mark.scrollIntoView({block:'nearest'});
       selected.textContent=change.label+' · เพิ่มในร่างนี้';
     }
     for(const [i,p] of response.papers.entries())displayed.append(paperView(p,i,()=>{},{heading:i?'ร่างที่จะเผยแพร่เป็นรุ่น '+next:'ต้นฉบับรุ่น '+source,points:i?changes:[],pick}));
     const switches=el('div');
     for(const change of changes){const b=el('button',change.label);b.onclick=()=>pick(change.kind);switches.append(b);}
     const pages=Math.max(...response.papers.map(p=>p.pageCount));
     if(pages>1)for(const direction of [-1,1]){const b=el('button',direction<0?'หน้าก่อน':'หน้าถัดไป');b.disabled=pageIndex+direction<0||pageIndex+direction>=pages;b.onclick=()=>void run(()=>show(pageIndex+direction));switches.append(b);}
     view.replaceChildren(switches,displayed,selected);
     overlay.textContent='ปิดหน้าทาบ';
   }
   overlay.onclick=()=>{if(view.childElementCount){view.replaceChildren();overlay.textContent='ดูจุดต่างบนกระดาษ';}else void run(()=>show());};
   publish.onclick=()=>void run(async()=>{if(await confirmPublication(name,next,state.pinned)&&!signal.aborted&&publish.isConnected){await post('publish-review');await finish();}});
   tools.replaceChildren(overlay,view,info,publish);
 }
 await run(async()=>{copy=await post('clone-review',{nonce:crypto.randomUUID()});edit();});
}
