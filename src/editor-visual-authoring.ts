import type {Host,Schema} from './editor-structure';

type RecordValue = Record<string, unknown>;
type Form =
  | {kind:'text'|'number'|'boolean'; initial?:unknown; choices?:string[]; catalog?:string; variableTypes?:string[]}
  | {kind:'object'; fields:Record<string, Field>}
  | {kind:'list'; row:()=>Form; add:string; keyed?:boolean}
  | {kind:'choice'; options:Record<string, Field>; tag?:string};
type Field = {label:string; form:()=>Form; optional?:boolean; initial?:unknown};
const record = (value:unknown):RecordValue =>
  value && typeof value==='object' && !Array.isArray(value) ? value as RecordValue : {};
const field = (label:string,form:()=>Form,optional=false,initial?:unknown):Field=>({label,form,optional,initial});
const object = (fields:Record<string,Field>):Form=>({kind:'object',fields});
const text = (initial='',catalog?:string,variableTypes?:string[]):Form=>({kind:'text',initial,catalog,variableTypes});
const number = (initial=0):Form=>({kind:'number',initial});
const flag = ():Form=>({kind:'boolean',initial:false});
const select = (...choices:string[]):Form=>({kind:'text',choices,initial:choices[0]});
const list = (add:string,row:()=>Form,keyed=false):Form=>({kind:'list',add,row,keyed});
const choice = (options:Record<string,Field>,tag?:string):Form=>({kind:'choice',options,tag});
const id = (label='รหัสอ้างอิง')=>field(label,()=>text('n-'+crypto.randomUUID()));
const style = (optional=true)=>field('สไตล์ข้อความ',()=>text('','style'),optional);
const length = ()=>object({value:field('ค่า',number),unit:field('หน่วย',()=>select('pt','mm'))});
const len = (label:string,optional=true)=>field(label,length,optional);
const edges = ()=>object({top:len('บน',false),right:len('ขวา',false),bottom:len('ล่าง',false),left:len('ซ้าย',false)});
const align = (label='การจัดแนว')=>field(label,()=>select('left','center','right','justify'),true);
const scope = ()=>select('global','section','local','header','footer','group','item');
const referenceFields = (types:string[])=>({
  scope:field('ขอบเขตตัวแปร',scope),
  key:field('ชื่อตัวแปร',()=>text('','variable',types)),
});
const reference = (...types:string[])=>object(referenceFields(types));
const color = (label:string)=>field(label,()=>text('000000'),true);
const sizing = ()=>object({mode:field('ความสูง',()=>select('auto','fixed')),height:len('กำหนดความสูง')});

