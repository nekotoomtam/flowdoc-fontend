import './phase1-editor.css';

import {applyStructureChange, groupSources, refKey} from './editor-structure';
import type {Band, Change, Definition, DocNode, Format, Fragment, Ref, Schema, Section} from './editor-structure';

type Draft = {templateId:string;name:string;revision:number;fingerprint:string;definition:Definition};
type Outline = {id:string;ref:Ref;label:string;type:string;section:Section;format?:Format;children:Outline[];parent?:Outline;node?:DocNode;band?:Band};
type DrawPage = {
  widthPt: number; heightPt: number; backgroundColor: string;
  sampleImages?: {xPt:number; yPt:number; widthPt:number; heightPt:number; color:string}[];
  fills?: {xPt: number; yPt: number; widthPt: number; heightPt: number; color: string}[];
  borders?: {x1Pt: number; y1Pt: number; x2Pt: number; y2Pt: number; widthPt: number; color: string}[];
  lines: {text: string; xPt: number; yPt: number; fontSizePt: number; baselineOffsetPt: number; color: string; weight: number}[];
};
type Preview = {revision: number; fingerprint: string; engineVersion: string; engineMs: number; renderMs: number; layoutHash: string; pdfHash: string; pageCount: number; pages: DrawPage[]};
type ServiceReply = {ok: boolean; value?: Draft; issues?: {code: string; path?:string}[]};
const q = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id)! as T;
const title = q('title'), status = q('status'), editor = q('editor'), tree = q('tree'), paper = q('paper'), variables = q('variables');
const form = q<HTMLFormElement>('rename'), input = q<HTMLInputElement>('section-name'), save = q<HTMLButtonElement>('save');
const defineTab = q<HTMLButtonElement>('define-tab'), previewTab = q<HTMLButtonElement>('preview-tab');
const conflict = q('conflict'), previewPanel = q('preview'), previewStatus = q('preview-status'), previewPaper = q('preview-paper');
const previous = q<HTMLButtonElement>('previous-page'), next = q<HTMLButtonElement>('next-page'), refreshPreview = q<HTMLButtonElement>('refresh-preview');
const templateId = new URLSearchParams(location.search).get('id');
const endpoint = '/api/editor-phase1/drafts/' + encodeURIComponent(templateId ?? '');
const kinds: Record<string,string> = {section:'Section',area:'Area',format:'Format',table:'ตาราง','table-row':'แถว','table-cell':'เซลล์','text-block':'ข้อความ','page-break':'ขึ้นหน้าใหม่',image:'ภาพ',line:'เส้น','table-of-contents':'สารบัญ'};
const treeNodes = new Map<Outline, HTMLButtonElement>();
const rootRows=new Map<Outline,HTMLLIElement>();
const paperNodes = new Map<Outline, HTMLButtonElement>();
let savedDefinition:Definition|undefined;
let draft: Draft, selection: Outline | undefined, paperSection: Section | undefined;
let roots:Outline[] = [], outlines=new Map<string,Outline>();
const expanded=new Map<string,boolean>();
const history:{definition:Definition;selection:Ref}[]=[];
let variableContext:Outline|undefined;
let isSaving = false, isLoading = false, hasConflict = false, showingPreview = false;
let preview: Preview | undefined, pendingPreview: AbortController | undefined, pageIndex = 0;

