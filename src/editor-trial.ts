import type {Definition,Field,Schema} from './editor-structure';

type SampleData=Record<string,unknown>;
type Upload={id:string;bytes:string};
type Path=(string|number)[];
type ReadContext={files:Map<string,File>;fields:Map<string,HTMLTextAreaElement>};
type Read=(context:ReadContext,path:Path)=>unknown;
export type TrialFocus={key:string;offset:number;pageIndex:number};
export type Trial={data:SampleData;sections:SampleData[];images:Upload[];focus?:TrialFocus};
const maxImageBytes=1024*1024;
const maxImagesBytes=2*1024*1024;
const node=<K extends keyof HTMLElementTagNameMap>(tag:K,label?:string)=>{
  const result=document.createElement(tag);
  if(label!==undefined)result.textContent=label;
  return result;
};
function button(label:string,run:()=>void){
  const control=node('button',label);control.type='button';control.onclick=run;return control;
}
function labeled(label:string,control:HTMLElement){
  const wrapper=node('label',label);wrapper.append(control);return wrapper;
}
function details(label:string,content:HTMLElement,open=false){
  const panel=node('details');panel.open=open;panel.append(node('summary',label),content);return panel;
}
async function fileBytes(file:File){
  const bytes=new Uint8Array(await file.arrayBuffer());
  let binary='';
  for(let i=0;i<bytes.length;i+=16384)binary+=String.fromCharCode(...bytes.subarray(i,i+16384));
  return btoa(binary);
}
export function mountTrial(form:HTMLFormElement,definition:Definition,changed:()=>void,render:(trial:Trial,current:()=>boolean)=>Promise<void>){
  const error=node('p');error.className='trial-error';error.setAttribute('role','alert');
  const submit=node('button','จัดหน้าจากข้อมูลนี้');submit.type='submit';submit.className='primary';
  let editVersion=0,bindings=new Map<string,HTMLTextAreaElement>(),running=false;
  let timer:number|undefined,queued:(()=>TrialFocus)|undefined;
  const encoded=new WeakMap<File,Promise<string>>();
  const invalidate=()=>{
    editVersion++;error.textContent='';bindings.clear();queued=undefined;
    window.clearTimeout(timer);timer=undefined;changed();
  };
  function collection(parent:HTMLElement,addLabel:string,make:()=>{element:HTMLElement;read:Read},max=200){
    const rows=node('div');rows.className='trial-rows';
    const entries=new Map<HTMLElement,Read>();
    const add=button(addLabel,()=>{
      if(rows.childElementCount>=max)return;
      const entry=make();
      const panel=node('details');panel.open=true;
      const controls=node('div');controls.className='trial-list-controls';
      function move(up:boolean){
        const adjacent=up?panel.previousElementSibling:panel.nextElementSibling;
        if(adjacent){rows.insertBefore(up?panel:adjacent,up?adjacent:panel);renumber();invalidate();}
      }
      const remove=button('ลบรายการ',()=>{entries.delete(panel);panel.remove();renumber();invalidate();});
      controls.append(button('เลื่อนขึ้น',()=>move(true)),button('เลื่อนลง',()=>move(false)),remove);
      panel.append(node('summary'),entry.element,controls);
      panel.addEventListener('change',renumber);
      entries.set(panel,entry.read);rows.append(panel);renumber();invalidate();
      panel.querySelector('summary')?.focus();
    });
    function renumber(){
      [...rows.children].forEach((panel,index)=>{
        const format=panel.querySelector<HTMLSelectElement>(':scope > div > label > select[data-format]');
        panel.querySelector('summary')!.textContent='รายการ '+(index+1)+(format?' · '+format.selectedOptions[0]?.textContent:'');
        const buttons=panel.querySelectorAll<HTMLButtonElement>(':scope > .trial-list-controls > button');
        buttons[0].disabled=index===0;buttons[1].disabled=index===rows.childElementCount-1;
      });
      add.disabled=rows.childElementCount>=max;
    }
    parent.append(rows,add);
    return (context:ReadContext,path:Path)=>[...rows.children].map((panel,index)=>entries.get(panel as HTMLElement)!(context,[...path,index]));
  }
  function fields(schema:Schema){
    const element=node('div');element.className='trial-fields';
    const reads=new Map<string,Read>();
    for(const [key,field] of Object.entries(schema.fields)){
      const result=fieldControl(key,field);
      element.append(result.element);reads.set(key,result.read);
    }
    if(!reads.size)element.append(node('p','ส่วนนี้ไม่มีตัวแปร'));
    return {element,read(context:ReadContext,path:Path){
      const data:SampleData=Object.create(null);
      for(const [key,read] of reads){const value=read(context,[...path,key]);if(value!==undefined)data[key]=value;}
      return data;
    }};
  }
  function fieldControl(key:string,field:Field):{element:HTMLElement;read:Read}{
    const label=(field.label||key)+(field.required?' (ต้องระบุ)':'');
    if(field.type==='array'||field.type==='area'){
      const panel=node('fieldset');panel.append(node('legend',(field.type==='area'?'พื้นที่ ': '')+label));
      const read=collection(panel,field.type==='area'?'+ เพิ่ม Format ในพื้นที่':'+ เพิ่มรายการ',()=>{
        if(field.type==='array')return fields(field.items??{fields:{}});
        const body=node('div'),select=node('select'),slot=node('div');
        select.dataset.format='';
        const formats=Object.values(definition.areaFormats??{}).filter(format=>format.ownerAreaId===field.areaId);
        for(const format of formats){
          const option=node('option',format.label??format.key);option.value=format.key;select.append(option);
        }
        let active:ReturnType<typeof fields>|undefined;
        function show(){
          const format=formats.find(option=>option.key===select.value);
          active=format?fields(format.inputSchema):undefined;
          slot.replaceChildren(active?.element??node('p','พื้นที่นี้ยังไม่มี Format'));
        }
        select.addEventListener('change',show);show();
        body.append(labeled('Format',select),slot);
        return {element:body,read(context,path){
          if(!active)throw Error('เลือก Format สำหรับ '+key);
          return {format:select.value,data:active.read(context,[...path,'data'])};
        }};
      });
      return {element:panel,read(context,path){
        const entries=read(context,path);
        return entries.length||field.required?entries:undefined;
      }};
    }
    if(field.type==='image'){
      const input=node('input');input.type='file';input.accept='image/png,image/jpeg';
      const id=crypto.randomUUID();
      return {element:labeled(label+' · PNG หรือ JPEG',input),read(context){
        const file=input.files?.[0];
        if(!file){if(field.required)throw Error('เลือกรูปสำหรับ '+key);return undefined;}
        if(file.size>maxImageBytes)throw Error('รูป '+key+' ต้องมีขนาดไม่เกิน 1 MB');
        context.files.set(id,file);return id;
      }};
    }
    if(field.type==='link'){
      const panel=node('fieldset'),type=node('select'),value=node('input'),caption=node('input');
      for(const [key,name] of [['url','URL'],['link','ลิงก์พร้อมข้อความ'],['reference','จุดอ้างอิงในเอกสาร']]){
        const option=node('option',name);option.value=key;type.append(option);
      }
      const text=labeled('ข้อความลิงก์',caption);
      const destination=labeled('ปลายทาง',value);
      type.onchange=()=>{text.hidden=type.value==='url';};
      text.hidden=true;
      panel.append(node('legend',label),labeled('ชนิดลิงก์',type),destination,text);
      return {element:panel,read(){
        const target=value.value.trim();
        if(!target&&!field.required)return undefined;
        if(!target||type.value!=='url'&&!caption.value.trim())throw Error('กรอกลิงก์ให้ครบสำหรับ '+key);
        if(type.value==='url')return {type:'url',value:target};
        return {type:type.value,text:caption.value,[type.value==='link'?'url':'target']:target};
      }};
    }
    const input=node('textarea');input.rows=2;
    return {element:labeled(label,input),read(context,path){
      context.fields.set(JSON.stringify(path),input);
      if(!input.value&&field.required&&!field.allowEmpty)throw Error('กรอกตัวแปร '+key);
      return input.value||field.required?input.value:undefined;
    }};
  }
  const global=fields(definition.globalSchema);
  const sections=definition.sections.map((section,index)=>{
    const data=fields(section.inputSchema),header=section.header&&fields(section.header.inputSchema),
      footer=section.footer&&fields(section.footer.inputSchema);
    const wrapper=node('div');wrapper.append(data.element);
    if(header&&Object.keys(section.header!.inputSchema.fields).length)wrapper.append(details('ตัวแปรหัวกระดาษ',header.element));
    if(footer&&Object.keys(section.footer!.inputSchema.fields).length)wrapper.append(details('ตัวแปรท้ายกระดาษ',footer.element));
    return {element:details(section.label,wrapper,index===0),read(context:ReadContext,path:Path){
      return {sectionKey:section.sectionKey,instanceKey:'preview-'+(index+1),data:data.read(context,[...path,'data']),
        ...(header?{header:header.read(context,[...path,'header'])}:{}),...(footer?{footer:footer.read(context,[...path,'footer'])}:{})};
    }};
  });
  const fieldsPanel=node('div');fieldsPanel.className='trial-input-scroll';
  fieldsPanel.append(details('ตัวแปรทั้งเอกสาร',global.element,true),...sections.map(section=>section.element));
  form.replaceChildren(fieldsPanel,error,submit);
  form.oninput=invalidate;
  form.onchange=invalidate;
  function schedule(){
    if(running||timer!==undefined||!queued)return;
    timer=window.setTimeout(()=>{
      timer=undefined;
      const focus=queued;queued=undefined;
      if(focus)void send(focus());
    },180);
  }
  async function send(focus?:TrialFocus){
    if(running)return;
    running=true;submit.disabled=true;error.textContent='';
    const version=editVersion;
    const current=()=>version===editVersion;
    try{
      const context:ReadContext={files:new Map(),fields:new Map()};
      const data=global.read(context,['data']),values=sections.map((section,i)=>section.read(context,['sections',i]));
      const files=[...context.files];
      if(files.reduce((total,[,file])=>total+file.size,0)>maxImagesBytes)
        throw Error('รูปทั้งหมดต้องมีขนาดรวมไม่เกิน 2 MB');
      const images=await Promise.all(files.map(async ([id,file])=>{
        let bytes=encoded.get(file);
        if(!bytes){bytes=fileBytes(file);encoded.set(file,bytes);}
        return {id,bytes:await bytes};
      }));
      if(current()){bindings=context.fields;await render({data,sections:values,images,focus},current);}
    }catch(cause){
      if(current())error.textContent=cause instanceof Error?cause.message:'จัดหน้าทดลองไม่สำเร็จ';
    }finally{running=false;submit.disabled=false;schedule();}
  }
  form.onsubmit=event=>{event.preventDefault();void send();};
  return {
    read(key:string){return bindings.get(key)?.value;},
    write(key:string,value:string,focus:()=>TrialFocus,composing:boolean){
      const input=bindings.get(key);
      if(!input||!form.contains(input))return;
      input.value=value;
      editVersion++;
      if(composing){queued=undefined;window.clearTimeout(timer);timer=undefined;}
      else{queued=focus;schedule();}
    },
    dispose(){editVersion++;queued=undefined;window.clearTimeout(timer);},
  };
}
