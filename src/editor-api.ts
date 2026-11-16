import type {Definition, Schema} from './editor-structure';
import {draftInputContract,fullApiExample,imagePart,postmanCollection,postmanDocumentUrl,postmanImage} from './editor-postman';
import type {ApiExample as Example,PublishedContract} from './editor-postman';

type Publication={version:number;fingerprint:string;contract:PublishedContract};
type ApiContext={docKey:string;revision:number;fingerprint:string;definition:Definition;dirty:boolean;
  publicationUrl:string;trial?:()=>Example};

function element<K extends keyof HTMLElementTagNameMap>(tag:K,text?:string){
  const node=document.createElement(tag);
  if(text!==undefined)node.textContent=text;
  return node;
}
function button(label:string,run:()=>void){
  const control=element('button',label);
  control.type='button';control.onclick=run;return control;
}
const json=(value:unknown)=>JSON.stringify(value,null,2)+'\n';
const imageName=(index:number,file?:File)=>'image-'+(index+1)+(/\.jpe?g$/i.test(file?.name??'')?'.jpg':'.png');
function download(name:string,value:Blob){
  const url=URL.createObjectURL(value),a=element('a');
  a.href=url;a.download=name;a.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function details(label:string,content:HTMLElement){
  const panel=element('details');
  panel.append(element('summary',label),content);return panel;
}
function serviceBaseUrl(value:string){
  try{
    const url=new URL(value.trim());
    if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)return '';
    return url.origin+url.pathname.replace(/\/+$/,'');
  }catch{return '';}
}
const shellLiteral=(value:string)=>"'"+value.replaceAll("'","'\\''")+"'";
function generateCommand(docKey:string,images:Example['images']){
  return [
    'curl --request POST "${FLOWDOC_BASE_URL}/documents"',
    '  --header "Authorization: Bearer ${FLOWDOC_TOKEN}"',
    '  --header '+shellLiteral('Doc-Key: '+docKey),
    '  --header "Output-Format: pdf"',
    '  --header "Accept: multipart/mixed"',
    '  --form "payload=@payload.json;type=application/json"',
    ...images.map((image,i)=>{
      const name=imageName(i,image.file),media=name.endsWith('.jpg')?'image/jpeg':'image/png';
      return '  --form '+shellLiteral(imagePart(image.path)+'=@'+name+';type='+media);
    }),
    '  --output response.multipart',
  ];
}
export function showApi(panel:HTMLElement,ctx:ApiContext,signal:AbortSignal){
  const status=element('p','กำลังตรวจสถานะการเผยแพร่…');
  status.setAttribute('role','status');
  const notice=element('p');notice.setAttribute('role','status');notice.className='api-notice';
  async function copy(value:string,message:string){
    try{
      await navigator.clipboard.writeText(value);
      notice.textContent=message;
    }catch{
      notice.textContent='คัดลอกอัตโนมัติไม่ได้ เลือกข้อความหรือใช้ปุ่มดาวน์โหลด Postman';
    }
  }
  const head=element('div');head.className='api-heading';
  const handoff=element('div');handoff.className='api-buttons';
  const identity=element('p');identity.append(element('code',ctx.docKey),element('span','ฉบับที่บันทึก · Revision '+ctx.revision));
  handoff.append(button('คัดลอก docKey',()=>copy(ctx.docKey,'คัดลอก docKey แล้ว')));
  head.append(element('h2','นำโครงไปใช้ผ่าน API'),identity,status,handoff,notice);
  if(ctx.dirty)head.append(element('p','ตัวอย่างอ้างอิงฉบับที่บันทึกล่าสุด'));

  const spec=element('div');spec.className='api-scopes';
  function fields(label:string,schema:Schema){
    const list=element('ul');
    for(const [key,field] of Object.entries(schema.fields)){
      const item=element('li'),type={string:'ข้อความ',image:'รูปภาพ',link:'ลิงก์',array:'รายการ',area:'Area'}[field.type]??field.type;
      item.append(element('code',key),element('span',type+(field.required?' · ต้องส่ง':'')));
      if(field.items)item.append(fields('ข้อมูลในแต่ละรายการ',field.items));
      if(field.type==='area')for(const format of Object.values(ctx.definition.areaFormats??{})){
        if(format.ownerAreaId===field.areaId)item.append(fields('Format '+format.key,format.inputSchema));
      }
      list.append(item);
    }
    return details(label,list.childElementCount?list:element('p','ส่วนนี้ไม่มีตัวแปร'));
  }
  spec.append(fields('ตัวแปรทั้งเอกสาร',ctx.definition.globalSchema));
  for(const section of ctx.definition.sections){
    const group=element('div');
    group.append(element('p',section.sectionKey),fields('เนื้อหา',section.inputSchema));
    if(section.header&&Object.keys(section.header.inputSchema.fields).length)group.append(fields('หัวกระดาษ',section.header.inputSchema));
    if(section.footer&&Object.keys(section.footer.inputSchema.fields).length)group.append(fields('ท้ายกระดาษ',section.footer.inputSchema));
    spec.append(details(section.label,group));
  }

  const examplePane=element('section');examplePane.className='api-example';
  const sampleLabel=element('p'),assets=element('div'),pre=element('pre');
  const controls=element('div');controls.className='api-buttons';
  let example=fullApiExample(draftInputContract(ctx.definition));
  let updateCommand=()=>{};
  function fill(value:Example,label:string){
    example=value;sampleLabel.textContent=label;pre.textContent=json(example.payload);
    assets.replaceChildren();
    updateCommand();
    if(!example.images.length)return;
    assets.append(element('h4','ไฟล์ภาพที่ส่งพร้อมข้อมูล'),element('p','ใช้ชื่อช่องไฟล์ตามตำแหน่งด้านล่าง'));
    const files=element('ul');
    for(const [i,image] of example.images.entries()){
      const item=element('li');item.append(element('code',imagePart(image.path)));
      const name=imageName(i,image.file);
      if(image.file){
        const file=image.file;
        item.append(button('ดาวน์โหลด '+name,()=>download(name,file)));
      }else item.append(element('span','แนบรูปเป็น '+name+' หรือปรับชื่อในคำสั่ง'));
      files.append(item);
    }
    assets.append(files);
  }
  fill(example,'ตัวอย่างครบทุกตัวแปรจากฉบับที่บันทึก');
  if(ctx.trial)controls.append(button('ใช้ข้อมูลจาก Preview',()=>{
    try{fill(ctx.trial!(),'ข้อมูลที่กรอกใน Preview · Revision '+ctx.revision);notice.textContent='โหลดข้อมูลจาก Preview แล้ว';}
    catch(cause){notice.textContent=cause instanceof Error?cause.message:'อ่านข้อมูลจาก Preview ไม่สำเร็จ';}
  }));
  controls.append(button('ดาวน์โหลด payload.json',()=>download('payload.json',new Blob([json(example.payload)],{type:'application/json'}))),
    button('คัดลอก JSON',()=>copy(json(example.payload),'คัดลอก JSON แล้ว')));
  examplePane.append(element('h3','ชุดข้อมูลตัวอย่าง'),sampleLabel,controls,pre,assets);
  const body=element('div');body.className='api-body';
  const scope=element('section');scope.append(element('h3','ข้อมูลที่โครงรับ'),spec);
  body.append(scope,examplePane);
  const publishedPane=element('section');publishedPane.hidden=true;publishedPane.className='api-published';
  panel.replaceChildren(head,publishedPane,body);
  void fetch(ctx.publicationUrl,{signal}).then(async response=>{
    if(!response.ok)throw Error('Publication unavailable');
    const {value}=await response.json() as {value:Publication|null};
    if(signal.aborted)return;
    if(!value){status.textContent='ยังไม่เผยแพร่ · ใช้ข้อมูลด้านล่างเตรียมการเชื่อมระบบได้';return;}
    const matches=value.fingerprint===ctx.fingerprint;
    status.textContent='เผยแพร่แล้ว · เวอร์ชัน '+value.version+(matches?' · ตรงกับฉบับที่บันทึก':' · คนละฉบับกับโครงที่บันทึก');
    if(value.contract.assembly?.input==='array-by-section-key'){
      const full=fullApiExample(value.contract);
      const request=element('section');request.className='api-request';
      const base=element('input');
      base.type='url';base.placeholder='https://…';base.autocomplete='off';
      const baseLabel=element('label','Base URL ของ FlowDoc Service');baseLabel.className='api-base-url';baseLabel.append(base);
      const baseHelp=element('small','ใส่ Base URL เพื่อคัดลอกลิงก์เต็มไปใช้ใน New Request');
      baseHelp.id='flowdoc-service-url-help';base.setAttribute('aria-describedby',baseHelp.id);
      const collection=()=>json(postmanCollection(value.contract,full,serviceBaseUrl(base.value)));
      const address=element('div');address.className='api-request-address';
      const url=element('code',postmanDocumentUrl);
      const copyUrl=button('คัดลอก URL',()=>void copy(url.textContent??'','คัดลอก URL แล้ว · วางในช่อง URL ของ New Request'));
      copyUrl.disabled=true;
      base.addEventListener('input',()=>{
        const configured=serviceBaseUrl(base.value);
        url.textContent=configured?configured+'/documents':postmanDocumentUrl;
        copyUrl.disabled=!configured;
        const invalid=Boolean(base.value.trim()&&!configured);
        base.setAttribute('aria-invalid',String(invalid));
        baseHelp.textContent=invalid?'ใส่ Base URL ที่ขึ้นต้นด้วย http:// หรือ https:// โดยไม่ใส่ query หรือข้อมูลล็อกอิน':
          'ใส่ Base URL เพื่อคัดลอกลิงก์เต็มไปใช้ใน New Request';
      });
      address.append(element('strong','POST'),url,copyUrl);
      const actions=element('div');actions.className='api-buttons';
      const transfer=button('คัดลอกชุดสำหรับ Import',()=>void copy(collection(),'คัดลอกแล้ว · เปิด Import ใน Postman แล้ววางข้อความ'));
      transfer.className='primary';
      actions.append(transfer,notice);
      const payload=json(full.payload);
      const raw=element('pre',payload);
      raw.className='api-request-json';raw.tabIndex=0;raw.setAttribute('aria-label','JSON ของช่อง payload');
      const bodyHeading=element('div');bodyHeading.className='api-body-heading';
      bodyHeading.append(element('h3','Body · form-data'),button('คัดลอก Body JSON',()=>void copy(payload,'คัดลอก JSON แล้ว · วางในค่า payload ของ form-data')));
      request.append(baseLabel,baseHelp,address,actions,element('p','ใช้ Import เพื่อวางทั้งชุด หรือเลือก POST ใน New Request แล้ววาง URL และ Body แยกช่อง'),
        bodyHeading,element('p','payload · Text · application/json'),raw);
      if(full.images.length){
        const attachments=element('ul');attachments.className='api-attachments';
        for(const image of full.images){
          const row=element('li');
          row.append(element('code',imagePart(image.path)),element('span',postmanImage));
          attachments.append(row);
        }
        const image=element('a','ดาวน์โหลดรูปตัวอย่าง');
        image.href='/'+postmanImage;image.download=postmanImage;image.className='api-image-download';
        request.append(element('h4','รูปที่ส่งพร้อม Body'),attachments,image);
      }
      const fallback=button('ดาวน์โหลด Postman',()=>{
        const filename=value.contract.docKey+'.v'+value.version+'.postman_collection.json';
        download(filename,new Blob([collection()],{type:'application/json'}));
      });
      const headers=element('pre','Authorization: Bearer {{FLOWDOC_TOKEN}}\nDoc-Key: '+value.contract.docKey+
        '\nOutput-Format: pdf\nAccept: multipart/mixed');
      request.append(details('Headers',headers));
      publishedPane.append(request);
      const secondary=element('div');secondary.append(handoff,fallback,body);
      panel.append(details('ดาวน์โหลดไฟล์และดูข้อมูลจาก Preview',secondary));
    }
    const preview=element('pre');
    const command=()=>generateCommand(ctx.docKey,matches?example.images:[]);
    updateCommand=()=>{preview.textContent=command().join(' \\\n');};
    updateCommand();
    const advanced=element('div');
    advanced.append(element('h3','เรียกผ่าน Service · เวอร์ชัน '+value.version),
      element('p','ตั้งค่า FLOWDOC_BASE_URL และ FLOWDOC_TOKEN ที่เซิร์ฟเวอร์ผู้เรียก แล้วเตรียมไฟล์ตามสัญญาของฉบับเผยแพร่ หากมีภาพให้เพิ่มส่วนไฟล์ตามตำแหน่งที่ระบุ'),
      element('p','Service ใช้เวอร์ชันเผยแพร่ล่าสุดขณะรับงาน'+(matches?'':' · ใช้สัญญาด้านล่างเตรียมข้อมูลสำหรับเวอร์ชันที่เผยแพร่')),
      element('p','คำสั่งสำหรับ Bash'),
      button('คัดลอกคำสั่งเรียก API',()=>copy(command().map(line=>line.trimStart()).join(' '),'คัดลอกคำสั่งเรียก API แล้ว')),preview,
      details('สัญญาข้อมูลฉบับเผยแพร่',element('pre',json(value.contract))));
    publishedPane.append(details('คำสั่ง Bash และสัญญาข้อมูล',advanced));
    publishedPane.hidden=false;
  }).catch(()=>{if(!signal.aborted)status.textContent='ตรวจสถานะการเผยแพร่ไม่ได้ · แสดงข้อมูลจากฉบับที่บันทึก';});
}