function schema():Form{
  return object({fields:field('รายการตัวแปร',()=>list('เพิ่มตัวแปร',variable,true))});
}
function variable():Form{
  return choice({
    string:field('ข้อความ',()=>variableOptions(false,true)),
    image:field('รูปภาพ',()=>variableOptions()),
    link:field('ลิงก์',()=>variableOptions()),array:field('รายการที่มีรายการย่อย',()=>variableOptions(true)),
    area:field('พื้นที่เอกสาร (Area)',()=>object({required:field('บังคับส่งค่า',flag,true,true)})),
  },'type');
}
function variableOptions(array=false,string=false):Form{
  return object({required:field('บังคับส่งค่า',flag,true,true),...(string?{allowEmpty:field('ยอมให้ค่าว่าง',flag,true,true)}:{}),
    ...(array?{items:field('ตัวแปรในแต่ละรายการ',schema)}:{})});
}
function inline():Form{
  return choice({
    text:field('ข้อความคงที่',()=>object({id:id(),text:field('ข้อความ',text)})),
    'field-ref':field('แทรกตัวแปร',()=>object({id:id(),...referenceFields(['string','link'])})),
    'system-page-field':field('เลขหน้า',()=>object({id:id(),field:field('ชนิดเลขหน้า',()=>select('current','total')),width:len('ความกว้าง')})),
  },'type');
}
function node():Form{
  return choice({
    'text-block':field('ข้อความ',()=>object({
      id:id(),props:field('หน้าตาข้อความ',()=>object({
        textAlign:align(),textStyleId:style(),pageFieldLayout:field('การวางเลขหน้า',()=>select('compact','fixed'),true),
        toc:field('แสดงในสารบัญ',()=>object({level:field('ระดับ',()=>number(1))}),true),
        anchorId:field('จุดอ้างอิง',()=>choice({literal:field('ข้อความ',text),variable:field('ตัวแปร',()=>reference('string'))}),true),
      })),children:field('เนื้อหาในบรรทัด',()=>list('เพิ่มข้อความ / ตัวแปร',inline)),
    })),
    image:field('รูปภาพ',()=>object({id:id(),props:field('รูปและขนาด',()=>object({
      source:field('ตัวแปรรูปภาพ',()=>reference('image')),align:align(),width:len('กว้าง'),height:len('สูง'),
    }))})),
    line:field('เส้น',()=>object({id:id(),props:field('ลักษณะเส้น',()=>object({
      align:align(),color:color('สี (HEX)'),width:len('กว้าง'),thickness:len('ความหนา'),
      spaceBefore:len('ระยะก่อนเส้น'),spaceAfter:len('ระยะหลังเส้น'),
    }))})),
    columns:field('คอลัมน์',()=>object({id:id(),props:field('ระยะคอลัมน์',()=>object({gap:len('ช่องว่าง')})),
      columns:field('คอลัมน์',()=>list('เพิ่มคอลัมน์',()=>object({
        weight:field('สัดส่วนความกว้าง',()=>number(1)),children:field('เนื้อหาในคอลัมน์',nodes),
      })))})),
    table:field('ตาราง',()=>object({id:id(),props:field('รูปแบบตาราง',()=>object({
      borderColor:color('สีเส้นขอบ (HEX)'),headerRowCount:field('จำนวนแถวหัวตาราง',number,true),
      headerFillColor:color('สีพื้นหัวตาราง (HEX)'),repeatHeaderRows:field('แสดงหัวตารางซ้ำเมื่อขึ้นหน้าใหม่',flag,true,true),
    })),columns:field('ขนาดแต่ละคอลัมน์',()=>list('เพิ่มขนาดคอลัมน์',()=>object({width:len('กว้าง',false)}))),
    rows:field('แถวตาราง',()=>list('เพิ่มแถว',row))})),
    'table-of-contents':field('สารบัญ',()=>object({id:id(),props:field('รูปแบบสารบัญ',()=>object({
      scope:field('ขอบเขตสารบัญ',()=>object({kind:field('แสดงรายการจาก',()=>select('section'))})),textStyleId:style(),
    }))})),
    'page-break':field('ขึ้นหน้าใหม่',()=>object({id:id()})),
  },'type');
}
const nodes=()=>list('เพิ่มองค์ประกอบ',node);
function row():Form{
  return object({id:id('รหัสแถว'),props:field('การแบ่งหน้า',()=>object({allowBreak:field('แยกแถวข้ามหน้าได้',flag,true,true)})),
    cells:field('เซลล์ในแถว',()=>list('เพิ่มเซลล์',cell))});
}
function cell():Form{
  return object({id:id('รหัสเซลล์'),props:field('รูปแบบเซลล์',()=>object({
    padding:field('ระยะขอบในเซลล์',edges,true),columnIndex:field('คอลัมน์เริ่มต้น (เริ่มที่ 0)',number,true),
    colSpan:field('ครอบกี่คอลัมน์',()=>number(1),true),fillColor:color('สีพื้น (HEX)'),
  })),children:field('เนื้อหาในเซลล์',nodes)});
}
const fragment=()=>object({roots:field('องค์ประกอบบนกระดาษ',nodes)});
const nodeRef=(label:string,category:string,optional=false)=>field(label,()=>text('',category),optional);
const repeat=()=>object({tableId:nodeRef('ตาราง','table'),rowTemplateId:nodeRef('แถวต้นแบบ','row'),source:field('วนตามรายการตัวแปร',()=>reference('array'))});
const group=()=>object({
  id:id('รหัสกลุ่ม'),tableId:nodeRef('ตาราง','table'),rowTemplateIds:field('แถวในกลุ่ม',()=>list('เลือกแถวในกลุ่ม',()=>text('','row'))),
  source:field('รายการกลุ่ม',()=>reference('array')),
  memberRepeat:field('วนสมาชิกของกลุ่ม',()=>object({
    rowTemplateId:nodeRef('แถวสำหรับสมาชิก','row'),source:field('รายการสมาชิก',()=>reference('array')),
    emptyRowTemplateId:nodeRef('แถวเมื่อไม่มีสมาชิก','row',true),
  }),true),
  groupLabel:field('เซลล์ชื่อกลุ่ม',()=>object({
    cellTemplateId:nodeRef('เซลล์สำหรับชื่อกลุ่ม','cell'),emptyCellTemplateId:nodeRef('เซลล์เมื่อไม่มีสมาชิก','cell',true),
  }),true),
  pagination:field('การขึ้นหน้า',()=>object({keepStart:field('ให้อยู่กับแถวแรกของกลุ่ม',flag)}),true),
});
const font=()=>object({kind:field('แหล่งฟอนต์',()=>select('library','unselected')),
  releaseId:field('ฟอนต์จากคลัง',()=>text('','font'),true),weight:field('น้ำหนัก',()=>number(400),true),
  style:field('ลักษณะ',()=>select('normal','italic'),true)});
