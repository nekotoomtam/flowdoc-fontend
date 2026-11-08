export type Field = {type:string; items?:Schema; areaId?:string; required?:boolean};
export type Schema = {type?:'object'; fields:Record<string,Field>};
export type Inline = {id?:string; type:string; text?:string; key?:string; scope?:string; field?:string;value?:unknown;target?:unknown;url?:unknown};
export type Length = {unit:'pt'|'mm';value:number};
export type DocNode = {
  id:string; type:string; role?:{role:string};
  props?:{areaId?:string;verticalAlign?:string;colSpan?:number;rowSpan?:number;columnIndex?:number;
    anchorId?:unknown;headerRowCount?:number;repeatHeaderRows?:boolean;allowBreak?:boolean;textStyleId?:string;
    width?:Length;height?:Length;borderWidth?:Length;borderColor?:string;headerFillColor?:string;fillColor?:string;
    textAlign?:string;align?:string;color?:string;thickness?:Length;spaceBefore?:Length;spaceAfter?:Length;padding?:Partial<Record<'top'|'right'|'bottom'|'left',Length>>;source?:{scope:string;key:string}};
  rowIds?:string[];cellIds?:string[];childIds?:string[];
  columns?:{width?:Length;childIds?:string[];weight?:number}[];children?:Inline[];
};
export type Fragment = {rootIds:string[];nodes:Record<string,DocNode>};
type Repeat = {tableId:string;rowTemplateId:string;source?:{scope:string;key:string}};
type Group = {id:string;tableId:string;rowTemplateIds:string[];source:{scope:string;key:string};memberRepeat:{rowTemplateId:string;source:{scope:string;key:string};emptyRowTemplateId:string};pagination?:{keepStart:boolean}};
type CellRepeat = {id?:string;cellId:string;childTemplateIds:string[];source?:{scope:string;key:string}};
export type Host = {fragment?:Fragment;repeats?:Repeat[];rowGroups?:Group[];cellRepeats?:CellRepeat[]};
export type Format = Host & {key:string;label?:string;ownerAreaId:string;inputSchema:Schema;fragment:Fragment};
export type Band = Host & {inputSchema:Schema;fragment:Fragment;placement?:{mode:string;left:Length;right:Length;offset:Length};sizing?:{height?:Length};gap?:Length};
export type Section = {id:string;label:string;nameBase?:string;sectionKey:string;pageLayoutId?:string;
  inputSchema:Schema;source:Host & {kind:string};header?:Band;footer?:Band};
export type Definition = {nodeModelVersion:number;book:{defaultPageLayoutId:string};styles:Record<string,unknown>;
  pageLayouts?:Record<string,{page:{size:string;orientation?:string;margin?:Partial<Record<'top'|'right'|'bottom'|'left',Length>>}}>;
  sections:Section[];areaFormats?:Record<string,Format>;globalSchema:Schema};
