import type {Band, Definition, Format, Fragment, Length, Ref, Schema} from './editor-structure';

type Edge = 'top'|'right'|'bottom'|'left';
const edges:Edge[]=['top','right','bottom','left'];
const pt=(value:number):Length=>({value,unit:'pt'});
const uid=()=>crypto.randomUUID();
const object=(x:unknown):x is Record<string,unknown>=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const invalid=(message:string):never=>{throw Error(message);};
const idPattern=/^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
export type PaperSettings={size:string;orientation:string;margin:Record<Edge,Length>};
export type Part='globalSchema'|'styles'|'section-settings'|'section-schema'|'format'|'band';
export function settings(values:Record<string,string>):PaperSettings{
  if(!['A4','Letter'].includes(values.size)||!['portrait','landscape'].includes(values.orientation))
    invalid('เลือกขนาดและแนวกระดาษ');
  const margin=Object.fromEntries(edges.map(edge=>{
    const n=Number(values[edge]);
    if(!Number.isFinite(n)||n<0||n>180)invalid('ระยะขอบต้องอยู่ระหว่าง 0–180 pt');
    return [edge,pt(n)];
  })) as PaperSettings['margin'];
  return {size:values.size,orientation:values.orientation,margin};
}
export function newDefinition(values:Record<string,string>){
  const name=values.name.trim(),key=values.key.trim();
  if(!name||name.length>128||!values.section.trim()||values.section.length>128)invalid('กรอกชื่อโครงและชื่อ Section');
  if(!/^[a-z0-9-]{1,42}$/.test(key))invalid('รหัสโครงใช้ a–z, ตัวเลข หรือ - ได้ไม่เกิน 42 ตัว');
  const layout=uid(), section=uid(), templateId=uid(),docKey='editor-draft-'+key;
  const definition:Definition & {name:string;templateId:string;docKey:string;schemaVersion:2;version:1;examples:unknown[]}={
    templateId,docKey,name,schemaVersion:2,nodeModelVersion:20,version:1,examples:[],
    book:{contentSlot:'body',defaultPageLayoutId:layout} as Definition['book'],
    styles:{body:{font:{kind:'unselected'},fontSize:pt(12),lineHeightPt:18}},
    globalSchema:{type:'object',fields:{}},
    pageLayouts:{[layout]:{page:settings(values)}},
    sections:[{id:section,sectionKey:'S0001',label:values.section.trim(),nameBase:values.section.trim(),
      pageLayoutId:layout,inputSchema:{type:'object',fields:{}},source:{kind:'blank'}}]
  };
  return {templateId,docKey,name,revision:0,fingerprint:'',definition};
}
export function changePage(source:Definition,at:Ref,page:PaperSettings){
  const definition=structuredClone(source);
  const section=definition.sections.find(section=>section.id===at.sectionId)??invalid('ไม่พบ Section');
  const layouts=definition.pageLayouts??={};
  const prior=section.pageLayoutId??definition.book.defaultPageLayoutId;
  const shared=definition.sections.some(s=>s!==section&&(s.pageLayoutId??definition.book.defaultPageLayoutId)===prior);
  const id=shared?uid():prior;
  layouts[id]={...layouts[prior],page};section.pageLayoutId=id;
  return definition;
}
export function addBand(source:Definition,at:Ref,kind:'header'|'footer'){
  const definition=structuredClone(source);
  const section=definition.sections.find(s=>s.id===at.sectionId)??invalid('ไม่พบ Section');
  if(section[kind])invalid('Section นี้มีส่วนดังกล่าวแล้ว');
  const style=Object.keys(definition.styles)[0]??invalid('สร้างสไตล์ข้อความก่อน');
  section[kind]={baseTextStyleId:style,inputSchema:{type:'object',fields:{}},fragment:{rootIds:[],nodes:{}}} as Band;
  return definition;
}
function schema(value:unknown):Schema{
  if(!object(value)||value.type!=='object'||!object(value.fields))return invalid('นิยามตัวแปรต้องเป็น object ที่มี fields');
  for(const [key,field] of Object.entries(value.fields)){
    if(!key||key.includes('.')||!object(field)||typeof field.type!=='string')invalid('ตรวจชื่อและชนิดตัวแปร');
    if(object(field)&&field.type==='array')schema(field.items);
  }
  return value as unknown as Schema;
}
function fragment(value:unknown):Fragment{
  if(!object(value)||!Array.isArray(value.rootIds)||!object(value.nodes))return invalid('Fragment ต้องมี rootIds และ nodes');
  const nodes=value.nodes, seen=new Set<string>();
  function visit(id:unknown){
    if(typeof id!=='string'||!Object.hasOwn(nodes,id)||seen.has(id))return invalid('ตรวจความสัมพันธ์ node และ ID ที่อ้างซ้ำ');
    seen.add(id);
    const node=nodes[id];
    if(!object(node)||node.id!==id||typeof node.type!=='string')return invalid('ข้อมูล node ไม่ครบ');
    for(const key of ['rowIds','cellIds','childIds'])if(Object.hasOwn(node,key)){
      const children=node[key];if(!Array.isArray(children))return invalid('รายการลูกของ node ต้องเป็นรายการ');
      children.forEach(visit);
    }
    if(node.type==='columns'){
      if(!Array.isArray(node.columns))return invalid('ชุดคอลัมน์ต้องมี columns');
      for(const col of node.columns){
        if(!object(col)||!Array.isArray(col.childIds))return invalid('คอลัมน์ต้องมี childIds');
        col.childIds.forEach(visit);
      }
    }
    if(node.children!==undefined&&(!Array.isArray(node.children)||node.children.some(child=>!object(child)||typeof child.type!=='string')))
      return invalid('ตรวจข้อความย่อยใน node');
  }
  value.rootIds.forEach(visit);
  if(seen.size!==Object.keys(nodes).length)invalid('มี node ที่ยังไม่มีตำแหน่ง');
  return value as unknown as Fragment;
}
export function partValue(definition:Definition,at:Ref,part:Part):unknown{
  const section=definition.sections.find(s=>s.id===at.sectionId)!;
  if(part==='globalSchema'||part==='styles')return definition[part];
  if(part==='section-schema')return section.inputSchema;
  if(part==='section-settings'){
    return Object.fromEntries(Object.entries(section).filter(([key])=>['nameBase','numbering','headerMode','footerMode','role'].includes(key)));
  }
  if(part==='band')return section[at.band!];
  const format=definition.areaFormats![at.formatId!];
  return Object.fromEntries(Object.entries(format).filter(([key])=>!['key','ownerAreaId'].includes(key)));
}
export function applyPart(source:Definition,at:Ref,part:Part,input:unknown){
  if(!object(input))return invalid('กรอกนิยามส่วนนี้เป็น JSON object');
  const definition=structuredClone(source);
  const section=definition.sections.find(s=>s.id===at.sectionId)??invalid('ไม่พบ Section');
  if(part==='globalSchema')definition.globalSchema=schema(input);
  else if(part==='styles'){
    if(!Object.keys(input).length)invalid('ต้องมีอย่างน้อยหนึ่งสไตล์');
    definition.styles=input;
  }else if(part==='section-schema'){
    const next=schema(input);
    for(const [key,field] of Object.entries(section.inputSchema.fields))
      if(field.type==='area'&&(next.fields[key]?.type!=='area'||next.fields[key].areaId!==field.areaId))
        invalid('จัดการความสัมพันธ์ของ Area จากกระดาษ');
    section.inputSchema=next;
  }else if(part==='section-settings'){
    for(const key of Object.keys(input))if(!['nameBase','numbering','headerMode','footerMode','role'].includes(key))invalid('ตั้งค่าเฉพาะ Section นี้');
    Object.assign(section,input);
  }else if(part==='band'){
    const kind=at.band??invalid('เลือกหัวหรือท้ายกระดาษ');
    section[kind]={...input,inputSchema:schema(input.inputSchema),fragment:fragment(input.fragment)} as Band;
  }else{
    const formatId=at.formatId??invalid('เลือก Format');
    const current=definition.areaFormats?.[formatId]??invalid('ไม่พบ Format');
    if(!Array.isArray(input.repeats))invalid('Format ต้องมีรายการ repeats');
    definition.areaFormats![formatId]={...input,key:current.key,ownerAreaId:current.ownerAreaId,
      inputSchema:schema(input.inputSchema),fragment:fragment(input.fragment)} as Format;
  }
  return definition;
}
export function addVariable(source:Definition,at:Ref,scope:'global'|'section'|'local'|'header'|'footer',values:Record<string,string>){
  const definition=structuredClone(source);
  const section=definition.sections.find(s=>s.id===at.sectionId)??invalid('ไม่พบ Section');
  const target=scope==='global'?definition.globalSchema:scope==='section'?section.inputSchema:
    scope==='local'?definition.areaFormats?.[at.formatId??'']?.inputSchema:section[scope]?.inputSchema;
  if(!target)return invalid('เลือกขอบเขตตัวแปรก่อน');
  const {key,type,required}=values;
  if(!idPattern.test(key)||['constructor','prototype'].includes(key)||Object.hasOwn(target.fields,key))
    invalid('ใช้รหัสตัวแปรภาษาอังกฤษขึ้นต้นและไม่ซ้ำ');
  const allowed=scope==='header'||scope==='footer'?['string','image','link']:['string','image','link','array'];
  if(!allowed.includes(type))invalid('ชนิดตัวแปรนี้ใช้ไม่ได้ในขอบเขตนี้');
  target.fields[key]={type,required:required==='yes',...(type==='array'?{items:{type:'object',fields:{}}}:{})};
  return definition;
}