const textStyle=()=>object({font:field('ฟอนต์',font),fontSize:len('ขนาด',false),lineHeightPt:field('ความสูงบรรทัด (pt)',()=>number(18))});
const forms:Record<string,()=>Form>={
  globalSchema:schema,'section-schema':schema,'format-schema':schema,'band-schema':schema,
  styles:()=>list('เพิ่มสไตล์ข้อความ',textStyle,true),
  'section-settings':()=>object({nameBase:field('ชื่อพื้นฐาน',text),
    role:field('ประเภท Section',()=>select('body','cover'),true),
    headerMode:field('แสดงหัวกระดาษ',()=>select('all','first','continuation','none'),true),
    footerMode:field('แสดงท้ายกระดาษ',()=>select('all','first','continuation','none'),true),
    numbering:field('การนับหน้า',()=>object({mode:field('วิธีนับ',()=>select('continue','restart','exclude')),startAt:field('เริ่มที่',()=>number(1),true),visibility:field('แสดงเลขหน้า',()=>select('show','hide'),true)}),true)}),
  format:()=>object({label:field('ชื่อแสดงบนหน้าจอ',text,true),inputSchema:field('ตัวแปรของ Format',schema),
    sizing:field('ความสูงของ Format',sizing),fragment:field('เนื้อหาบนกระดาษ',fragment),
    repeats:field('วนแถวตาราง',()=>list('เพิ่มการวนแถว',repeat)),
    rowGroups:field('วนกลุ่มและสมาชิก',()=>list('เพิ่มกลุ่มแถว',group),true)}),
  band:()=>object({baseTextStyleId:style(false),inputSchema:field('ตัวแปรของหัวหรือท้ายกระดาษ',schema),
    placement:field('ตำแหน่งบนหน้ากระดาษ',()=>object({mode:field('อิงจาก',()=>select('page')),
      left:len('จากขอบซ้าย',false),right:len('จากขอบขวา',false),offset:len('จากขอบหน้า',false)}),true),
    sizing:field('ความสูงของหัวหรือท้าย',()=>object({mode:field('ความสูง',()=>select('content','fixed')),height:len('กำหนดความสูง'),minHeight:len('ความสูงต่ำสุด'),maxHeight:len('ความสูงสูงสุด')}),true),gap:len('ช่องว่างก่อนถึงเนื้อหา'),
    fragment:field('เนื้อหาหัวหรือท้ายกระดาษ',fragment)}),
};

