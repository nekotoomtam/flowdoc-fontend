export type Field = {type:string; label?:string; default?:unknown; allowEmpty?:boolean; items?:Schema; areaId?:string; required?:boolean; computed?:{inputs:{quantity:string;unit:string}}; formula?:{operation:"sum";source:{areaId:string;formatKey:string;arrayField:string;valueField:string};lookup?:{arrayField:string;keyField:string;valueField:string}}};
export type Schema = {type?:'object'; fields:Record<string,Field>};
export type InlineStyle = {familyStyleId?:string;bold?:boolean;italic?:boolean;underline?:boolean;fontSizePt?:number;color?:string};
export type Inline = {id?:string; type:string; textStyleId?:string;styleOverride?:InlineStyle;text?:string; key?:string; scope?:string; field?:string;value?:unknown;target?:unknown;url?:unknown};
export type Length = {unit:'pt'|'mm';value:number};
export const paddingSides=['top','right','bottom','left'] as const;
type CellPadding=Partial<Record<typeof paddingSides[number],Length>>;
export const defaultCellPadding=4;
export const lengthInPoints=(value:Length)=>value.unit==='mm'?value.value*72/25.4:value.value;
export type DocNode = {
  id:string; type:string; role?:{role:string};
  props?:{areaId?:string;verticalAlign?:string;colSpan?:number;rowSpan?:number;columnIndex?:number;
    anchorId?:unknown;headerRowCount?:number;repeatHeaderRows?:boolean;allowBreak?:boolean;textStyleId?:string;heightMode?:'content'|'fixed';
    width?:Length;height?:Length;gap?:Length;borderWidth?:Length;borderColor?:string;headerFillColor?:string;fillColor?:string;
    textAlign?:string;align?:string;color?:string;thickness?:Length;spaceBefore?:Length;spaceAfter?:Length;padding?:CellPadding;source?:{scope:string;key:string}};
  rowIds?:string[];cellIds?:string[];childIds?:string[];
  columns?:{width?:Length;childIds?:string[];weight?:number}[];children?:Inline[];
};
export type Fragment = {rootIds:string[];nodes:Record<string,DocNode>};
type Repeat = {tableId:string;rowTemplateId:string;source?:{scope:string;key:string}};
type Group = {id:string;tableId:string;rowTemplateIds:string[];source:{scope:string;key:string};memberRepeat:{rowTemplateId:string;source:{scope:string;key:string};emptyRowTemplateId:string};pagination?:{keepStart:boolean}};
type CellRepeat = {id?:string;cellId:string;childTemplateIds:string[];source?:{scope:string;key:string}};
export type Host = {fragment?:Fragment;repeats?:Repeat[];rowGroups?:Group[];cellRepeats?:CellRepeat[]};
export type Format = Host & {key:string;label?:string;ownerAreaId:string;inputSchema:Schema;fragment:Fragment};
export type Band = Host & {firstPageOnly?:string[];baseTextStyleId?:string;inputSchema:Schema;fragment:Fragment;placement?:{mode:string;left:Length;right:Length;offset:Length};sizing?:{mode?:'content'|'fixed';height?:Length;minHeight?:Length;maxHeight?:Length};gap?:Length};
type BandMode = 'all'|'first'|'continuation'|'none';
export type Section = {id:string;label:string;nameBase?:string;sectionKey:string;pageLayoutId?:string;
  role?:'body'|'cover';headerMode?:BandMode;footerMode?:BandMode;
  numbering?:{mode:'continue'|'restart'|'exclude';visibility?:'show'|'hide';startAt?:number};
  inputSchema:Schema;source:Host & {kind:string};header?:Band;footer?:Band};
export type Definition = {nodeModelVersion:number;book:{defaultPageLayoutId:string};styles:Record<string,unknown>;
  pageLayouts?:Record<string,{page:{size:string;orientation?:string;margin?:Partial<Record<'top'|'right'|'bottom'|'left',Length>>}}>;
  sections:Section[];areaFormats?:Record<string,Format>;globalSchema:Schema};
export type Ref = {sectionId:string;formatId?:string;band?:'header'|'footer';nodeId?:string;part?:string};
export type Change = {kind:'section';label:string} | {kind:'area';at:Ref;key:string;format:string}
  | {kind:'format';at:Ref;key:string} | {kind:'node';at:Ref;type:string;source?:{scope:string;key:string};pageField?:'current'|'total';position?:{anchor:string;side:'before'|'after'}}
  | {kind:'tag-style';at:Ref;style:InlineStyle} | {kind:'remove-tag';at:Ref}
  | {kind:'paragraph-style';at:Ref;styleId:string}
  | {kind:'paragraph-parts';at:Ref;parts:Inline[]}
  | {kind:'inline-text';at:Ref;text:string}
  | {kind:'column-boundary';at:Ref;left:number;fraction:number}
  | {kind:'layout-column';at:Ref;action:'add-before'|'add-after'|'remove'|'weight';weight?:number}
  | {kind:'column-content';at:Ref;type:'text-block'|'line';text?:string}
  | {kind:'spacer-height';at:Ref;length:Length}
  | {kind:'line-spacing';at:Ref;side:'before'|'after';length:Length}
  | {kind:'paint';at:Ref;property:'color'|'borderColor'|'fillColor';value:string}
  | {kind:'row-break';at:Ref;allowBreak:boolean}
  | {kind:'table-divider';at:Ref;header?:Ref;cell:Ref;left:number;fraction:number}
  | {kind:'column-width';at:Ref;column:number;length:Length}
  | {kind:'cell-padding';at:Ref;padding:CellPadding}
  | {kind:'band-item-pages';at:Ref;mode:'all'|'first'}
  | {kind:'insert-tag';at:Ref;offset:number;scope:string;key:string}
  | {kind:'binding';at:Ref;scope:string;key:string}
  | {kind:'group';at:Ref;scope:'global'|'section'|'local';key:string;member:string}
  | {kind:'merge'|'split';at:Ref}
  | {kind:'reorder';at:Ref;delta:-1|1;targetId?:string} | {kind:'move';at:Ref;to:Ref;bindings?:Record<string,string>} | {kind:'delete';at:Ref};