export type Ref = {sectionId:string;formatId?:string;band?:'header'|'footer';nodeId?:string;part?:string};
export type Change = {kind:'section';label:string} | {kind:'area';at:Ref;key:string;format:string}
  | {kind:'format';at:Ref;key:string} | {kind:'node';at:Ref;type:string;source?:{scope:string;key:string};pageField?:'current'|'total';position?:{anchor:string;side:'before'|'after'}}
  | {kind:'inline-text';at:Ref;text:string}
  | {kind:'binding';at:Ref;scope:string;key:string}
  | {kind:'group';at:Ref;scope:'global'|'section'|'local';key:string;member:string}
  | {kind:'merge'|'split';at:Ref}
  | {kind:'reorder';at:Ref;delta:-1|1} | {kind:'move';at:Ref;to:Ref} | {kind:'delete';at:Ref};
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
function sectionScoped(value:unknown):boolean{
  if(!value||typeof value!=='object')return false;
  if('scope' in value&&value.scope==='section')return true;
  return Object.values(value).some(sectionScoped);
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
function move(def:Definition,at:Ref,to:Ref):Ref {
  const from=resolve(def,at), target=resolve(def,to);
  if(from.format&&!from.node){
    const area=areaIdOf(target.node);
    if(area===from.format.ownerAreaId)fail('เลือก Area ปลายทางที่ต่างจากเดิม');
    if(formatsFor(def,from.format.ownerAreaId).length<=1)fail('Area เดิมต้องเหลืออย่างน้อยหนึ่ง Format');
    key(from.format.key,Object.fromEntries(formatsFor(def,area).map(([,f])=>[f.key,true])));
    if(from.section!==target.section&&sectionScoped(from.format))fail('Format ใช้ตัวแปรของ Section เดิม');
    from.format.ownerAreaId=area;
    return {sectionId:to.sectionId,formatId:at.formatId};
  }
  const f=from.fragment,node=from.node;
  if(!f||!node)return fail('รายการนี้ย้ายไปปลายทางใหม่ไม่ได้');
  if(node.type==='area'){
    if(to.nodeId||to.formatId||to.band||from.section===target.section)fail('เลือก Section อื่นเป็นปลายทาง');
    if(node.props?.verticalAlign==='bottom')fail('Area ท้ายหน้าต้องคงตำแหน่งใน Section เดิม');
    const aid=areaIdOf(node), field=areaField(def,from.section,aid);
    if(formatsFor(def,aid).some(([,format])=>sectionScoped(format)))fail('Area มี Format ที่ใช้ตัวแปรของ Section เดิม');
    const destination=authored(target.section);
    if(own(destination.nodes,node.id))fail('ปลายทางมี node id นี้อยู่แล้ว');
    if(field.schema===from.section.inputSchema){
      key(field.key,target.section.inputSchema.fields);
      target.section.inputSchema.fields[field.key]=field.field;
      delete field.schema.fields[field.key];
    }
    const ids=nodeList(f,node.id);ids.splice(ids.indexOf(node.id),1);
    delete f.nodes[node.id];if(!f.rootIds.length)from.section.source={kind:'blank'};
    destination.nodes[node.id]=node;insertRoot(destination,node.id);
    return {...to,nodeId:node.id};
  }
  if(!['text-block','image'].includes(node.type)||from.host!==target.host||target.node?.type!=='table-cell')
    fail('ย้ายข้อความหรือภาพได้ระหว่างเซลล์ในโครงเดียวกัน');
  const fromCell=owner(f,node.id), toCell=target.node!;
  const row=fromCell?owner(f,fromCell.id):undefined;
  if(fromCell?.type!=='table-cell'||toCell===fromCell||!row||owner(f,toCell.id)!==row||
    dynamicRow(from.host,row.id)||from.host.cellRepeats?.some(r=>[fromCell.id,toCell.id].includes(r.cellId)))
    fail('เลือกเซลล์อื่นในแถวเดียวกันที่ไม่มีการวนซ้ำ');
  canDetach(from.host,f,node);
  const list=nodeList(f,node.id);list.splice(list.indexOf(node.id),1);toCell.childIds!.push(node.id);
  return {...to,nodeId:node.id};
}
export function applyStructureChange(source:Definition,change:Change):{definition:Definition;selection:Ref}{
  const affected=new Set<string>(), formats=new Set<string>();
  if('at' in change&&!(change.kind==='reorder'&&!change.at.nodeId)){
    affected.add(change.at.sectionId);
    if(change.at.formatId)formats.add(change.at.formatId);
  }
  if(change.kind==='move'){
    affected.add(change.to.sectionId);
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
  }else if(change.kind==='inline-text'){
    const {node}=resolve(def,change.at);
    const index=node?.children?.findIndex((inline,i)=>'inline:'+(inline.id??i)===change.at.part)??-1;
    const inline=node?.children?.[index];
    if(inline?.type!=='text')return fail('เลือกข้อความคงที่ก่อนแก้');
    if(!change.text.trim())fail('กรอกข้อความก่อนยืนยัน');
    inline.text=change.text;
    selection=change.at;
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
    selection=move(def,change.at,change.to);
  }else if(change.kind==='reorder'){
    const {section,host,fragment:f,node,format}=resolve(def,change.at);
    if(node&&f){
      canDetach(host,f,node);
      const list=nodeList(f,node.id),parent=owner(f,node.id);
      const min=parent?.type==='table'?(parent.props?.headerRowCount??0):0;
      reorder(list,node.id,change.delta,min);
      if(list===f.rootIds&&list.slice(0,-1).some(id=>f.nodes[id].props?.verticalAlign==='bottom'))fail('Area ท้ายหน้าต้องอยู่ท้าย Section');
    }else if(!format&&!change.at.band)reorder(def.sections,section,change.delta);
    else fail('รายการนี้ไม่มีลำดับให้จัดใหม่');
    selection=change.at;
  }
  else return fail('คำสั่งจัดโครงไม่รองรับ');
  return {definition:def,selection};
}