// The form shows nesting. The Engine stores the same structure as ordered ID references.
export function visualValue(part:string,input:unknown):unknown{
  if(part!=='format'&&part!=='band')return input;
  const host=record(input),fragment=record(host.fragment),byId=record(fragment.nodes);
  function expand(id:unknown):RecordValue{
    const raw=record(byId[String(id)]),node={...raw};
    for(const [key,target] of [['rowIds','rows'],['cellIds','cells'],['childIds','children']] as const)
      if(Array.isArray(raw[key])){node[target]=raw[key].map(expand);delete node[key];}
    if(node.type==='columns'&&Array.isArray(node.columns))node.columns=node.columns.map(column=>{
      const {childIds,...rest}=record(column);
      return {...rest,children:Array.isArray(childIds)?childIds.map(expand):[]};
    });
    return node;
  }
  const {rootIds,nodes:_nodes,...rest}=fragment;
  return {...host,fragment:{...rest,roots:Array.isArray(rootIds)?rootIds.map(expand):[]}};
}
function engineValue(part:string,input:unknown):unknown{
  if(part!=='format'&&part!=='band')return input;
  const host=record(input),{roots,...rest}=record(host.fragment);
  const byId:RecordValue=Object.create(null);
  const occupied=new Set<unknown>();
  function collapse(input:unknown,type?:string):unknown{
    const node={...record(input)};
    if(type)node.type=type;
    if(typeof node.id!=='string'||!node.id.trim()||occupied.has(node.id))throw Error('รหัสองค์ประกอบบนกระดาษต้องไม่ว่างและไม่ซ้ำกัน · '+String(node.type)+' / '+String(node.id));
    occupied.add(node.id);
    function children(key:string,target:string,childType?:string){
      if(!Array.isArray(node[key]))return;
      node[target]=node[key].map(value=>collapse(value,childType));delete node[key];
    }
    if(node.type==='text-block')node.role??={role:'paragraph'};
    if(node.type==='table')children('rows','rowIds','table-row');
    if(node.type==='table-row')children('cells','cellIds','table-cell');
    if(node.type==='table-cell')children('children','childIds');
    if(node.type==='columns'&&Array.isArray(node.columns))node.columns=node.columns.map(column=>{
      const {children,...other}=record(column);
      return {...other,childIds:Array.isArray(children)?children.map(child=>collapse(child)):[]};
    });
    byId[String(node.id)]=node;
    return node.id;
  }
  const rootIds=Array.isArray(roots)?roots.map(root=>collapse(root)):[];
  return {...host,fragment:{...rest,rootIds,nodes:byId}};
}

type Catalog = {options:Record<string,{value:string;label:string}[]>;
  schemas:Record<string,Schema|undefined>;localScope?:'local'|'header'|'footer'};