const element = <K extends keyof HTMLElementTagNameMap>(tag: K, label?: string) => {
  const item = document.createElement(tag);
  if (label !== undefined) item.textContent = label;
  return item;
};
const button = (label: string, run: () => void) => {
  const item = element('button', label);
  item.type = 'button';
  item.addEventListener('click', run);
  return item;
};
function afterPaint(name: string, started: number, detail?: unknown) {
  requestAnimationFrame(() => requestAnimationFrame(() => performance.measure(name, {start:started, detail})));
}
function outline(section: Section): Outline {
  const root: Outline = {id:section.id, ref:{sectionId:section.id},label:section.label, type:'section',section,children:[]};
  function nodes(fragment: Fragment, ids: string[], parent: Outline, format?: Format): Outline[] {
    return ids.map((id, position) => {
      const node = fragment.nodes[id];
      const areaField = node.type==='area' ? [section.inputSchema, draft.definition.globalSchema].flatMap(s=>Object.entries(s.fields))
        .find(([,f])=>f.type==='area'&&f.areaId===node.props?.areaId)?.[0] : undefined;
      const inline = node.children?.map(x=>x.type==='field-ref'?'{{'+x.key+'}}':x.text??'').join('');
      const label = areaField ?? (inline || (['table-row','table-cell'].includes(node.type) ? kinds[node.type]+' '+(position+1) : kinds[node.type]??node.type));
      const result: Outline = {id,ref:{...parent.ref,nodeId:id},label,type:node.type,section,node,format,parent,band:parent.band,children:[]};
      if (node.type==='area') {
        result.children = Object.entries(draft.definition.areaFormats??{}).filter(([,f])=>f.ownerAreaId===node.props?.areaId).map(([formatId,f])=>{
          const item: Outline = {id:formatId,ref:{sectionId:section.id,formatId},label:f.label??f.key,type:'format',section,parent:result,format:f,children:[]};
          item.children=nodes(f.fragment,f.fragment.rootIds,item,f);
          return item;
        });
      } else {
        result.children=nodes(fragment,node.rowIds??node.cellIds??node.childIds??(node.type==='columns'?node.columns?.flatMap(c=>c.childIds??[]):undefined)??[],result,format);
      }
      return result;
    });
  }
  const fragment=section.source.fragment;
  const makeBand = (band:Band, type:string, label:string) => {
    const part:Outline={id:section.id+'-'+type,ref:{sectionId:section.id,band:type as 'header'|'footer'},label,type,section,parent:root,band,children:[]};
    part.children=nodes(band.fragment,band.fragment.rootIds,part);
    return part;
  };
  if(section.header)root.children.push(makeBand(section.header,'header','หัวกระดาษ'));
  if(fragment)root.children.push(...nodes(fragment,fragment.rootIds,root));
  if(section.footer)root.children.push(makeBand(section.footer,'footer','ท้ายกระดาษ'));
  return root;
}
function drawBranch(items: Outline[], depth = 0) {
  const list = element('ul');
  list.className='tree';
  for (const item of items) {
    const prior=depth===0?rootRows.get(item):undefined;
    if(prior){list.append(prior);continue;}
    const li=element('li'), row=element('div');
    row.className='tree-row';
    const itemButton=button(item.label,()=>select(item,true));
    itemButton.dataset.kind=item.type;
    itemButton.dataset.nodeId=item.id;
    itemButton.dataset.ref=refKey(item.ref);
    treeNodes.set(item,itemButton);
    const type=element('small',kinds[item.type]??item.type);
    type.className='type';
    const toggle=button('▸',()=>{
      if (!branch) branch=li.appendChild(drawBranch(item.children,depth+1));
      branch.hidden=toggle.getAttribute('aria-expanded')==='true';
      toggle.setAttribute('aria-expanded',String(!branch.hidden));
      expanded.set(refKey(item.ref),!branch.hidden);
      toggle.textContent=branch.hidden?'▸':'▾';
      if(selection)treeNodes.get(selection)?.setAttribute('aria-current','true');
    });
    toggle.className='toggle';
    toggle.setAttribute('aria-label','ขยายหรือยุบ '+item.label);
    const open=item.children.length>0&&(expanded.get(refKey(item.ref))??depth<2);
    toggle.setAttribute('aria-expanded',String(open));
    toggle.hidden=!item.children.length;
    row.append(toggle,itemButton,type);
    li.append(row);
    let branch: HTMLUListElement|undefined;
    if(open){
      branch=li.appendChild(drawBranch(item.children,depth+1));
      toggle.textContent='▾';
    }
    if(depth===0)rootRows.set(item,li);
    list.append(li);
  }
  return list;
}
function drawPaper(root: Outline) {
  paperNodes.clear();
  const choose = (item: Outline, label = item.label) => {
    const control=button(label,()=>select(item,false));
    paperNodes.set(item,control);
    return control;
  };
  function contents(item: Outline): HTMLElement {
    const block=element('div');
    if(item.type==='table'){
      const table=element('table'), body=element('tbody');
      block.append(choose(item,'เลือกตาราง'),table);table.append(body);
      for(const row of item.children){
        const tr=element('tr');
        for(const cell of row.children){
          const td=element('td');
          td.colSpan=cell.node?.props?.colSpan??1;td.rowSpan=cell.node?.props?.rowSpan??1;
          td.append(choose(cell),...cell.children.map(contents));tr.append(td);
        }
        body.append(tr);
      }
    }else{
      block.append(choose(item),...item.children.map(contents));
    }
    return block;
  }
  paper.replaceChildren(choose(root),...root.children.map(contents));
  paperSection=root.section;
}
function drawVariables(item: Outline) {
  if(variableContext?.section===item.section&&variableContext.format===item.format&&variableContext.band===item.band)return;
  variableContext=item;
  const scopes: [string,Schema][]=[['ทั้งเอกสาร',draft.definition.globalSchema],['ส่วนเอกสาร',item.section.inputSchema]];
  if(item.band)scopes.push(['หัว–ท้ายกระดาษ',item.band.inputSchema]);
  if(item.format)scopes.push(['รูปแบบ · '+item.format.key,item.format.inputSchema]);
  function fieldList(schema: Schema): HTMLUListElement {
    const list=element('ul');
    for(const [name,f] of Object.entries(schema.fields)){
      const li=element('li',name+' · '+f.type);
      if(f.items)li.append(fieldList(f.items));
      list.append(li);
    }
    return list;
  }
  variables.replaceChildren(...scopes.map(([label,schema])=>{
    const scope=element('details');
    scope.className='scope';
    scope.open=true;
    scope.append(element('summary',label));
    scope.append(Object.keys(schema.fields).length?fieldList(schema):element('p','ยังไม่มีตัวแปร'));
    return scope;
  }));
}
function select(item: Outline, measure: boolean) {
  const started=performance.now();
  if(selection) {
    treeNodes.get(selection)?.removeAttribute('aria-current');
    paperNodes.get(selection)?.removeAttribute('aria-current');
  }
  selection=item;
  const currentControl=treeNodes.get(item);
  if(!currentControl||currentControl.closest("[hidden]")){
    reveal(item);
    const scroll=tree.scrollTop;
    treeNodes.clear();rootRows.clear();tree.replaceChildren(drawBranch(roots));tree.scrollTop=scroll;
  }
  let root=item;
  const path=[root.label];
  while(root.parent){root=root.parent;path.unshift(root.label);}
  if(paperSection!==item.section)drawPaper(root);
  treeNodes.get(item)?.setAttribute('aria-current','true');
  paperNodes.get(item)?.setAttribute('aria-current','true');
  q('selection').textContent=item.label;
  q('path').textContent=path.join(' › ');
  form.hidden=item.type!=='section';
  if(item.type==='section'&&!hasConflict) input.value=item.label;
  if(!hasConflict)status.textContent='';
  drawVariables(item);
  showActions(item);
  if(measure)afterPaint('flowdoc:tree-selection',started,{type:item.type});
}
function reveal(item:Outline){
  for(let parent=item.parent;parent;parent=parent.parent)expanded.set(refKey(parent.ref),true);
}
const isDirty=()=>Boolean(draft&&draft.definition!==savedDefinition);
function confirmNavigation(event:BeforeUnloadEvent){event.preventDefault();event.returnValue='';}
function refreshButtons(){
  const dirty=isDirty();
  q('structure-pending').hidden=!dirty;
  if(dirty)window.addEventListener('beforeunload',confirmNavigation);
  else window.removeEventListener('beforeunload',confirmNavigation);
  q<HTMLButtonElement>('save-structure').disabled=isSaving||hasConflict;
  q<HTMLButtonElement>('undo-structure').disabled=isSaving||hasConflict||!history.length;
  q<HTMLButtonElement>('discard-structure').disabled=isSaving||hasConflict;
  q<HTMLButtonElement>('add-section').disabled=isSaving||hasConflict;
  previewTab.disabled=dirty;
  save.disabled=dirty||isSaving||hasConflict;
  input.readOnly=dirty||isSaving;
  if(selection)showActions(selection);
}
function showDraft(data: Draft, keep?: Ref) {
  draft=data;
  title.textContent=data.name;
  q('revision').textContent='Model 20 · Revision '+data.revision;
  const prior=new Map(roots.map(root=>[root.section,root]));
  roots=data.definition.sections.map(section=>prior.get(section)??outline(section));
  outlines=new Map();
  const index=(item:Outline)=>{outlines.set(refKey(item.ref),item);item.children.forEach(index);};
  roots.forEach(index);
  for(const key of expanded.keys())if(!outlines.has(key))expanded.delete(key);
  const selected=(keep&&outlines.get(refKey(keep)))??roots[0];
  reveal(selected);
  const scroll=tree.scrollTop;
  if(selection){
    treeNodes.get(selection)?.removeAttribute('aria-current');
    paperNodes.get(selection)?.removeAttribute('aria-current');
  }
  selection=undefined;
  for(const item of treeNodes.keys())if(outlines.get(refKey(item.ref))!==item)treeNodes.delete(item);
  for(const item of rootRows.keys())if(!roots.includes(item))rootRows.delete(item);
  tree.replaceChildren(drawBranch(roots));
  tree.scrollTop=scroll;
  select(selected,false);
  refreshButtons();
  editor.hidden=showingPreview;
  document.body.dataset.revision=String(data.revision);
}
const dialog=q<HTMLDialogElement>('structure-dialog'), actionForm=q<HTMLFormElement>('structure-form');
type FormField={key:string;label:string;options?:[string,string][]};
function ask(title:string, fields:FormField[], run:(values:Record<string,string>)=>void, note?:string){
  actionForm.replaceChildren(element('h2',title));
  if(note)actionForm.append(element('p',note));
  const controls=new Map<string,HTMLInputElement|HTMLSelectElement>();
  for(const field of fields){
    const label=element('label',field.label);
    const control=field.options?element('select'):element('input');
    control.required=true;control.name=field.key;
    if(control instanceof HTMLSelectElement)for(const [value,text] of field.options??[]){
      const option=element('option',text);option.value=value;control.append(option);
    }
    controls.set(field.key,control);label.append(control);actionForm.append(label);
  }
  const error=element('p');error.id='structure-error';error.setAttribute('role','alert');
  const submit=element('button','ยืนยัน');submit.type='submit';submit.className='primary';
  actionForm.append(error,submit,button('ยกเลิก',()=>dialog.close()));
  actionForm.onsubmit=event=>{
    event.preventDefault();
    try{run(Object.fromEntries([...controls].map(([key,el])=>[key,el.value.trim()])));dialog.close();}
    catch(e){error.textContent=e instanceof Error?e.message:'แก้โครงไม่สำเร็จ';}
  };
  dialog.showModal();
}
function stage(change:Change){
  if(isSaving||hasConflict)return;
  const started=performance.now();
  const result=applyStructureChange(draft.definition,change);
  history.push({definition:draft.definition,selection:selection!.ref});
  if(history.length>20)history.shift();
  cancelPreview();
  showDraft({...draft,definition:result.definition},result.selection);
  status.textContent='ปรับในฉบับร่างแล้ว · กดตรวจและบันทึกโครงเมื่อพร้อม';
  afterPaint('flowdoc:structure-edit',started,{action:change.kind});
}
function outlinePath(item:Outline){
  const labels=[item.label];for(let p=item.parent;p;p=p.parent)labels.unshift(p.label);
  return labels.join(' › ');
}
function destinations(item:Outline){
  if(item.type==='area')return roots.filter(x=>x.section!==item.section);
  if(item.type==='format')return [...outlines.values()].filter(x=>x.type==='area'&&x!==item.parent);
  if(['text-block','image'].includes(item.type)&&item.parent?.type==='table-cell')
    return (item.parent.parent?.children??[]).filter(x=>x!==item.parent);
  return [];
}
function showActions(item:Outline){
  const actions=q('actions');actions.replaceChildren();
  const add=(name:string,run:()=>void)=>{
    const control=button(name,run);control.disabled=isSaving||hasConflict;actions.append(control);
  };
  const at=item.ref;
  const promptKey=(label:string,run:(key:string)=>void)=>ask(label,[{key:'key',label:'ชื่อในนิยาม'}],v=>run(v.key));
  if(item.type==='section'||(item.type==='table-cell'&&!at.formatId&&!at.band)){
    add('+ เพิ่ม Area',()=>ask('เพิ่ม Area พร้อม Format แรก',[{key:'key',label:'ชื่อ Area'},{key:'format',label:'ชื่อ Format แรก'}],v=>stage({kind:'area',at,key:v.key,format:v.format}),
      'Core ต้องมี Format อย่างน้อยหนึ่งตัวต่อ Area'));
  }
  if(item.type==='area')add('+ เพิ่ม Format',()=>promptKey('เพิ่ม Format ใน '+item.label,key=>stage({kind:'format',at,key})));
  const options:[string,string][] = item.type==='table-cell'?[['text-block','ข้อความ']]
    : ['header','footer'].includes(item.type)?[['text-block','ข้อความ'],['line','เส้น']]
    : ['section','format'].includes(item.type)?[['text-block','ข้อความ'],['table','ตาราง 2 คอลัมน์'],['line','เส้น'],['page-break','ขึ้นหน้าใหม่']]:[];
  if(options.length)add('+ เพิ่ม node',()=>ask('เพิ่ม node ใน '+item.label,[{key:'type',label:'ชนิด node',options}],v=>stage({kind:'node',at,type:v.type})));
  if(item.type==='table'){
    add('+ เพิ่มแถว',()=>tryStage({kind:'node',at,type:'table-row'}));
    add('+ เพิ่ม Row Group',()=>{
      const sources=groupSources(draft.definition,at);
      if(!sources.length){status.textContent='ตารางนี้ต้องมีตัวแปรรายการกลุ่มและรายการสมาชิกที่ประกาศไว้ก่อน';return;}
      ask('สร้าง Row Group',[{key:'source',label:'ตัวแปรกลุ่ม → รายการสมาชิก',
        options:sources.map((x,i)=>[String(i),x.scope+': '+x.key+'[] › '+x.member+'[]'])}],
        v=>stage({kind:'group',at,...sources[Number(v.source)]}),
        'เพิ่มแถวเริ่มกลุ่ม แถวสมาชิก และแถวกรณีไม่มีสมาชิกเป็นชุดเดียวกัน');
    });
  }
  if(item.type==='table-cell'){
    add('ผสานกับเซลล์ขวา',()=>tryStage({kind:'merge',at}));
    add('แยกเซลล์',()=>tryStage({kind:'split',at}));
  }
  if(item.type==='section'||(item.node&&item.type!=='table-cell')){
    add('เลื่อนขึ้น',()=>tryStage({kind:'reorder',at,delta:-1}));
    add('เลื่อนลง',()=>tryStage({kind:'reorder',at,delta:1}));
  }
  if(['area','format','text-block','image'].includes(item.type)){
    add('ย้ายไป…',()=>{
      const targets=destinations(item);
      if(!targets.length){status.textContent='ไม่มีปลายทางสำหรับรายการนี้';return;}
      ask('ย้าย '+item.label,[{key:'target',label:'ตำแหน่งใหม่',options:targets.map(x=>[refKey(x.ref),outlinePath(x)])}],
        v=>stage({kind:'move',at,to:outlines.get(v.target)!.ref}));
    });
  }
  if(item.type!=='table-cell'){
    add('ลบรายการนี้',()=>ask('ลบ '+item.label,[],()=>stage({kind:'delete',at}),
      item.children.length?'รายการย่อยของส่วนนี้จะถูกลบไปด้วย · '+outlinePath(item):outlinePath(item)));
  }
}
function tryStage(change:Change){
  try{stage(change);}catch(e){status.textContent=e instanceof Error?e.message:'แก้โครงไม่สำเร็จ';}
}
q('add-section').addEventListener('click',()=>ask('เพิ่ม Section',[{key:'label',label:'ชื่อส่วนเอกสาร'}],v=>stage({kind:'section',label:v.label})));
q('undo-structure').addEventListener('click',()=>{
  if(isSaving||hasConflict)return;
  const prior=history.pop();
  if(!prior)return;
  showDraft({...draft,definition:prior.definition},prior.selection);
  status.textContent='ย้อนการแก้โครงขั้นล่าสุดแล้ว';
});
q('discard-structure').addEventListener('click',()=>{
  if(isSaving||hasConflict||!savedDefinition)return;
  ask('ยกเลิกการแก้โครงทั้งหมด',[],()=>{
    history.length=0;showDraft({...draft,definition:savedDefinition!},selection?.ref);
    status.textContent='กลับไปใช้โครงที่บันทึกล่าสุดแล้ว';
  },'การแก้ในหน้านี้จะถูกทิ้ง');
});
q('save-structure').addEventListener('click',async()=>{
  if(!isDirty()||isSaving||hasConflict)return;
  const started=performance.now(), keep=selection?.ref;
  isSaving=true;refreshButtons();
  status.textContent='กำลังตรวจโครงกับ Core และบันทึก…';
  try{
    const response=await fetch(endpoint+'/structure',{method:'PUT',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({definition:draft.definition,expectedRevision:draft.revision,idempotencyKey:crypto.randomUUID()}),
      signal:AbortSignal.timeout(20000)});
    const result=await response.json() as ServiceReply;
    if(response.status===409&&result.issues?.[0]?.code==='STALE_CURRENT'){
      hasConflict=true;conflict.hidden=false;status.textContent='มีฉบับใหม่กว่า · การแก้โครงในหน้านี้ยังอยู่';return;
    }
    if(!response.ok||!result.ok||!result.value){
      const issue=result.issues?.[0];
      status.textContent=issue?'Core ไม่รับโครงนี้ · '+issue.code+' · '+(issue.path??''):'ยังยืนยันผลบันทึกไม่ได้ · การแก้ยังอยู่';
      return;
    }
    history.length=0;savedDefinition=result.value.definition;cancelPreview();showDraft(result.value,keep);
    status.textContent='ตรวจและบันทึกโครงแล้ว · Revision '+draft.revision;
    afterPaint('flowdoc:structure-save',started,{revision:draft.revision});
  }catch{status.textContent='ยังยืนยันผลบันทึกไม่ได้ · การแก้ยังอยู่';}
  finally{isSaving=false;refreshButtons();}
});
async function readDraft() {
  const response=await fetch(endpoint,{signal:AbortSignal.timeout(15000)});
  const reply=await response.json() as ServiceReply;
  if(!response.ok||!reply.ok||!reply.value||reply.value.templateId!==templateId||
    reply.value.definition.nodeModelVersion!==20||!reply.value.definition.sections.length)throw Error('Draft unavailable');
  return reply.value;
}
function cancelPreview() {
  pendingPreview?.abort();pendingPreview=undefined;
  preview=undefined;previewPaper.replaceChildren();
  delete previewPaper.dataset.revision;
  q('page-number').textContent='';
  previous.disabled=true;next.disabled=true;
}
async function load() {
  if(isLoading)return;
  isLoading=true;
  const started=performance.now();
  q<HTMLButtonElement>('reload').disabled=true;
  try{
    const data=await readDraft();
    cancelPreview();
    hasConflict=false;history.length=0;savedDefinition=data.definition;conflict.hidden=true;
    showDraft(data);
    const fromCard=Number(sessionStorage.getItem('flowdoc:open:'+templateId));
    sessionStorage.removeItem('flowdoc:open:'+templateId);
    afterPaint('flowdoc:open-definition',started,{revision:data.revision});
    const offset=fromCard-performance.timeOrigin;
    if(fromCard&&offset<=started&&started-offset<20000)afterPaint('flowdoc:open-from-library',offset<0?0:offset,{revision:data.revision,navigationMs:offset<0?-offset:0});
    if(showingPreview)void loadPreview();
  }catch{
    status.textContent='เปิดโครงทดสอบไม่ได้ กรุณาโหลดหน้าใหม่';
  }finally{
    isLoading=false;q<HTMLButtonElement>('reload').disabled=false;
  }
}
function svg(name: string, attrs: Record<string,string|number>) {
  const item=document.createElementNS('http://www.w3.org/2000/svg',name);
  for(const [key,value] of Object.entries(attrs))item.setAttribute(key,String(value));
  return item;
}
const color=(value:string)=>value.startsWith('#')?value:'#'+value;
function showPage() {
  if(!preview)return;
  const page=preview.pages[pageIndex];
  const sheet=svg('svg',{viewBox:'0 0 '+page.widthPt+' '+page.heightPt,role:'img','aria-label':'กระดาษ Engine หน้า '+(pageIndex+1)});
  sheet.append(svg('rect',{width:page.widthPt,height:page.heightPt,fill:color(page.backgroundColor)}));
  for(const f of page.fills??[])sheet.append(svg('rect',{x:f.xPt,y:f.yPt,width:f.widthPt,height:f.heightPt,fill:color(f.color)}));
  for(const image of page.sampleImages??[])sheet.append(svg('rect',{x:image.xPt,y:image.yPt,width:image.widthPt,height:image.heightPt,fill:color(image.color)}));
  for(const b of page.borders??[])sheet.append(svg('line',{x1:b.x1Pt,y1:b.y1Pt,x2:b.x2Pt,y2:b.y2Pt,stroke:color(b.color),'stroke-width':b.widthPt}));
  for(const line of page.lines){
    const text=svg('text',{x:line.xPt,y:line.yPt+line.baselineOffsetPt,fill:color(line.color),'font-size':line.fontSizePt,'font-weight':line.weight,'xml:space':'preserve'});
    text.textContent=line.text;
    sheet.append(text);
  }
  previewPaper.replaceChildren(sheet);
  previewPaper.dataset.revision=String(preview.revision);
  q('page-number').textContent=(pageIndex+1)+' / '+preview.pageCount;
  previous.disabled=pageIndex===0;next.disabled=pageIndex===preview.pageCount-1;
}
async function loadPreview() {
  if(!draft||pendingPreview)return;
  const started=performance.now(), revision=draft.revision, fingerprint=draft.fingerprint;
  const request=new AbortController();pendingPreview=request;
  refreshPreview.disabled=true;
  previewStatus.textContent='กำลังจัดหน้า Revision '+revision+'…';
  try{
    const response=await fetch(endpoint+'/preview',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({expectedRevision:revision}),signal:AbortSignal.any([request.signal,AbortSignal.timeout(30000)])});
    if(response.status===409){previewStatus.textContent='ฉบับนี้มี revision ใหม่กว่าในระบบ กรุณาโหลดฉบับล่าสุด';return;}
    const data=await response.json() as Preview;
    if(!response.ok||!data.pages?.length||data.revision!==revision||data.fingerprint!==fingerprint)throw Error('Preview unavailable');
    await Promise.all([document.fonts.load('300 12px FlowDocLab'),document.fonts.load('400 12px FlowDocLab')]);
    if(pendingPreview!==request||draft.revision!==revision||!showingPreview)return;
    preview=data;pageIndex=0;showPage();
    previewStatus.textContent='Core '+data.engineVersion+' · Revision '+revision+' · '+data.pageCount+' หน้า';
    afterPaint('flowdoc:engine-preview',started,{revision,pageCount:data.pageCount,engineMs:data.engineMs,renderMs:data.renderMs,layoutHash:data.layoutHash,pdfHash:data.pdfHash});
  }catch{
    if(!request.signal.aborted)previewStatus.textContent='จัดหน้าทดลองไม่สำเร็จ ลองจัดหน้าใหม่อีกครั้ง';
  }finally{
    if(pendingPreview===request){pendingPreview=undefined;refreshPreview.disabled=false;}
  }
}
function changeMode(toPreview: boolean) {
  showingPreview=toPreview;previewPanel.hidden=!toPreview;editor.hidden=toPreview;
  defineTab.setAttribute('aria-pressed',String(!toPreview));previewTab.setAttribute('aria-pressed',String(toPreview));
  if(toPreview&&!preview)void loadPreview();
  if(!toPreview&&pendingPreview){cancelPreview();refreshPreview.disabled=false;}
}
form.addEventListener('submit',async event=>{
  event.preventDefault();
  const item=selection,label=input.value.trim();
  if(!item||item.type!=='section'||!label||isSaving||hasConflict||isDirty())return;
  if(label===item.section.label){status.textContent='ชื่อส่วนยังเหมือนเดิม';return;}
  isSaving=true;refreshButtons();
  status.textContent='กำลังบันทึก…';
  try{
    const response=await fetch(endpoint,{method:'PUT',headers:{'Content-Type':'application/json'},signal:AbortSignal.timeout(15000),
      body:JSON.stringify({sectionId:item.id,label,expectedRevision:draft.revision,idempotencyKey:crypto.randomUUID()})});
    const reply=await response.json() as ServiceReply;
    if(response.status===409&&reply.issues?.[0]?.code==='STALE_CURRENT'){
      hasConflict=true;conflict.hidden=false;
      // Preserve the attempted text until the user explicitly reloads.
      status.textContent='บันทึกไม่ได้ ฉบับที่เปิดอยู่เก่ากว่าฉบับล่าสุด';
      return;
    }
    if(!response.ok||!reply.ok||!reply.value||reply.value.templateId!==templateId)throw Error('Save failed');
    const data=reply.value;
    savedDefinition=data.definition;
    cancelPreview();showDraft(data,item.ref);
    status.textContent='บันทึกแล้ว · Revision '+data.revision;
    if(showingPreview)void loadPreview();
  }catch{
    status.textContent='ยังยืนยันผลบันทึกไม่ได้ ชื่อที่พิมพ์ยังอยู่';
  }finally{
    isSaving=false;refreshButtons();
  }
});
q('reload').addEventListener('click',()=>void load());
previewTab.addEventListener('click',()=>changeMode(true));
defineTab.addEventListener('click',()=>changeMode(false));
previous.addEventListener('click',()=>{if(pageIndex>0){pageIndex--;showPage();}});
next.addEventListener('click',()=>{if(preview&&pageIndex<preview.pageCount-1){pageIndex++;showPage();}});
refreshPreview.addEventListener('click',()=>{cancelPreview();void loadPreview();});
void load();
