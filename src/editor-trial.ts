import {paperFieldNames} from './editor-paper-field-names';
import type {Definition,Field,Schema} from './editor-structure';
import {postmanImage,sampleTextValue} from './editor-postman';

type SampleData=Record<string,unknown>;
type Upload={id:string;bytes:string};
type Path=(string|number)[];
type ReadContext={files:Map<string,File>;fields:Map<string,HTMLTextAreaElement>;blanks:Path[];apiImages?:{path:Path;file?:File}[];requireImages?:boolean};
type Read=(context:ReadContext,path:Path)=>unknown;
type SampleFill={image:File;nextAnchor:()=>string;record:()=>void};
type Fill=(sample:SampleFill)=>void;
type Control={element:HTMLElement;read:Read;fill:Fill;fixedLabel?:string};
export type TrialFocus={key:string;occurrence:string;offset:number;pageIndex:number};
export type Trial={data:SampleData;sections:SampleData[];images:Upload[];blanks:Path[];pageIndex?:number;focus?:TrialFocus};
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
export function mountTrial(form:HTMLFormElement,definition:Definition,starter:ReadonlyMap<string,string>,changed:(structural:boolean,key?:string)=>void,render:(trial:Trial,current:()=>boolean,usable:()=>boolean,structure:number,fields:ReadContext['fields'])=>Promise<void>,locate:(key:string,label:string)=>void){
  const fieldName=paperFieldNames(definition);
  const error=node('p');error.className='trial-error';error.setAttribute('role','alert');
  let editVersion=0,structureVersion=0,bindings=new Map<string,HTMLTextAreaElement>(),running=false;
  let keys:WeakMap<HTMLTextAreaElement,string>|undefined;
  let timer:number|undefined,queued:(()=>TrialFocus|undefined)|undefined,disposed=false;
  const encoded=new WeakMap<File,Promise<string>>();
  const sampleImageId=crypto.randomUUID();
  let sampleFile:File|undefined;
  const invalidate=(structural=false,composing=false,key?:string)=>{
    editVersion++;error.textContent='';
    for(const output of form.querySelectorAll<HTMLOutputElement>('output[data-formula-result]'))output.value='—';
    if(structural){structureVersion++;bindings.clear();keys=undefined;}
    changed(structural,key);
    if(composing){queued=undefined;window.clearTimeout(timer);timer=undefined;}
    else{queued=()=>undefined;schedule();}
  };
  function collection(parent:HTMLElement,addLabel:string,make:(seed?:string)=>Control,seeds:readonly string[],canAdd:boolean,fillEmpty:boolean,max=200){
    const rows=node('div');rows.className='trial-rows';
    const entries=new Map<Element,Control>();
    const add=button(addLabel,()=>addRow(true));
    function addRow(user:boolean,seed?:string){
      if(rows.childElementCount>=max)return;
      const entry=make(seed);
      const panel=node('details');panel.open=true;
      if(entry.fixedLabel)panel.dataset.fixedLabel=entry.fixedLabel;
      const controls=node('div');controls.className='trial-list-controls';
      function move(up:boolean){
        const adjacent=up?panel.previousElementSibling:panel.nextElementSibling;
        if(adjacent){rows.insertBefore(up?panel:adjacent,up?adjacent:panel);renumber();invalidate(true);}
      }
      const remove=button('ลบรายการ',()=>{entries.delete(panel);panel.remove();renumber();invalidate(true);});
      controls.append(button('เลื่อนขึ้น',()=>move(true)),button('เลื่อนลง',()=>move(false)),remove);
      panel.append(node('summary'),entry.element);
      if(!entry.fixedLabel)panel.append(controls);
      panel.addEventListener('change',renumber);
      entries.set(panel,entry);rows.append(panel);renumber();
      if(user){invalidate(true);panel.querySelector('summary')?.focus();}
    }
    function renumber(){
      [...rows.children].forEach((panel,index)=>{
        const format=panel.querySelector<HTMLSelectElement>(':scope > div > label > select[data-format]');
        panel.querySelector('summary')!.textContent=(panel as HTMLElement).dataset.fixedLabel??('รายการ '+(index+1)+(format?' · '+format.selectedOptions[0]?.textContent:''));
        const buttons=panel.querySelectorAll<HTMLButtonElement>(':scope > .trial-list-controls > button');
        if(buttons.length){buttons[0].disabled=index===0;buttons[1].disabled=index===rows.childElementCount-1;}
      });
      add.disabled=rows.childElementCount>=max;
    }
    parent.append(rows);
    if(canAdd)parent.append(add);
    for(const seed of seeds)addRow(false,seed);
    return {
      read:(context:ReadContext,path:Path)=>[...rows.children].map((panel,index)=>entries.get(panel)!.read(context,[...path,index])),
      fill(sample:SampleFill){
        if(fillEmpty&&canAdd&&!rows.childElementCount){addRow(false);sample.record();}
        for(const panel of rows.children)entries.get(panel)!.fill(sample);
      },
    };
  }
  function fields(schema:Schema,sectionLabel='',headingLevel?:string){
    const element=node('div');element.className='trial-fields';
    const controls=new Map<string,Control>();
    const computedInputs=new Map<string,'quantity'|'unit'>();
    for(const field of Object.values(schema.fields)){
      if(!field.computed)continue;
      computedInputs.set(field.computed.inputs.quantity,'quantity');
      computedInputs.set(field.computed.inputs.unit,'unit');
    }
    for(const [key,field] of Object.entries(schema.fields)){
      const result=fieldControl(key,field,fieldName(schema,key),sectionLabel,headingLevel,computedInputs.get(key));
      if(!['area','array'].includes(field.type)){
        result.element.dataset.fieldName=fieldName(schema,key);
        result.element.title=key;
        for(const input of result.element.querySelectorAll<HTMLElement>('input,textarea,select'))input.dataset.variableKey=key;
      }
      element.append(result.element);controls.set(key,result);
    }
    if(!controls.size)element.append(node('p','ส่วนนี้ไม่มีตัวแปร'));
    return {element,fill(sample:SampleFill){
      for(const control of controls.values())control.fill(sample);
    },read(context:ReadContext,path:Path){
      const data:SampleData=Object.create(null);
      for(const [key,control] of controls){
        const at=[...path,key];
        if(control.element.dataset.fieldName)control.element.dataset.formKey=JSON.stringify(at);
        const value=control.read(context,at);
        if(value!==undefined)data[key]=value;
      }
      return data;
    }};
  }
  function fieldControl(key:string,field:Field,name:string,sectionLabel:string,headingLevel?:string,computedInput?:'quantity'|'unit'):Control{
    const label=name+(field.required?' (ต้องระบุ)':'');
    if(field.formula&&!field.formula.lookup){
      const output=node('output','—');output.dataset.formulaResult=key;
      return {element:labeled(name+' · ผลรวม',output),fill(){},read(){return undefined;}};
    }
    if(field.computed||field.formula){
      return {element:node('p',label+' · คำนวณอัตโนมัติ'),fill(){},read(){return undefined;}};
    }
    if(field.type==='number'){
      const input=node('input');input.type='number';input.step='any';
      return {element:labeled(label,input),fill(sample){
        if(!input.value){input.value='1';sample.record();}
      },read(context){
        if(input.validity.badInput)throw Error('กรอกตัวเลขสำหรับ '+label);
        if(!input.value&&field.required&&field.default===undefined){
          if(context.requireImages)throw Error('กรอกตัวเลขสำหรับ '+label+' ก่อนดาวน์โหลด');
          return context.apiImages?undefined:0;
        }
        if(!input.value)return undefined;
        return input.valueAsNumber;
      }};
    }
    if(field.type==='array'||field.type==='area'){
      const panel=node('fieldset');panel.append(node('legend',(field.type==='area'?'พื้นที่ ': '')+label));
      const formats=field.type==='area'?Object.values(definition.areaFormats??{}).filter(format=>format.ownerAreaId===field.areaId):[];
      const derived=formats.filter(format=>Object.values(format.fragment.nodes).some(node=>node.type==='table-of-contents'));
      const manual=formats.filter(format=>!derived.includes(format));
      const list=collection(panel,field.type==='area'?'+ เพิ่ม Format ในพื้นที่':'+ เพิ่มรายการ',seed=>{
        if(field.type==='array')return fields(field.items??{fields:{}},sectionLabel);
        const automatic=derived.find(format=>format.key===seed);
        if(automatic){
          const input=fields(automatic.inputSchema,sectionLabel),body=node('div');
          body.append(node('p','Engine สร้างจากหัวข้อที่ตั้งให้แสดงในสารบัญ และเติมเลขหน้าตามผลจัดหน้า'));
          if(Object.keys(automatic.inputSchema.fields).length)body.append(input.element);
          return {element:body,fixedLabel:'สารบัญอัตโนมัติ · '+(automatic.label??automatic.key),
            fill:input.fill,
            read:(context,path)=>({format:automatic.key,data:input.read(context,[...path,'data'])})};
        }
        const body=node('div'),select=node('select'),slot=node('div');
        select.dataset.format='';
        for(const format of manual){
          const option=node('option',format.label??format.key);option.value=format.key;select.append(option);
        }
        let active:ReturnType<typeof fields>|undefined;
        function show(){
          const format=formats.find(option=>option.key===select.value);
          active=format?fields(format.inputSchema,sectionLabel,/^heading([1-6])$/i.exec(format.key)?.[1]):undefined;
          slot.replaceChildren(active?.element??node('p','พื้นที่นี้ยังไม่มี Format'));
        }
        const preferred=seed||(field.areaId&&starter.get(field.areaId));
        if(preferred&&manual.some(format=>format.key===preferred))select.value=preferred;
        select.addEventListener('change',show);show();
        body.append(labeled('Format',select),slot);
        return {element:body,fill:sample=>active?.fill(sample),read(context,path){
          if(!active)throw Error('เลือก Format สำหรับ '+key);
          return {format:select.value,data:active.read(context,[...path,'data'])};
        }};
      },field.type==='array'?['']:formats.map(format=>format.key),field.type==='array'||manual.length>0,
        field.type==='array'||field.required===true);
      return {element:panel,fill:list.fill,read(context,path){
        const entries=list.read(context,path);
        return entries.length||field.required?entries:undefined;
      }};
    }
    if(field.type==='image'){
      const input=node('input');input.type='file';input.accept='image/png,image/jpeg';
      let id=crypto.randomUUID();
      let isSample=false;
      input.addEventListener('change',()=>{isSample=false;id=crypto.randomUUID();});
      return {element:labeled(label+' · PNG หรือ JPEG',input),fill(sample){
        if(input.files?.length)return;
        const transfer=new DataTransfer();
        transfer.items.add(sample.image);
        input.files=transfer.files;
        isSample=true;
        sample.record();
      },read(context,path){
        const file=input.files?.[0];
        if(context.apiImages){
          if(!file&&!field.required)return undefined;
          context.apiImages.push({path,file});
          return {image:{upload:true}};
        }
        if(!file&&field.required&&context.requireImages)throw Error('เลือกไฟล์รูปสำหรับ '+label+' ก่อนดาวน์โหลด');
        if(!file)return field.required?id:undefined;
        if(file.size>maxImageBytes)throw Error('รูป '+key+' ต้องมีขนาดไม่เกิน 1 MB');
        const assetId=isSample?sampleImageId:id;
        context.files.set(assetId,isSample?sampleFile!:file);return assetId;
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
      return {element:panel,fill(sample){
        if(type.value==='reference')return;
        if(!value.value.trim()){value.value='https://example.com';sample.record();}
        if(type.value==='link'&&!caption.value.trim()){caption.value='ลิงก์ตัวอย่าง';sample.record();}
      },read(){
        const target=value.value.trim();
        if(!target&&!field.required)return undefined;
        if(!target||type.value!=='url'&&!caption.value.trim())throw Error('กรอกลิงก์ให้ครบสำหรับ '+key);
        if(type.value==='url')return {type:'url',value:target};
        return {type:type.value,text:caption.value,[type.value==='link'?'url':'target']:target};
      }};
    }
    const input=node('textarea');
    input.rows=/Number$|Date$|^(documentVersion|author|projectName|telephone|fax)$/.test(key)?1:2;
    if(key==='anchor')input.dataset.trialAnchor='';
    return {element:labeled(label,input),fill(sample){
      if(input.value.trim())return;
      input.value=computedInput==='quantity'?'1':key==='anchor'?sample.nextAnchor():sampleTextValue(key,field,sectionLabel,headingLevel);
      sample.record();
    },read(context,path){
      context.fields.set(JSON.stringify(path),input);
      if(!input.value&&!computedInput)context.blanks.push(path);
      return input.value;
    }};
  }
  const global=fields(definition.globalSchema);
  const sections=definition.sections.map((section,index)=>{
    const label=section.label||section.sectionKey;
    const data=fields(section.inputSchema,label),header=section.header&&fields(section.header.inputSchema,label),
      footer=section.footer&&fields(section.footer.inputSchema,label);
    const wrapper=node('div');wrapper.append(data.element);
    if(header&&Object.keys(section.header!.inputSchema.fields).length)wrapper.append(details('ตัวแปรหัวกระดาษ',header.element));
    if(footer&&Object.keys(section.footer!.inputSchema.fields).length)wrapper.append(details('ตัวแปรท้ายกระดาษ',footer.element));
    return {element:details('Section '+(index+1)+' · '+section.label,wrapper,true),fill(sample:SampleFill){
      data.fill(sample);header?.fill(sample);footer?.fill(sample);
    },read(context:ReadContext,path:Path){
      return {sectionKey:section.sectionKey,instanceKey:'preview-'+(index+1),data:data.read(context,[...path,'data']),
        ...(header?{header:header.read(context,[...path,'header'])}:{}),...(footer?{footer:footer.read(context,[...path,'footer'])}:{})};
    }};
  });
  function readValues(context:ReadContext){
    return {data:global.read(context,['data']),sections:sections.map((section,i)=>section.read(context,['sections',i]))};
  }
  const fieldsPanel=node('div');fieldsPanel.className='trial-input-scroll';
  const sampleStatus=node('p','เติมเฉพาะช่องว่าง');
  sampleStatus.className='trial-sample-status';
  sampleStatus.setAttribute('role','status');
  const sampleButton=button('เติมข้อมูลตัวอย่าง',()=>void fillSample());
  async function fillSample(){
    sampleButton.disabled=true;
    sampleStatus.textContent='กำลังเตรียมข้อมูลตัวอย่าง…';
    try{
      if(!sampleFile){
        const response=await fetch('/'+postmanImage);
        if(!response.ok)throw Error('เปิดรูปตัวอย่างไม่สำเร็จ ลองใหม่อีกครั้ง');
        sampleFile=new File([await response.blob()],postmanImage,{type:'image/png'});
      }
      if(disposed)return;
      const used=new Set([...form.querySelectorAll<HTMLTextAreaElement>('[data-trial-anchor]')].map(input=>input.value.trim()));
      let serial=0,filled=0;
      const sample:SampleFill={image:sampleFile,record:()=>{filled++;},nextAnchor(){
        let anchor;
        do{anchor='sample-heading-'+(++serial);}while(used.has(anchor));
        used.add(anchor);
        return anchor;
      }};
      global.fill(sample);
      for(const section of sections)section.fill(sample);
      if(filled)invalidate(true);
      sampleStatus.textContent=filled?'เติมข้อมูลตัวอย่างแล้ว':'ช่องที่เติมตัวอย่างได้มีข้อมูลครบแล้ว';
    }catch(cause){sampleStatus.textContent=cause instanceof Error?cause.message:'เติมข้อมูลตัวอย่างไม่สำเร็จ';}
    finally{sampleButton.disabled=false;}
  }
  async function snapshot(requireImages=false){
    const context:ReadContext={files:new Map(),fields:new Map(),blanks:[],requireImages};
    const values=readValues(context);
    const files=[...context.files];
    if(files.reduce((total,[,file])=>total+file.size,0)>maxImagesBytes)
      throw Error('รูปทั้งหมดต้องมีขนาดรวมไม่เกิน 2 MB');
    const images=await Promise.all(files.map(async ([id,file])=>{
      let bytes=encoded.get(file);
      if(!bytes){bytes=fileBytes(file);encoded.set(file,bytes);}
      return {id,bytes:await bytes};
    }));
    return {trial:{...values,images,blanks:context.blanks},fields:context.fields};
  }
  fieldsPanel.append(details('ตัวแปรทั้งเอกสาร',global.element,true),...sections.map(section=>section.element));
  const sampleControls=node('div');
  sampleControls.className='trial-sample-controls';
  sampleControls.append(sampleButton,sampleStatus);
  form.replaceChildren(sampleControls,fieldsPanel,error);
  const finishComposition=(event:CompositionEvent)=>{
    if(event.target instanceof HTMLTextAreaElement)invalidate(false,false,keys?.get(event.target));
  };
  form.addEventListener('compositionend',finishComposition);
  form.oninput=event=>{
    const input=event.target;
    if(input instanceof HTMLSelectElement||input instanceof HTMLInputElement&&input.type==='file')return;
    invalidate(false,(event as InputEvent).isComposing,input instanceof HTMLTextAreaElement?keys?.get(input):undefined);
  };
  form.onchange=event=>{
    if(event.target instanceof HTMLSelectElement||event.target instanceof HTMLInputElement&&event.target.type==='file')
      invalidate(event.target instanceof HTMLSelectElement&&event.target.hasAttribute('data-format'));
  };
  function schedule(delay=80){
    if(disposed||running||timer!==undefined||!queued)return;
    timer=window.setTimeout(()=>{
      timer=undefined;
      const focus=queued;queued=undefined;
      if(focus)void send(focus());
    },delay);
  }
  async function send(focus?:TrialFocus){
    if(disposed||running)return;
    running=true;error.textContent='';
    const version=editVersion,structure=structureVersion;
    const current=()=>version===editVersion;
    const usable=()=>!disposed&&structure===structureVersion;
    try{
      const sample=await snapshot();
      if(usable()){
        bindings=sample.fields;
        if(!keys){
          keys=new WeakMap();
          for(const [key,input] of bindings)keys.set(input,key);
        }
        await render({...sample.trial,focus},current,usable,structure,sample.fields);
      }
    }catch(cause){
      if(current())error.textContent=cause instanceof Error?cause.message:'จัดหน้าทดลองไม่สำเร็จ';
    }finally{running=false;schedule(0);}
  }
  let selectedField:HTMLElement|undefined;
  function selectField(field:HTMLElement){
    if(selectedField!==field){
      selectedField?.classList.remove('linked-field');
      field.classList.add('linked-field');selectedField=field;
    }
  }
  const locateControl=(event:Event)=>{
    const field=(event.target as Element)?.closest<HTMLElement>('[data-form-key]');
    if(field?.dataset.formKey&&field.dataset.fieldName){
      selectField(field);locate(field.dataset.formKey,field.dataset.fieldName);
    }
  };
  form.addEventListener('focusin',locateControl);
  form.addEventListener('click',locateControl);
  form.onsubmit=event=>event.preventDefault();
  const refresh=()=>{queued=()=>undefined;schedule();};
  queueMicrotask(()=>{if(!running&&!disposed)void send();});
  return {
    refresh,
    setFormulaResults(results:{instanceKey:string;values:Record<string,number>}[]){
      const values=new Map(results.map(r=>[r.instanceKey,r.values]));
      sections.forEach((section,i)=>{
        for(const output of section.element.querySelectorAll<HTMLOutputElement>('output[data-formula-result]')){
          output.value=String(values.get('preview-'+(i+1))?.[output.dataset.formulaResult!]??'—');
        }
      });
    },
    async exportSnapshot(){const {trial}=await snapshot(true);return {data:trial.data,sections:trial.sections,images:trial.images};},
    apiExample(){
      const apiImages:NonNullable<ReadContext['apiImages']>=[];
      const payload=readValues({files:new Map(),fields:new Map(),blanks:[],apiImages});
      return {payload,images:apiImages};
    },
    read(key:string){return bindings.get(key)?.value;},
    reveal(key:string){
      const field=bindings.get(key);
      if(!field||!form.contains(field))return;
      for(let panel=field.closest('details');panel;panel=panel.parentElement?.closest('details')??null)panel.open=true;
      const viewport=fieldsPanel.getBoundingClientRect(),target=field.getBoundingClientRect();
      if(target.top<viewport.top||target.bottom>viewport.bottom)fieldsPanel.scrollTop+=target.top-viewport.top-24;
      const row=field.closest<HTMLElement>('[data-form-key]');
      if(row){selectField(row);return row.dataset.fieldName;}
    },
    write(key:string,value:string,focus:()=>TrialFocus,composing:boolean){
      const input=bindings.get(key);
      if(!input||!form.contains(input))return;
      input.value=value;
      editVersion++;
      if(composing){queued=undefined;window.clearTimeout(timer);timer=undefined;}
      else{queued=focus;schedule();}
    },
    dispose(){form.removeEventListener('focusin',locateControl);form.removeEventListener('click',locateControl);disposed=true;editVersion++;queued=undefined;window.clearTimeout(timer);form.removeEventListener('compositionend',finishComposition);},
  };
}
