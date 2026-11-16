import type {Definition, Schema} from './editor-structure';

type Path=(string|number)[];
type Example={payload:object;images:{path:Path;file?:File}[]};
type Publication={version:number;fingerprint:string;contract:{examples?:unknown[]}};
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
const pointer=(path:Path)=>'/'+path.map(value=>String(value).replaceAll('~','~0').replaceAll('/','~1')).join('/');
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
const shellLiteral=(value:string)=>"'"+value.replaceAll("'","'\\''")+"'";
function generateCommand(docKey:string,images:Example['images']){
  const command=[
    'curl --request POST "${FLOWDOC_BASE_URL}/documents"',
    '  --header "Authorization: Bearer ${FLOWDOC_TOKEN}"',
    '  --header '+shellLiteral('Doc-Key: '+docKey),
    '  --header "Output-Format: pdf"',
    '  --header "Accept: multipart/mixed"',
    '  --form "payload=@payload.json;type=application/json"',
    ...images.map((image,i)=>'  --form '+shellLiteral(pointer(image.path)+'=@'+imageName(i,image.file))),
    '  --output response.multipart',
  ];
  return command.join(' \\\n');
}
function schemaExample(definition:Definition):Example{
  const images:Example['images']=[];
  function values(schema:Schema,path:Path):object{
    return Object.fromEntries(Object.entries(schema.fields).flatMap<[string,unknown]>(([key,field])=>{
      const at=[...path,key];
      if(field.type==='image'){
        if(!field.required)return [];
        images.push({path:at});return [[key,{image:{upload:true}}]];
      }
      if(field.type==='link')return [[key,{type:'url',value:'https://example.com'}]];
      if(field.type==='array')return [[key,field.items?[values(field.items,[...at,0])]:[]]];
      if(field.type==='area'){
        const format=Object.values(definition.areaFormats??{}).find(format=>format.ownerAreaId===field.areaId);
        return [[key,format?[{format:format.key,data:values(format.inputSchema,[...at,0,'data'])}]:[]]];
      }
      return [[key,typeof field.default==='string'?field.default:'ตัวอย่าง '+key]];
    }));
  }
  const data=values(definition.globalSchema,['data']);
  const sections=definition.sections.map((section,i)=>({
    sectionKey:section.sectionKey,instanceKey:'example-'+(i+1),data:values(section.inputSchema,['sections',i,'data']),
    ...(section.header?{header:values(section.header.inputSchema,['sections',i,'header'])}:{}),
    ...(section.footer?{footer:values(section.footer.inputSchema,['sections',i,'footer'])}:{}),
  }));
  return {payload:{data,sections},images};
}

export function showApi(panel:HTMLElement,ctx:ApiContext,signal:AbortSignal){
  const status=element('p','กำลังตรวจสถานะการเผยแพร่…');
  status.setAttribute('role','status');
  const notice=element('p');notice.setAttribute('role','status');notice.className='api-notice';
  const copy=(value:string,message:string)=>void navigator.clipboard.writeText(value)
    .then(()=>{notice.textContent=message;})
    .catch(()=>{notice.textContent='คัดลอกอัตโนมัติไม่ได้ เลือกข้อความหรือดาวน์โหลดไฟล์ได้ครับ';});
  const head=element('div');head.className='api-heading';
  const identity=element('p');identity.append(element('code',ctx.docKey),element('span','ฉบับที่บันทึก · Revision '+ctx.revision));
  head.append(element('h2','นำโครงไปใช้ผ่าน API'),identity,status,
    button('คัดลอก docKey',()=>copy(ctx.docKey,'คัดลอก docKey แล้ว')));
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
  let example=schemaExample(ctx.definition);
  let updateCommand=()=>{};
  function fill(value:Example,label:string){
    example=value;sampleLabel.textContent=label;pre.textContent=json(example.payload);
    assets.replaceChildren();
    updateCommand();
    if(!example.images.length)return;
    assets.append(element('h4','ไฟล์ภาพที่ส่งพร้อมข้อมูล'),element('p','ใช้ชื่อช่องไฟล์ตามตำแหน่งด้านล่าง'));
    const files=element('ul');
    for(const [i,image] of example.images.entries()){
      const item=element('li');item.append(element('code',pointer(image.path)));
      const name=imageName(i,image.file);
      if(image.file){
        const file=image.file;
        item.append(button('ดาวน์โหลด '+name,()=>download(name,file)));
      }else item.append(element('span','แนบรูปเป็น '+name+' หรือปรับชื่อในคำสั่ง'));
      files.append(item);
    }
    assets.append(files);
  }
  fill(example,'ตัวอย่างจากนิยามโครง · แทนค่าตัวอย่างก่อนส่ง');
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
  panel.replaceChildren(head,body,publishedPane,notice);
  void fetch(ctx.publicationUrl,{signal}).then(async response=>{
    if(!response.ok)throw Error('Publication unavailable');
    const {value}=await response.json() as {value:Publication|null};
    if(signal.aborted)return;
    if(!value){status.textContent='ยังไม่เผยแพร่ · ใช้ข้อมูลด้านล่างเตรียมการเชื่อมระบบได้';return;}
    const matches=value.fingerprint===ctx.fingerprint;
    status.textContent='เผยแพร่แล้ว · เวอร์ชัน '+value.version+(matches?' · ตรงกับฉบับที่บันทึก':' · คนละฉบับกับโครงที่บันทึก');
    const preview=element('pre');
    updateCommand=()=>{preview.textContent=generateCommand(ctx.docKey,matches?example.images:[]);};
    updateCommand();
    publishedPane.append(element('h3','เรียกผ่าน Service · เวอร์ชัน '+value.version),
      element('p','ตั้งค่า FLOWDOC_BASE_URL และ FLOWDOC_TOKEN ที่เซิร์ฟเวอร์ผู้เรียก แล้วเตรียมไฟล์ตามสัญญาของฉบับเผยแพร่ หากมีภาพให้เพิ่มส่วนไฟล์ตามตำแหน่งที่ระบุ'),
      element('p','Service ใช้เวอร์ชันเผยแพร่ล่าสุดขณะรับงาน'+(matches?'':' · ใช้สัญญาด้านล่างเตรียมข้อมูลสำหรับเวอร์ชันที่เผยแพร่')),
      element('p','คำสั่งสำหรับ Bash'),
      button('คัดลอกคำสั่งเรียก API',()=>copy(preview.textContent??'','คัดลอกคำสั่งเรียก API แล้ว')),preview,
      details('สัญญาข้อมูลฉบับเผยแพร่',element('pre',json(value.contract))));
    publishedPane.hidden=false;
  }).catch(()=>{if(!signal.aborted)status.textContent='ตรวจสถานะการเผยแพร่ไม่ได้ · แสดงข้อมูลจากฉบับที่บันทึก';});
}
