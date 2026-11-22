import {draftInputContract, fullApiExample, postmanCollection, postmanCurl, postmanImage} from './editor-postman';
import type {Definition} from './editor-structure';

export async function showPublishedApi(stage:HTMLElement,item:{templateId:string;docKey:string},version:number,
  active:number|null|undefined,back:()=>void){
  const page=document.createElement('section');page.className='api-workspace';
  function add<K extends keyof HTMLElementTagNameMap>(tag:K,label:string){
    const el=document.createElement(tag);el.textContent=label;page.append(el);return el;
  }
  add('button','‹ กลับกระดาษรุ่น '+version).onclick=back;
  add('h3','เชื่อมต่อ API · รุ่น '+version);
  add('p',active?'เมื่อไม่ระบุรุ่น ระบบรับงานใช้รุ่น '+active:'ไม่มีข้อมูลยืนยันรุ่นที่ระบบรับงานใช้');
  const status=add('p','กำลังอ่านโครงรุ่นที่เผยแพร่…');status.setAttribute('role','status');
  stage.replaceChildren(page);
  try{
    const base='/api/editor-phase1/drafts/'+encodeURIComponent(item.templateId);
    const response=await fetch(base+'/versions/'+version);
    if(!response.ok)throw Error();
    const {value}=await response.json();
    if(value.revision!==version||value.definition.docKey!==item.docKey)throw Error();
    const contract={...draftInputContract(value.definition as Definition),docKey:item.docKey,version};
    const example=fullApiExample(contract);
    const publication=await fetch(base+'/publication').then(r=>r.ok?r.json():null).catch(()=>null);
    if(!page.isConnected)return;
    const target=publication?.value?.target;
    const address=target?.status==='verified'?target.baseUrl:'';
    const collection=postmanCollection(contract,example,address,true);
    status.textContent='ตัวอย่างนี้ระบุรุ่น '+version+' · ตั้งค่า FLOWDOC_TOKEN'+(address?'':' และ FLOWDOC_BASE_URL')+' ใน Postman';
    add('code','POST '+(address||'{{FLOWDOC_BASE_URL}}')+'/documents');
    const download=add('button','ดาวน์โหลด Postman');download.className='primary';
    download.onclick=()=>{
      const url=URL.createObjectURL(new Blob([JSON.stringify(collection,null,2)],{type:'application/json'}));
      const link=document.createElement('a');link.href=url;link.download=item.docKey+'.v'+version+'.postman_collection.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    };
    if(example.images.length){const image=add('a','ดาวน์โหลดรูปตัวอย่าง');image.href='/'+postmanImage;image.download=postmanImage;}
    for(const [title,body] of [['ข้อมูลที่ส่ง',JSON.stringify(example.payload,null,2)],['คำสั่ง cURL',postmanCurl(contract,example,address,true)],['โครงข้อมูลของรุ่นนี้',JSON.stringify(contract,null,2)]]){
      const details=add('details',''),summary=document.createElement('summary'),pre=document.createElement('pre');
      summary.textContent=title;pre.textContent=body;details.append(summary,pre);
    }
  }catch{status.textContent='อ่านโครงรุ่น '+version+' ไม่สำเร็จ';add('button','ลองอีกครั้ง').onclick=()=>showPublishedApi(stage,item,version,active,back);}
}