const make=<K extends keyof HTMLElementTagNameMap>(tag:K,label='')=>{
  const element=document.createElement(tag);
  if(label)element.textContent=label;
  return element;
};
function button(label:string,action:()=>void){
  const result=make('button',label);result.type='button';result.onclick=action;return result;
}
type Control={element:HTMLElement;read:()=>unknown};
const optionNames:Record<string,string>={
  left:'ซ้าย',center:'กึ่งกลาง',right:'ขวา',justify:'ชิดสองด้าน',global:'ทั้งเอกสาร',section:'Section นี้',
  local:'Format นี้',header:'หัวกระดาษ',footer:'ท้ายกระดาษ',group:'กลุ่มปัจจุบัน',item:'รายการปัจจุบัน',
  current:'เลขหน้าปัจจุบัน',total:'จำนวนหน้าทั้งหมด',auto:'ตามเนื้อหา',content:'ตามเนื้อหา',fixed:'กำหนดเอง',
  page:'ขอบกระดาษ',library:'คลังฟอนต์',unselected:'ยังไม่เลือก',normal:'ปกติ',italic:'เอียง',
  continue:'นับต่อ',restart:'เริ่มใหม่',exclude:'ไม่นับ',show:'แสดง',hide:'ซ่อน',
  all:'ทุกหน้า',first:'หน้าแรก',continuation:'หน้าถัดไป',none:'ไม่แสดง',body:'เนื้อหา',cover:'ปก',
};
function selectControl(options:Record<string,string>,value:unknown){
  const select=make('select');
  if(typeof value==='string'&&!Object.hasOwn(options,value))options[value]=value;
  for(const [key,label] of Object.entries(options)){
    const option=make('option',label);option.value=key;select.append(option);
  }
  select.value=String(value??'');return select;
}
const readControl=new WeakMap<Element,()=>unknown>();
function createControl(form:Form,initial:unknown,part:string):Control{
  const control=buildControl(form,initial,part);
  readControl.set(control.element,control.read);
  return control;
}
function buildControl(form:Form,initial:unknown,part:string):Control{
  const element=make('div');element.dataset.visualKind=form.kind;
  if(form.kind==='object'){
    const prior=record(initial),controls=new Map<string,Control>();
    for(const [key,spec] of Object.entries(form.fields)){
      const form=spec.form(),value=prior[key],frame=make('fieldset');frame.dataset.visualField=key;
      frame.append(make('legend',spec.label));
      const control=createControl(form,value??spec.initial,part);
      control.element.querySelector(':scope > [data-visual-value]')?.setAttribute('aria-label',spec.label);
      controls.set(key,control);
      const use=spec.optional?make('input'):undefined;
      if(use){
        use.type='checkbox';use.dataset.visualPresent='';use.checked=value!==undefined;
        const label=make('label',key==='rowGroups'?'เปิดใช้การวนกลุ่ม ':'กำหนดค่า ');label.append(use);
        const sync=()=>{control.element.hidden=!use.checked;};
        use.onchange=sync;sync();frame.append(label);
        controls.set(key,{element:frame,read:()=>use.checked?control.read():undefined});
      }

      frame.append(control.element);element.append(frame);
    }
    return {element,read:()=>{
      const result={...prior};
      for(const [key,control] of controls){
        const value=control.read();
        if(value===undefined)delete result[key];else result[key]=value;
      }
      if(form.fields.fields)result.type='object';
      return result;
    }};
  }
  if(form.kind==='list'){
    const spec=form;
    const rows=make('div');rows.dataset.visualRows='';
    const readers=new Map<HTMLElement,()=>[string,unknown]>();
    function add(value?:unknown,key?:string){
      const row=make('details');row.dataset.visualRow='';row.open=value===undefined;
      const summary=make('summary');row.append(summary);
      const body=make('div');body.className='visual-row-body';row.append(body);
      const name=spec.keyed?make('input'):undefined;
      const locked=record(value).type==='area'&&key!==undefined;
      if(name){
        name.value=key??'';name.dataset.visualKey='';name.disabled=locked;
        const label=make('label',part==='styles'?'ชื่อ / รหัสสไตล์ ':'ชื่อตัวแปร ');
        label.append(name);body.append(label);
      }
      const control=createControl(spec.row(),value,part);
      const actions=make('div');actions.className='visual-row-actions';
      function action(label:string,key:string,run:()=>void){
        const item=button(label,run);item.dataset[key]='';actions.append(item);
      }
      action('ขึ้น','visualUp',()=>{const prev=row.previousElementSibling;if(prev)rows.insertBefore(row,prev);});
      action('ลง','visualDown',()=>{const next=row.nextElementSibling;if(next)rows.insertBefore(next,row);});
      if(!locked)action('ลบ','visualRemove',()=>{readers.delete(row);row.remove();});
      body.append(control.element,actions);
      if(locked)(control.element.querySelector('select') as HTMLSelectElement).disabled=true;
      const updateTitle=()=>{
        const kind=control.element.querySelector<HTMLSelectElement>(':scope > [data-visual-choice]');
        const code=control.element.querySelector<HTMLInputElement>('[data-visual-field="id"] input');
        const content=control.element.querySelector<HTMLInputElement>('[data-visual-field="text"] input, [data-visual-field="key"] input');
        summary.textContent=name?.value||[kind?.selectedOptions[0]?.textContent,content?.value||code?.value].filter(Boolean).join(' · ')||spec.add.replace(/^เพิ่ม/,'');
      };
      body.addEventListener('input',updateTitle);body.addEventListener('change',updateTitle);updateTitle();
      rows.append(row);
      readers.set(row,()=>[name?.value.trim()??'',control.read()]);
      return row;
    }
    if(form.keyed)Object.entries(record(initial)).forEach(([key,value])=>add(value,key));
    else if(Array.isArray(initial))initial.forEach(value=>add(value));
    const plus=button('+ '+form.add,()=>{
      const row=add();
      row.querySelector<HTMLElement>('input,select')?.focus();
    });
    plus.dataset.visualAdd='';element.append(rows,plus);
    return {element,read:()=>{
      const values=Array.from(rows.children,row=>readers.get(row as HTMLElement)!());
      if(!form.keyed)return values.map(([,value])=>value);
      const names=new Set<string>();
      for(const [key] of values){
        if(!key||names.has(key))throw Error('ชื่อตัวแปรและรหัสสไตล์ในรายการเดียวกันต้องไม่ว่างและไม่ซ้ำกัน');
        names.add(key);
      }
      return Object.fromEntries(values);
    }};
  }
  if(form.kind==='choice'){
    const originalTag=form.tag?String(record(initial)[form.tag]??''):typeof initial==='object'?'variable':'literal';
    const options=Object.fromEntries(Object.entries(form.options)
      .filter(([key])=>initial!==undefined||key!=='area')
      .filter(([key])=>part!=='band'||!['table','page-break','table-of-contents'].includes(key))
      .map(([key,spec])=>[key,spec.label]));
    const kind=selectControl(options,initial===undefined?Object.keys(options)[0]:originalTag);
    kind.dataset.visualChoice='';kind.setAttribute('aria-label','ชนิด');
    const specs=form.options;
    const body=make('div');body.dataset.visualChoiceBody='';
    let active:Control|undefined;
    function update(){
      const spec=specs[kind.value];
      active=spec&&createControl(spec.form(),kind.value===originalTag?initial:undefined,part);
      body.replaceChildren(active?.element??make('p','เก็บชนิดเดิมตามนิยามที่บันทึกไว้'));
    }
    kind.onchange=update;update();element.append(kind,body);
    return {element,read:()=>{
      if(!active)return initial;
      const value=active.read();
      return form.tag?{...record(value),[form.tag]:kind.value}:value;
    }};
  }
  const value=initial??form.initial;
  const input=form.choices?selectControl(Object.fromEntries(form.choices.map(key=>[key,optionNames[key]??key])),value):make('input');
  input.dataset.visualValue='';
  if(input instanceof HTMLInputElement){
    input.type=form.kind==='boolean'?'checkbox':form.kind;
    if(form.kind==='number')input.step='any';
    if(form.kind==='boolean')input.checked=Boolean(value);
    else input.value=String(value??'');
  }
  if(form.catalog){
    input.dataset.visualCatalog=form.catalog;
    if(form.variableTypes)input.dataset.visualVariableTypes=form.variableTypes.join(',');
    input.setAttribute('list','visual-options-'+form.catalog);
  }
  element.append(input);
  if(form.catalog){
    const picker=button('เลือกจากรายการ',()=>{});
    picker.dataset.visualPicker='';
    const choices=make('div');choices.dataset.pickerOptions='';choices.hidden=true;
    const caption=make('small');caption.dataset.catalogCaption='';
    element.append(picker,choices,caption);
  }
  return {element,read:()=>{
    if(input instanceof HTMLInputElement){
      if(form.kind==='boolean')return input.checked;
      if(form.kind==='number'){
        if(!Number.isFinite(input.valueAsNumber))throw Error('กรอกตัวเลขในช่องที่เปิดใช้งาน');
        return input.valueAsNumber;
      }
    }
    return input.value;
  }};
}
function fieldValue(parent:Element|null,key:string){
  const control=parent?.querySelector<HTMLElement>(':scope > [data-visual-field="'+key+'"] > [data-visual-kind]');
  if(!control||control.hidden)return;
  try{return readControl.get(control)?.();}catch{return undefined;}
}
function variableOptionsFor(input:HTMLInputElement,root:Element,catalog:Catalog){
  const owner=input.closest('[data-visual-kind="object"]'),scope=fieldValue(owner,'scope');
  if(typeof scope!=='string')return [];
  const schemas={...catalog.schemas};
  if(catalog.localScope)schemas[catalog.localScope]=fieldValue(root,'inputSchema') as Schema|undefined;
  const labels:Record<string,string>={};
  if(scope==='group'||scope==='item'){
    const groups=(fieldValue(root,'rowGroups')??[]) as NonNullable<Host['rowGroups']>;
    const groupRows=[...root.querySelectorAll(':scope > [data-visual-field="rowGroups"] > [data-visual-kind] > [data-visual-rows] > details')];
    const lineage=new Set<unknown>();
    for(let node=owner;node&&node!==root;node=node.parentElement?.closest('[data-visual-kind="object"]')??null)
      lineage.add(fieldValue(node,'id'));
    const group=groups[groupRows.findIndex(row=>row.contains(input))]
      ??groups.find(group=>lineage.has(group.tableId)&&group.rowTemplateIds.some(row=>lineage.has(row)));
    const addItems=(target:'group'|'item',source:{scope:string;key:string}|undefined)=>{
      if(!source)return;
      schemas[target]=schemas[source.scope]?.fields[source.key]?.items;
      labels[target]=(labels[source.scope]??optionNames[source.scope])+' › '+source.key+'[]';
    };
    addItems('group',group?.source);
    if(group?.memberRepeat&&lineage.has(group.memberRepeat.rowTemplateId))addItems('item',group.memberRepeat.source);
    const repeats=(fieldValue(root,'repeats')??[]) as NonNullable<Host['repeats']>;
    addItems('item',repeats.find(repeat=>lineage.has(repeat.tableId)&&lineage.has(repeat.rowTemplateId))?.source);
  }
  const allowed=input.dataset.visualVariableTypes?.split(',')??[];
  return Object.entries(schemas[scope]?.fields??{}).filter(([,field])=>allowed.includes(field.type)).map(([key,field])=>({
    value:key,label:(labels[scope]??optionNames[scope]??scope)+' › '+(field.label??key),
  }));
}
export function openVisualAuthoring(
  dialog:HTMLDialogElement,part:string,label:string,input:unknown,catalog:Catalog,commit:(value:unknown)=>void,focusNodeId?:string,
){
  const form=make('form'),head=make('header'),title=make('h2',label),body=make('div'),footer=make('footer');
  const error=make('p');error.setAttribute('role','alert');error.className='visual-error';
  title.id='visual-definition-title';dialog.setAttribute('aria-labelledby',title.id);
  head.append(title,button('ปิด',()=>dialog.close()));
  body.className='visual-form-body';
  const control=createControl(forms[part](),visualValue(part,input),part);
  body.append(control.element);
  for(const key of ['style','font','variable','table','row','cell']){
    const list=make('datalist');list.id='visual-options-'+key;body.append(list);
  }
  function updateOptions(input:HTMLInputElement){
    const category=input.dataset.visualCatalog;
    if(!category)return;
    const choices=category==='variable'?variableOptionsFor(input,control.element,catalog):[...(catalog.options[category]??[])];
    if(['table','row','cell'].includes(category)){
      const field=category==='table'?'rows':category==='row'?'cells':'children';
      for(const candidate of body.querySelectorAll<HTMLInputElement>('[data-visual-field="id"] input')){
        const object=candidate.closest('[data-visual-kind="object"]');
        const matches=object?.querySelector(':scope > [data-visual-field="'+field+'"]')&&
          (category!=='cell'||object.querySelector(':scope > [data-visual-field="props"] [data-visual-field="padding"]'));
        const rule=input.closest('[data-visual-field="repeats"],[data-visual-field="rowGroups"]');
        const group=input.closest('[data-visual-field="rowGroups"] > [data-visual-kind="list"] > [data-visual-rows] > details');
        const repeat=input.closest('[data-visual-field="repeats"] > [data-visual-kind="list"] > [data-visual-rows] > details');
        const tableId=(group??repeat)?.querySelector<HTMLInputElement>('[data-visual-field="tableId"] [data-visual-value]')?.value;
        const table=candidate.closest('[data-visual-field="rows"]')?.parentElement;
        const owner=table?.querySelector<HTMLInputElement>(':scope > [data-visual-field="id"] input')?.value;
        if(matches&&candidate.value&&(!rule||category==='table'||!tableId||tableId===owner))
          choices.push({value:candidate.value,label:candidate.closest('details')?.querySelector('summary')?.textContent??candidate.value});
      }
    }
    const unique=new Map(choices.map(entry=>[entry.value,entry.label]));
    body.querySelector('#visual-options-'+category)?.replaceChildren(...Array.from(unique,([value,label])=>{
      const option=make('option');option.value=value;option.label=label;return option;
    }));
    return unique;
  }
  body.addEventListener('focusin',event=>{if(event.target instanceof HTMLInputElement)updateOptions(event.target);});
  for(const input of body.querySelectorAll<HTMLInputElement>('[data-visual-catalog]'))refreshCaption(input);
  function refreshCaption(input:HTMLInputElement){
    const caption=input.parentElement?.querySelector<HTMLElement>('[data-catalog-caption]');
    if(caption)caption.textContent=catalog.options[input.dataset.visualCatalog??'']?.find(entry=>entry.value===input.value)?.label??'';
  }
  body.addEventListener('input',event=>{if(event.target instanceof HTMLInputElement)refreshCaption(event.target);});
  body.addEventListener('click',event=>{
    const target=event.target;
    if(!(target instanceof HTMLButtonElement)||target.dataset.visualPicker===undefined)return;
    const input=target.parentElement?.querySelector<HTMLInputElement>('[data-visual-catalog]');
    const holder=target.parentElement?.querySelector<HTMLElement>('[data-picker-options]');
    if(!input||!holder)return;
    if(!holder.hidden){holder.hidden=true;return;}
    const choices=updateOptions(input);
    holder.hidden=false;
    if(!choices?.size){holder.textContent='ยังไม่มีรายการให้เลือก';return;}
    const picker=selectControl(Object.fromEntries([['','เลือกรายการ'],...choices]),choices.has(input.value)?input.value:'');
    picker.setAttribute('aria-label',input.getAttribute('aria-label')??'เลือกรายการ');
    picker.onchange=()=>{
      if(!picker.value)return;
      input.value=picker.value;
      input.dispatchEvent(new Event('input',{bubbles:true}));
      input.dispatchEvent(new Event('change',{bubbles:true}));
      const caption=input.parentElement?.querySelector<HTMLElement>('[data-catalog-caption]');
      if(caption)caption.textContent=choices.get(picker.value)??'';
      holder.hidden=true;target.focus();
    };
    holder.replaceChildren(picker);picker.focus();
  });
  const apply=make('button','ใช้กับโครงเอกสาร');apply.type='submit';
  footer.append(error,button('ยกเลิก',()=>dialog.close()),apply);
  form.append(head,body,footer);dialog.replaceChildren(form);
  form.onsubmit=event=>{
    event.preventDefault();error.textContent='';
    try{commit(engineValue(part,control.read()));dialog.close();}
    catch(cause){error.textContent=cause instanceof Error?cause.message:String(cause);}
  };
  dialog.showModal();
  if(focusNodeId){
    const input=Array.from(body.querySelectorAll<HTMLInputElement>('[data-visual-field="id"] input'))
      .find(candidate=>candidate.value===focusNodeId);
    if(input){
      const first=input.closest('details');
      for(let row=first;row;row=row.parentElement?.closest('details')??null)row.open=true;
      first?.querySelector('summary')?.focus({preventScroll:true});
      first?.querySelector('summary')?.scrollIntoView({block:'start'});
    }
  }
}