const schema=():Schema=>({type:'object',fields:{}});
const uid=()=>crypto.randomUUID();
const pt=(value:number):Length=>({unit:'pt',value});
const fail=(message:string):never=>{throw Error(message);};
const keyPattern=/^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const rootTypes=['text-block','table','line','page-break'];
const own=(target:object,key:string)=>Object.hasOwn(target,key);
export const refKey=(ref:Ref)=>JSON.stringify([ref.sectionId,ref.formatId??'',ref.band??'',ref.nodeId??'',...(ref.part?[ref.part]:[])]);
const key=(name:string,fields:object)=>{
  if(!keyPattern.test(name)||['constructor','prototype'].includes(name))fail('ใช้ชื่อภาษาอังกฤษขึ้นต้น ตามด้วยตัวอักษร ตัวเลข _ หรือ -');
  if(own(fields,name))fail('ชื่อนี้มีอยู่แล้วในตำแหน่งนี้');
};
function resolve(def:Definition,ref:Ref){
  const section=def.sections.find(s=>s.id===ref.sectionId)??fail('ไม่พบ Section');
  const format=ref.formatId?(def.areaFormats?.[ref.formatId]??fail('ไม่พบ Format')):undefined;
  const host:Host=format??(ref.band?(section[ref.band]??fail('ไม่พบหัวหรือท้ายกระดาษ')):section.source);
  const fragment=host.fragment;
  const node=ref.nodeId?(fragment?.nodes[ref.nodeId]??fail('ไม่พบ node')):undefined;
  return {section,format,host,fragment,node};
}
function children(n:DocNode){
  return n.rowIds??n.cellIds??n.childIds??n.columns?.flatMap(c=>c.childIds??[])??[];
}
function nodeList(f:Fragment,id:string):string[]{
  if(f.rootIds.includes(id))return f.rootIds;
  for(const n of Object.values(f.nodes)){
    for(const list of [n.rowIds,n.cellIds,n.childIds,...(n.columns??[]).map(c=>c.childIds)]){
      if(list?.includes(id))return list;
    }
  }
  return fail('node ไม่มีตำแหน่งในโครง');
}
function owner(f:Fragment,id:string){return Object.values(f.nodes).find(n=>children(n).includes(id));}
function subtree(f:Fragment,node:DocNode){
  const all=new Set<string>();
  function visit(n:DocNode){if(all.has(n.id))return;all.add(n.id);for(const id of children(n))visit(f.nodes[id]);}
  visit(node);return all;
}
function areaField(def:Definition,section:Section,areaId:string){
  for(const s of [section.inputSchema,def.globalSchema]){
    const match=Object.entries(s.fields).find(([,f])=>f.type==='area'&&f.areaId===areaId);
    if(match)return {schema:s,key:match[0],field:match[1]};
  }
  return fail('Area ไม่มีตัวแปรกำกับ');
}
const formatsFor=(def:Definition,areaId:string)=>Object.entries(def.areaFormats??{}).filter(([,f])=>f.ownerAreaId===areaId);
function areaIdOf(n:DocNode|undefined){
  if(n?.type!=='area'||!n.props?.areaId)return fail('เลือก Area ก่อน');
  return n.props.areaId;
}
function authored(section:Section){
  if(!section.source.fragment)section.source={kind:'authored',fragment:{rootIds:[],nodes:{}},repeats:[]};
  return section.source.fragment!;
}
function insertRoot(f:Fragment,id:string){
  const end=f.nodes[f.rootIds.at(-1)??''];
  f.rootIds.splice(end?.type==='area'&&end.props?.verticalAlign==='bottom'?-1:f.rootIds.length,0,id);
}
function text(def:Definition):DocNode{
  const textStyleId=Object.keys(def.styles)[0]??fail('เอกสารยังไม่มีสไตล์ข้อความ');
  return {id:uid(),type:'text-block',role:{role:'paragraph'},props:{textStyleId},children:[{id:uid(),type:'text',text:'ข้อความใหม่'}]};
}
function makeFormat(def:Definition,areaId:string,name:string){
  const formats=def.areaFormats??={};
  key(name,Object.fromEntries(formatsFor(def,areaId).map(([,f])=>[f.key,true])));
  const node=text(def), id='format-'+uid();
  formats[id]={key:name,ownerAreaId:areaId,inputSchema:schema(),repeats:[],fragment:{rootIds:[node.id],nodes:{[node.id]:node}}};
  return id;
}
function sectionBinding(value:unknown,handled?:Set<object>):string|undefined{
  if(!value||typeof value!=='object')return;
  if(!handled?.has(value)&&'scope' in value&&value.scope==='section')
    return 'key' in value&&typeof value.key==='string'?value.key:'ตัวแปร';
  for(const child of Object.values(value)){
    const found=sectionBinding(child,handled);if(found)return found;
  }
}
function staticHorizontalTable(host:Host,f:Fragment,table:DocNode){
  return !host.repeats?.some(r=>r.tableId===table.id)&&!host.rowGroups?.some(r=>r.tableId===table.id)
    &&(table.rowIds??[]).every(id=>(f.nodes[id].cellIds??[]).every(cell=>
      !(f.nodes[cell].props?.rowSpan&&f.nodes[cell].props!.rowSpan!>1)&&!host.cellRepeats?.some(rep=>rep.cellId===cell)));
}
function plainTable(host:Host,f:Fragment,table:DocNode){
  return staticHorizontalTable(host,f,table)&&(table.rowIds??[]).every(id=>
    f.nodes[id].cellIds!.every(cell=>(f.nodes[cell].props?.colSpan??1)===1));
}
export function canAddPlainRows(definition:Definition,at:Ref){
  const {host,node,fragment}=resolve(definition,at);
  return Boolean(node?.type==='table'&&fragment&&plainTable(host,fragment,node));
}
export function groupSources(def:Definition,at:Ref){
  const {section,format}=resolve(def,at);
  const scopes=[['global',def.globalSchema],['section',section.inputSchema],['local',format?.inputSchema]] as const;
  return scopes.flatMap(([scope,s])=>Object.entries(s?.fields??{}).flatMap(([key,field])=>
    field.type==='array'?Object.entries(field.items?.fields??{}).filter(([,item])=>item.type==='array')
      .map(([member])=>({scope,key,member})):[]));
}
function addGroup(def:Definition,change:Extract<Change,{kind:'group'}>){
  const {host,node,fragment:f}=resolve(def,change.at);
  if(node?.type!=='table'||!f||!plainTable(host,f,node))return fail('สร้างกลุ่มได้ในตารางที่ไม่มีการวนซ้ำหรือเซลล์ผสาน');
  if(!groupSources(def,change.at).some(x=>x.scope===change.scope&&x.key===change.key&&x.member===change.member))
    fail('เลือกตัวแปรรายการและรายการสมาชิกที่ประกาศไว้');
  const rowTemplateIds=Array.from({length:3},()=>makeRow(def,f,node.columns!.length));
  node.rowIds!.push(...rowTemplateIds);
  (host.rowGroups??=[]).push({id:uid(),tableId:node.id,rowTemplateIds,
    source:{scope:change.scope,key:change.key},
    memberRepeat:{rowTemplateId:rowTemplateIds[1],emptyRowTemplateId:rowTemplateIds[2],source:{scope:'group',key:change.member}},
    pagination:{keepStart:true}});
  return {...change.at,nodeId:rowTemplateIds[1]};
}
function changeCellSpan(def:Definition,at:Ref,kind:'merge'|'split'){
  const {host,node,fragment:f}=resolve(def,at);
  if(node?.type!=='table-cell'||!f)return fail('เลือกเซลล์ก่อน');
  const row=owner(f,node.id),table=row&&owner(f,row.id);
  if(!row||!table||!staticHorizontalTable(host,f,table))
    return fail('ผสานหรือแยกได้เฉพาะตารางที่ไม่มีแถววนหรือการผสานแนวตั้ง');
  const cells=row.cellIds!, index=cells.indexOf(node.id);
  // Record explicit placement before changing the list.
  let column=0;
  for(const id of cells){
    const cell=f.nodes[id];
    cell.props??={};
    cell.props.columnIndex??=column;
    column=cell.props.columnIndex+(cell.props.colSpan??1);
  }
  const span=node.props!.colSpan??1;
  if(kind==='merge'){
    const right=f.nodes[cells[index+1]??''];
    if(!right)return fail('ไม่มีเซลล์ด้านขวา');
    if([...node.childIds!,...right.childIds!].some(k=>f.nodes[k].type==='area'))fail('เซลล์ที่วาง Area อยู่ต้องย้าย Area ออกก่อนผสาน');
    node.props!.colSpan=span+(right.props?.colSpan??1);
    node.childIds!.push(...right.childIds!);cells.splice(index+1,1);delete f.nodes[right.id];
  }else{
    if(span<=1)return fail('เซลล์นี้ยังไม่ได้ผสาน');
    const start=node.props!.columnIndex!;
    delete node.props!.colSpan;
    const inserted=[];
    for(let offset=1;offset<span;offset++){
      const cell:DocNode={id:uid(),type:'table-cell',props:{columnIndex:start+offset},childIds:[]};
      f.nodes[cell.id]=cell;inserted.push(cell.id);
    }
    cells.splice(index+1,0,...inserted);
  }
  return at;
}
function makeRow(def:Definition,f:Fragment,count:number){
  const row:DocNode={id:uid(),type:'table-row',props:{allowBreak:true},cellIds:[]};
  for(let i=0;i<count;i++){
    const t=text(def),cell:DocNode={id:uid(),type:'table-cell',props:{columnIndex:i},childIds:[t.id]};
    f.nodes[t.id]=t;f.nodes[cell.id]=cell;row.cellIds!.push(cell.id);
  }
  f.nodes[row.id]=row;return row.id;
}
function cleanHost(host:Host,ids:Set<string>){
  if(host.repeats)host.repeats=host.repeats.filter(r=>!ids.has(r.tableId));
  if(host.rowGroups)host.rowGroups=host.rowGroups.filter(r=>!ids.has(r.tableId));
  if(host.cellRepeats)host.cellRepeats=host.cellRepeats.filter(r=>!ids.has(r.cellId));
}
function protectAnchors(nodes:Record<string,DocNode>|undefined){
  if(Object.values(nodes??{}).some(n=>n.props?.anchorId))fail('รายการนี้มีจุดอ้างอิง ต้องจัดการลิงก์ก่อนลบ');
}
function removeArea(def:Definition,section:Section,n:DocNode){
  const id=areaIdOf(n), field=areaField(def,section,id);
  delete field.schema.fields[field.key];
  for(const [fid,format] of formatsFor(def,id)){protectAnchors(format.fragment.nodes);delete def.areaFormats![fid];}
}
function dynamicRow(host:Host,rowId:string|undefined){
  return Boolean(host.repeats?.some(r=>r.rowTemplateId===rowId)||host.rowGroups?.some(g=>g.rowTemplateIds.some(x=>x===rowId)));
}
function canDetach(host:Host,f:Fragment,node:DocNode){
  const parent=owner(f,node.id);
  if(node.type==='table-cell')fail('ย้ายหรือลบเซลล์แยกจากตารางไม่ได้');
  if(node.type==='table-row'&&parent){
    if(!plainTable(host,f,parent))fail('แถวในตารางที่วนซ้ำหรือผสานต้องแก้พร้อมกฎตาราง');
    if(parent.rowIds!.indexOf(node.id)<(parent.props?.headerRowCount??0))fail('แถวหัวตารางต้องอยู่ด้านบน');
  }
  if(host.cellRepeats?.some(r=>r.childTemplateIds.includes(node.id)))fail('node นี้เป็นต้นแบบของรายการในเซลล์');
  if(node.props?.anchorId)fail('node นี้มีจุดอ้างอิงในเอกสาร');
}
function reorder<T>(list:T[],item:T,delta:number,min=0){
  const i=list.indexOf(item),next=i+delta;
  if(i<0||next<min||next>=list.length)fail('ถึงขอบเขตที่ย้ายได้แล้ว');
  [list[i],list[next]]=[list[next],list[i]];
}
function nodeReorder(host:Host,fragment:Fragment,node:DocNode,list:string[],delta:-1|1){
  canDetach(host,fragment,node);
  const parent=owner(fragment,node.id);
  reorder(list,node.id,delta,parent?.type==='table'?(parent.props?.headerRowCount??0):0);
  if(fragment.rootIds.includes(node.id)&&
    list.slice(0,-1).some(id=>fragment.nodes[id].props?.verticalAlign==='bottom'))
    fail('Area ท้ายหน้าต้องอยู่ท้าย Section');
}
export function reorderTargets(def:Definition,at:Ref){
  const targets=new Map<string,-1|1>();
  const state=structureOrder(def,at);
  if(!state)return targets;
  const {host,fragment,node}=resolve(def,at);
  for(const delta of [-1,1] as const){
    if(delta===-1?state.up:state.down)continue;
    const copy=[...state.ids];
    for(let i=state.index+delta;i>=0&&i<copy.length;i+=delta){
      const target=copy[i];
      try{if(node&&fragment)nodeReorder(host,fragment,node,copy,delta);}
      catch{break;}
      targets.set(target,delta);
    }
  }
  return targets;
}
export function structureOrder(definition:Definition,at:Ref){
  if(at.part)return;
  const {node,fragment,host,format}=resolve(definition,at);
  if(!node&&(format||at.band))return;
  const ids=node&&fragment?nodeList(fragment,node.id):definition.sections.map(section=>section.id);
  const id=node?.id??at.sectionId;
  const check=(delta:-1|1)=>{
    try{
      const copy=[...ids];
      if(node&&fragment)nodeReorder(host,fragment,node,copy,delta);
      else reorder(copy,id,delta);
      return '';
    }catch(error){return error instanceof Error?error.message:'จัดลำดับไม่ได้';}
  };
  return {ids,index:ids.indexOf(id),up:check(-1),down:check(1)};
}
function addNode(def:Definition,at:Ref,type:string,source?:{scope:string;key:string},pageField?:'current'|'total',position?:{anchor:string;side:'before'|'after'}):Ref {
  const {section,host,node,fragment,format}=resolve(def,at);
  if(type==='table-row'){
    if(node?.type!=='table'||!fragment||!plainTable(host,fragment,node))return fail('เพิ่มแถวตรงนี้ได้เฉพาะตารางที่ไม่มีแถววนหรือเซลล์ผสาน');
    const nodeId=makeRow(def,fragment,node.columns!.length);
    node.rowIds!.push(nodeId);return {...at,nodeId};
  }
  const cell=node?.type==='table-cell'?node:undefined;
  if(node&&!cell)fail('เลือก Section, Format หรือตัวเซลล์เป็นตำแหน่งเพิ่ม node');
  const allowed=at.band?['text-block','line','image','page-field']:cell?['text-block','image']:[...rootTypes,'image','table-of-contents'];
  if(!allowed.includes(type))fail('ชนิด node นี้วางในตำแหน่งที่เลือกไม่ได้');
  const f=fragment??authored(section);
  const next:DocNode=type==='text-block'||type==='page-field'?text(def):{id:uid(),type,...(type==='line'?{props:{}}:{})};
  if(type==='page-field'){
    if(pageField!=='current'&&pageField!=='total')return fail('เลือกชนิดเลขหน้า');
    next.children=[{id:uid(),type:'system-page-field',field:pageField,width:pt(28)} as Inline];
  }
  if(type==='image'){
    const scopes:Record<string,Schema|undefined>={global:def.globalSchema,section:section.inputSchema,local:format?.inputSchema};
    if(at.band)scopes[at.band]=section[at.band]?.inputSchema;
    if(!source||scopes[source.scope]?.fields[source.key]?.type!=='image')return fail('เลือกตัวแปรภาพในขอบเขตนี้');
    next.props={source,width:pt(120),height:pt(60)};
  }
  if(type==='table-of-contents')next.props={textStyleId:Object.keys(def.styles)[0],scope:{kind:'section'}} as DocNode['props'];
  if(type==='table')Object.assign(next,{props:{headerRowCount:0,repeatHeaderRows:false},
    columns:[{width:pt(90)},{width:pt(90)}],rowIds:[makeRow(def,f,2)]});
  f.nodes[next.id]=next;
  if(position){
    const list=cell?.childIds??f.rootIds;
    const index=list.indexOf(position.anchor);
    if(index<0)return fail('เลือกตำแหน่งในส่วนเดียวกัน');
    if(position.side==='after'&&f.nodes[position.anchor]?.props?.verticalAlign==='bottom')return fail('Area ท้ายหน้าต้องอยู่ท้าย Section');
    if(host.cellRepeats?.some(r=>r.childTemplateIds.includes(position.anchor)))return fail('แทรกในรายการวนซ้ำต้องแก้พร้อมกฎรายการ');
    list.splice(index+(position.side==='after'?1:0),0,next.id);
  }else if(cell)cell.childIds!.push(next.id);
  else insertRoot(f,next.id);
  return {...at,nodeId:next.id};
}
export function setBandFirstPageItems(band:Band,ids:readonly string[]){
  const selected=new Set(ids);
  const roots=band.fragment.rootIds.filter(id=>selected.has(id));
  if(roots.length)band.firstPageOnly=roots;
  else delete band.firstPageOnly;
}
function remove(def:Definition,at:Ref):Ref{
  const {section,host,format,fragment:f,node}=resolve(def,at);
  if(node&&f){
    canDetach(host,f,node);
    const list=nodeList(f,node.id), parent=owner(f,node.id);
    if(node.type==='table-row'&&list.length<=1)fail('ตารางต้องมีอย่างน้อยหนึ่งแถว');
    if(format&&list===f.rootIds&&list.length<=1)fail('Format ต้องมีอย่างน้อยหนึ่ง node');
    const ids=subtree(f,node);
    if([...ids].some(id=>f.nodes[id].props?.anchorId))fail('รายการนี้มีจุดอ้างอิง ต้องจัดการลิงก์ก่อนลบ');
    for(const id of ids)if(f.nodes[id].type==='area')removeArea(def,section,f.nodes[id]);
    cleanHost(host,ids);list.splice(list.indexOf(node.id),1);
    if(at.band){const band=section[at.band]!;if(band.firstPageOnly)setBandFirstPageItems(band,band.firstPageOnly);}
    for(const id of ids)delete f.nodes[id];
    if(host===section.source&&!f.rootIds.length)section.source={kind:'blank'};
    return {...at,nodeId:parent?.id};
  }
  if(format){
    if(formatsFor(def,format.ownerAreaId).length<=1)fail('Area ต้องมีอย่างน้อยหนึ่ง Format');
    protectAnchors(format.fragment.nodes);
    delete def.areaFormats![at.formatId!];
    const area=Object.values(section.source.fragment?.nodes??{}).find(n=>n.type==='area'&&n.props?.areaId===format.ownerAreaId);
    return {sectionId:section.id,nodeId:area?.id};
  }
  if(at.band){delete section[at.band];return {sectionId:section.id};}
  if(def.sections.length<=1)fail('เอกสารต้องมีอย่างน้อยหนึ่ง Section');
  protectAnchors(section.source.fragment?.nodes);
  for(const n of Object.values(section.source.fragment?.nodes??{}))if(n.type==='area')removeArea(def,section,n);
  const i=def.sections.indexOf(section);def.sections.splice(i,1);
  return {sectionId:def.sections[Math.min(i,def.sections.length-1)].id};
}
export type MoveBinding={id:string;key:string;format:string};
export class FormatBindingRequired extends Error{
  constructor(message:string,readonly fields:MoveBinding[]){super(message);}
}
function rebindFormats(formats:Format[],source:Section,target:Section,area:boolean,bindings?:Record<string,string>){
  const required=new Map<string,MoveBinding>();
  const edits:{inline:Inline;id:string}[]=[];
  for(const format of formats){
    const refs=Object.values(format.fragment.nodes).flatMap(node=>node.type==='text-block'
      ?(node.children??[]).filter(i=>i.type==='field-ref'&&i.scope==='section'&&i.key):[]);
    const other=sectionBinding(format,new Set(refs));
    if(other)fail('Format '+format.key+' ผูกกับ '+other+' ของ Section '+source.label);
    for(const inline of refs){
      const key=inline.key!,id=area?JSON.stringify([format.key,key]):key;
      required.set(id,{id,key,format:format.key});
      edits.push({inline,id});
    }
  }
  const fields=[...required.values()];
  if(!fields.length)return;
  const first=fields[0];
  if(!bindings)throw new FormatBindingRequired('Format '+first.format+' ผูกกับ '+first.key+' ของ Section '+source.label,fields);
  for(const field of fields){
    const type=source.inputSchema.fields[field.key]?.type;
    if(!['string','link'].includes(type)||!own(bindings,field.id)||!own(target.inputSchema.fields,bindings[field.id])||
      target.inputSchema.fields[bindings[field.id]].type!==type)fail('เลือกตัวแปรปลายทางชนิดเดียวกับ '+field.key);
  }
  for(const {inline,id} of edits)inline.key=bindings[id];
}
function layoutColumn(def:Definition,at:Ref){
  const {node,fragment}=resolve(def,at);
  const index=Number(at.part?.slice(7));
  if(!at.band||!fragment||node?.type!=='columns'||!node.columns||at.part!=='column:'+index||!node.columns[index]?.childIds)
    throw Error('เลือกคอลัมน์ในชุดคอลัมน์บนกระดาษ');
  return {columns:node.columns,index,ids:node.columns[index].childIds!,fragment};
}
function move(def:Definition,at:Ref,to:Ref,bindings?:Record<string,string>):Ref {
  const from=resolve(def,at), target=resolve(def,to);
  if(to.part?.startsWith('column:')){
    const targetColumn=layoutColumn(def,to),node=from.node;
    if(!node||!from.fragment||from.host!==target.host||at.part||!['text-block','image','line'].includes(node.type))
      return fail('ย้ายได้เฉพาะข้อความ ภาพ หรือเส้นในชุดคอลัมน์เดียวกัน');
    const source=targetColumn.columns.find(column=>column.childIds?.includes(node.id));
    if(!source?.childIds||source.childIds===targetColumn.ids)return fail('เลือกคอลัมน์อื่นในชุดเดียวกัน');
    canDetach(from.host,from.fragment,node);
    source.childIds.splice(source.childIds.indexOf(node.id),1);targetColumn.ids.push(node.id);return at;
  }
  if(from.format&&!from.node){
    const area=areaIdOf(target.node);
    if(area===from.format.ownerAreaId)fail('เลือก Area ปลายทางที่ต่างจากเดิม');
    if(formatsFor(def,from.format.ownerAreaId).length<=1)fail('Area เดิมต้องเหลืออย่างน้อยหนึ่ง Format');
    key(from.format.key,Object.fromEntries(formatsFor(def,area).map(([,f])=>[f.key,true])));
    if(from.section!==target.section)rebindFormats([from.format],from.section,target.section,false,bindings);
    from.format.ownerAreaId=area;
    return {sectionId:to.sectionId,formatId:at.formatId};
  }
  const f=from.fragment,node=from.node;
  if(!f||!node)return fail('รายการนี้ย้ายไปปลายทางใหม่ไม่ได้');
  if(node.type==='area'){
    if(to.nodeId||to.formatId||to.band||from.section===target.section)fail('เลือก Section อื่นเป็นปลายทาง');
    if(node.props?.verticalAlign==='bottom')fail('Area ท้ายหน้าต้องคงตำแหน่งใน Section เดิม');
    const aid=areaIdOf(node), field=areaField(def,from.section,aid);
    const destination=authored(target.section);
    if(own(destination.nodes,node.id))fail('ปลายทางมี node id นี้อยู่แล้ว');
    if(field.schema===from.section.inputSchema){
      key(field.key,target.section.inputSchema.fields);
      target.section.inputSchema.fields[field.key]=field.field;
      delete field.schema.fields[field.key];
    }
    rebindFormats(formatsFor(def,aid).map(([,format])=>format),from.section,target.section,true,bindings);
    const ids=nodeList(f,node.id);ids.splice(ids.indexOf(node.id),1);
    delete f.nodes[node.id];if(!f.rootIds.length)from.section.source={kind:'blank'};
    destination.nodes[node.id]=node;insertRoot(destination,node.id);
    return {...to,nodeId:node.id};
  }
  const toCell=cellMoveTarget(from,target);
  const list=nodeList(f,node.id);list.splice(list.indexOf(node.id),1);toCell.childIds!.push(node.id);
  return {...to,nodeId:node.id};
}
function cellMoveTarget(from:ReturnType<typeof resolve>,target:ReturnType<typeof resolve>){
  const {node,fragment:f}=from;
  if(!node||!f)return fail('เลือกกล่องข้อความหรือรูปภาพ');
  if(!['text-block','image'].includes(node.type)||from.host!==target.host||target.node?.type!=='table-cell')
    fail('ย้ายข้อความหรือภาพได้ระหว่างเซลล์ในโครงเดียวกัน');
  const fromCell=owner(f,node.id), toCell=target.node!;
  const row=fromCell?owner(f,fromCell.id):undefined;
  if(fromCell?.type!=='table-cell'||toCell===fromCell||!row||owner(f,toCell.id)!==row||
    from.host.rowGroups?.some(group=>group.rowTemplateIds.includes(row.id)||group.memberRepeat.rowTemplateId===row.id||group.memberRepeat.emptyRowTemplateId===row.id)||from.host.cellRepeats?.some(r=>[fromCell.id,toCell.id].includes(r.cellId)))
    fail('เลือกเซลล์ในแถวเดียวกันที่ไม่ติดกฎกลุ่มแถวหรือการวนในเซลล์');
  canDetach(from.host,f,node);
  return toCell;
}
export function canMoveBetweenCells(def:Definition,at:Ref,to:Ref){
  try{cellMoveTarget(resolve(def,at),resolve(def,to));return true;}catch{return false;}
}
function layoutLength(length:Length){
  if(!['pt','mm'].includes(length.unit)||!Number.isFinite(lengthInPoints(length))||length.value<0)fail('กรอกระยะตั้งแต่ 0 ขึ้นไป');
}
function ensureCellContentWidth(table:DocNode,fragment:Fragment){
  const widths=(table.columns??[]).map(column=>column.width?lengthInPoints(column.width):0);
  for(const rowId of table.rowIds??[]){
    const row=fragment.nodes[rowId];
    for(const [index,cellId] of (row.cellIds??[]).entries()){
      const cell=fragment.nodes[cellId],props=cell.props;
      const start=props?.columnIndex??index;
      const width=widths.slice(start,start+(props?.colSpan??1)).reduce((sum,value)=>sum+value,0);
      const left=props?.padding?.left,right=props?.padding?.right;
      const inset=(left?lengthInPoints(left):defaultCellPadding)+(right?lengthInPoints(right):defaultCellPadding);
      if(!Number.isFinite(width)||width<=inset)fail('คอลัมน์แคบเกินระยะขอบในเซลล์ · เหลือพื้นที่ให้เนื้อหาด้วย');
    }
  }
}
export function applyStructureChange(source:Definition,change:Change):{definition:Definition;selection:Ref}{
  const affected=new Set<string>(), formats=new Set<string>();
  if('at' in change&&!(change.kind==='reorder'&&!change.at.nodeId)){
    affected.add(change.at.sectionId);
    if(change.at.formatId)formats.add(change.at.formatId);
  }
  if(change.kind==='move'){
    affected.add(change.to.sectionId);
    if(change.bindings){
      const {node}=resolve(source,change.at);
      if(node?.type==='area')for(const [id] of formatsFor(source,areaIdOf(node)))formats.add(id);
    }
    if(change.to.formatId)formats.add(change.to.formatId);
  }
  const def:Definition={...source,
    globalSchema:{...source.globalSchema,fields:{...source.globalSchema.fields}},
    sections:source.sections.map(section=>affected.has(section.id)?structuredClone(section):section),
    ...(source.areaFormats?{areaFormats:Object.fromEntries(Object.entries(source.areaFormats).map(([id,format])=>
      [id,formats.has(id)?structuredClone(format):format]))}:{})};

  let selection:Ref;
  if(change.kind==='section'){
    const label=change.label.trim(),id=uid();
    if(!label||label.length>128)fail('กรอกชื่อ Section 1–128 ตัวอักษร');
    def.sections.push({id,label,nameBase:label,sectionKey:'S'+id.replaceAll('-',''),
      pageLayoutId:def.book.defaultPageLayoutId,inputSchema:schema(),source:{kind:'blank'}});
    selection={sectionId:id};
  }else if(change.kind==='area'){
    const {section,node:cell,fragment,host}=resolve(def,change.at),aid=uid();
    if(change.at.formatId||change.at.band||(cell&&cell.type!=='table-cell'))fail('Area ต้องอยู่ใน Section หรือเซลล์เนื้อหาของ Section');
    if(cell&&fragment){
      const row=owner(fragment,cell.id),table=row&&owner(fragment,row.id);
      if(!row||!table||table.rowIds!.indexOf(row.id)<(table.props?.headerRowCount??0)||dynamicRow(host,row.id)||host.cellRepeats?.some(r=>r.cellId===cell.id))
        fail('Area วางได้เฉพาะเซลล์เนื้อหาที่ไม่ได้วนซ้ำ');
    }
    key(change.key,section.inputSchema.fields);
    if(!keyPattern.test(change.format))fail('กรอกชื่อ Format แรกเป็นภาษาอังกฤษ');
    section.inputSchema.fields[change.key]={type:'area',areaId:aid,required:false};
    const f=authored(section),node:DocNode={id:uid(),type:'area',props:{areaId:aid}};
    f.nodes[node.id]=node;
    if(cell)cell.childIds!.push(node.id);else insertRoot(f,node.id);
    makeFormat(def,aid,change.format);
    selection={sectionId:section.id,nodeId:node.id};
  }else if(change.kind==='format'){
    const id=makeFormat(def,areaIdOf(resolve(def,change.at).node),change.key);
    selection={sectionId:change.at.sectionId,formatId:id};
  }else if(change.kind==='node'){
    selection=addNode(def,change.at,change.type,change.source,change.pageField,change.position);
  }else if(change.kind==='column-boundary'){
    const {columns,index}=layoutColumn(def,change.at);
    const {left,fraction}=change;
    if(!Number.isInteger(left)||!(left===index||left===index-1)||!columns[left]||!columns[left+1]||!(fraction>0&&fraction<1))
      return fail('เลือกขอบร่วมระหว่างสองคอลัมน์');
    const total=(columns[left].weight??1)+(columns[left+1].weight??1);
    columns[left].weight=total*fraction;columns[left+1].weight=total*(1-fraction);
    selection=change.at;
  }else if(change.kind==='layout-column'){
    const {columns,index,ids}=layoutColumn(def,change.at);
    let next=index;
    if(change.action==='weight'){
      if(!Number.isFinite(change.weight)||!(change.weight!>0))return fail('สัดส่วนต้องมากกว่า 0');
      columns[index].weight=change.weight;
    }else if(change.action==='remove'){
      if(columns.length===1)return fail('ต้องเหลืออย่างน้อยหนึ่งคอลัมน์');
      for(const id of [...ids])remove(def,{...change.at,nodeId:id,part:undefined});
      columns.splice(index,1);next=Math.min(index,columns.length-1);
    }else{
      next=index+(change.action==='add-after'?1:0);
      columns.splice(next,0,{weight:columns[index].weight??1,childIds:[]});
    }
    selection={...change.at,part:'column:'+next};
  }else if(change.kind==='column-content'){
    const {fragment,ids}=layoutColumn(def,change.at);
    const node:DocNode=change.type==='line'?{id:uid(),type:'line',props:{}}:text(def);
    if(change.type==='text-block'){
      if(!change.text?.trim())return fail('กรอกข้อความที่จะวาง');
      node.children![0].text=change.text;
    }
    fragment.nodes[node.id]=node;ids.push(node.id);
    selection={...change.at,nodeId:node.id,part:undefined};
  }else if(change.kind==='spacer-height'){
    const {node}=resolve(def,change.at);
    if(node?.type!=='text-block'||node.children?.length||node.props?.heightMode!=='fixed'||!node.props.height)
      return fail('เลือกบล็อกเว้นระยะที่มีความสูงกำหนดไว้');
    layoutLength(change.length);
    if(change.length.value===0)return fail('ความสูงต้องมากกว่า 0');
    node.props.height=change.length;
    selection=change.at;
  }else if(change.kind==='line-spacing'){
    const {node}=resolve(def,change.at);
    if(node?.type!=='line')return fail('เลือกเส้นที่กำหนดระยะเว้น');
    layoutLength(change.length);
    (node.props??={})[change.side==='before'?'spaceBefore':'spaceAfter']=change.length;
    selection=change.at;
  }else if(change.kind==='paint'){
    const {node}=resolve(def,change.at);
    const target={color:'line',borderColor:'table',fillColor:'table-cell'}[change.property];
    if(!node||node.type!==target||!/^[0-9a-f]{6}$/i.test(change.value))return fail('ตรวจสอบสีและชิ้นส่วนที่เลือก');
    (node.props??={})[change.property]=change.value.toUpperCase();
    selection=change.at;
  }else if(change.kind==='row-break'){
    const {node,fragment}=resolve(def,change.at);
    if(node?.type!=='table-row'||!fragment)return fail('เลือกแถวในตาราง');
    const table=owner(fragment,node.id);
    if(!table||table.type!=='table'||table.rowIds!.indexOf(node.id)<(table.props?.headerRowCount??0))
      return fail('หัวตารางต้องอยู่ด้วยกัน');
    (node.props??={}).allowBreak=change.allowBreak;
    selection=change.at;
  }else if(change.kind==='table-divider'){
    const {left,fraction}=change;
    if(!Number.isInteger(left)||!Number.isFinite(fraction)||fraction<=0||fraction>=1)return fail('ระยะคอลัมน์ไม่ถูกต้อง');
    for(const ref of change.header?[change.at,change.header]:[change.at]){
      const {node,fragment}=resolve(def,ref);
      const first=node?.columns?.[left],second=node?.columns?.[left+1];
      if(node?.type!=='table'||!fragment||!first?.width||!second?.width)return fail('ไม่พบเส้นแบ่งคอลัมน์');
      const total=lengthInPoints(first.width)+lengthInPoints(second.width);
      first.width=pt(total*fraction);second.width=pt(total*(1-fraction));
      ensureCellContentWidth(node,fragment);
    }
    selection=change.cell;
  }else if(change.kind==='column-width'){
    const {node,fragment}=resolve(def,change.at);
    const column=node?.columns?.[change.column];
    if(node?.type!=='table'||!fragment||!column)return fail('เลือกคอลัมน์ในตาราง');
    layoutLength(change.length);
    if(change.length.value===0)return fail('ความกว้างคอลัมน์ต้องมากกว่า 0');
    column.width=change.length;
    ensureCellContentWidth(node,fragment);
    selection=change.at;
  }else if(change.kind==='cell-padding'){
    const {node,fragment}=resolve(def,change.at);
    if(node?.type!=='table-cell'||!fragment)return fail('เลือกเซลล์ในตาราง');
    const row=owner(fragment,node.id),table=row&&owner(fragment,row.id);
    if(table?.type!=='table')return fail('ไม่พบตารางของเซลล์');
    for(const value of Object.values(change.padding))layoutLength(value);
    const props=node.props??={};
    props.padding={...props.padding,...change.padding};
    ensureCellContentWidth(table,fragment);
    selection=change.at;
  }else if(change.kind==='tag-style'||change.kind==='remove-tag'){
    const {node}=resolve(def,change.at);
    const index=node?.children?.findIndex((part,i)=>'inline:'+(part.id??i)===change.at.part)??-1;
    const field=node?.children?.[index];
    if(!node?.children||field?.type!=='field-ref')return fail('เลือกแท็กตัวแปรก่อน');
    if(change.kind==='remove-tag'){
      node.children.splice(index,1);
      selection={...change.at,part:undefined};
    }else{
      if(field.textStyleId||change.at.band)return fail('แท็กนี้ใช้รูปแบบที่กำหนดไว้แล้ว');
      if(change.style.fontSizePt!==undefined&&(!Number.isFinite(change.style.fontSizePt)||change.style.fontSizePt<=0))return fail('ขนาดต้องมากกว่า 0');
      if(Object.keys(change.style).length)field.styleOverride={...change.style};
      else delete field.styleOverride;
      selection=change.at;
    }
  }else if(change.kind==='paragraph-style'){
    const {node}=resolve(def,change.at);
    if(node?.type!=='text-block'||!node.props||!Object.hasOwn(def.styles,change.styleId))return fail('เลือกกล่องข้อความและสไตล์ที่มีอยู่');
    node.props.textStyleId=change.styleId;
    selection=change.at;
  }else if(change.kind==='paragraph-parts'){
    const {node}=resolve(def,change.at);
    if(node?.type!=='text-block')return fail('เลือกย่อหน้าก่อน');
    node.children=change.parts;selection=change.at;
  }else if(change.kind==='inline-text'){
    const {node}=resolve(def,change.at);
    const index=node?.children?.findIndex((inline,i)=>'inline:'+(inline.id??i)===change.at.part)??-1;
    const inline=node?.children?.[index];
    if(inline?.type!=='text')return fail('เลือกข้อความคงที่ก่อนแก้');
    if(!change.text.trim())fail('กรอกข้อความก่อนยืนยัน');
    inline.text=change.text;
    selection=change.at;
  }else if(change.kind==='band-item-pages'){
    const {section,node}=resolve(def,change.at);
    const band=change.at.band&&section[change.at.band];
    if(!band||!node||change.at.part||change.at.formatId||!band.fragment.rootIds.includes(node.id))
      return fail('เลือกชิ้นงานที่อยู่ใต้หัวหรือท้ายกระดาษโดยตรง');
    const first=band.firstPageOnly?.filter(id=>id!==node.id)??[];
    if(change.mode==='first')first.push(node.id);
    setBandFirstPageItems(band,first);
    selection=change.at;
  }else if(change.kind==='insert-tag'){
    const {node}=resolve(def,change.at);
    const parts=node?.children;
    const i=parts?.findIndex((part,index)=>'inline:'+(part.id??index)===change.at.part)??-1;
    if(!parts||i<0)return fail('เลือกตำแหน่งแทรกอีกครั้ง');
    const source=parts[i],text=source.text??'',offset=change.offset;
    const tag={id:uid(),type:'field-ref',scope:change.scope,key:change.key};
    if(source.type!=='text'||offset===text.length)parts.splice(i+1,0,tag);
    else if(offset===0)parts.splice(i,0,tag);
    else {
      if(![...new Intl.Segmenter('th',{granularity:'grapheme'}).segment(text)].some(g=>g.index===offset))return fail('เลือกตำแหน่งระหว่างอักษร');
      parts.splice(i,1,{...source,text:text.slice(0,offset)},tag,{...source,id:uid(),text:text.slice(offset)});
    }
    selection={...change.at,part:'inline:'+tag.id};
  }else if(change.kind==='binding'){
    const {node}=resolve(def,change.at);
    if(node?.type!=='text-block'||!node.children)return fail('เลือกข้อความที่จะผูกตัวแปร');
    const existing=change.at.part?node.children.find((inline,i)=>'inline:'+(inline.id??i)===change.at.part):undefined;
    if(change.at.part&&existing?.type!=='field-ref')return fail('เลือกตัวแปรที่ผูกอยู่');
    const inline=existing??{id:uid(),type:'field-ref'};
    inline.scope=change.scope;inline.key=change.key;
    if(!existing)node.children.push(inline);
    selection={...change.at,part:change.at.part??'inline:'+inline.id};
  }else if(change.kind==='group'){
    selection=addGroup(def,change);
  }else if(change.kind==='merge'||change.kind==='split'){
    selection=changeCellSpan(def,change.at,change.kind);
  }else if(change.kind==='delete'){
    selection=remove(def,change.at);
  }else if(change.kind==='move'){
    selection=move(def,change.at,change.to,change.bindings);
  }else if(change.kind==='reorder'){
    const {section,host,fragment:f,node,format}=resolve(def,change.at);
    if(change.at.part||(!node&&(format||change.at.band)))fail('รายการนี้ไม่มีลำดับให้จัดใหม่');
    const ids=node&&f?nodeList(f,node.id):def.sections.map(s=>s.id);
    const distance=change.targetId===undefined?1:(ids.indexOf(change.targetId)-ids.indexOf(node?.id??section.id))*change.delta;
    if(change.targetId!==undefined&&(!ids.includes(change.targetId)||distance<=0))fail('ปลายทางต้องอยู่ในกลุ่มเดียวกัน');
    for(let step=0;step<distance;step++){
      if(node&&f)nodeReorder(host,f,node,ids,change.delta);
      else reorder(def.sections,section,change.delta);
    }
    selection=change.at;
  }
  else return fail('คำสั่งจัดโครงไม่รองรับ');
  return {definition:def,selection};
}
