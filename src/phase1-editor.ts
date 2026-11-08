import './phase1-editor.css';

type Field = {type: string; items?: Schema; areaId?: string};
type Schema = {fields: Record<string, Field>};
type Inline = {type: string; text?: string; key?: string};
type DocNode = {id: string; type: string; props?: {areaId?: string; colSpan?: number; rowSpan?: number}; rowIds?: string[]; cellIds?: string[]; childIds?: string[]; columns?: {childIds?: string[]}[]; children?: Inline[]};
type Fragment = {rootIds: string[]; nodes: Record<string, DocNode>};
type Format = {key: string; label?: string; ownerAreaId: string; inputSchema: Schema; fragment: Fragment};
type Band = {inputSchema: Schema; fragment: Fragment};
type Section = {id: string; label: string; sectionKey: string; inputSchema: Schema; source: {fragment?: Fragment}; header?: Band; footer?: Band};
type Draft = {templateId: string; name: string; revision: number; fingerprint: string; definition: {nodeModelVersion: number; sections: Section[]; areaFormats?: Record<string, Format>; globalSchema: Schema}};
type Outline = {id: string; label: string; type: string; section: Section; format?: Format; children: Outline[]; parent?: Outline; node?: DocNode; band?: Band};
type DrawPage = {
  widthPt: number; heightPt: number; backgroundColor: string;
  sampleImages?: {xPt:number; yPt:number; widthPt:number; heightPt:number; color:string}[];
  fills?: {xPt: number; yPt: number; widthPt: number; heightPt: number; color: string}[];
  borders?: {x1Pt: number; y1Pt: number; x2Pt: number; y2Pt: number; widthPt: number; color: string}[];
  lines: {text: string; xPt: number; yPt: number; fontSizePt: number; baselineOffsetPt: number; color: string; weight: number}[];
};
type Preview = {revision: number; fingerprint: string; engineVersion: string; engineMs: number; renderMs: number; layoutHash: string; pdfHash: string; pageCount: number; pages: DrawPage[]};
type ServiceReply = {ok: boolean; value?: Draft; issues?: {code: string}[]};
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
const paperNodes = new Map<Outline, HTMLButtonElement>();
let draft: Draft, selection: Outline | undefined, paperSection: Section | undefined;
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
  const root: Outline = {id:section.id, label:section.label, type:'section',section,children:[]};
  function nodes(fragment: Fragment, ids: string[], parent: Outline, format?: Format): Outline[] {
    return ids.map((id, position) => {
      const node = fragment.nodes[id];
      const areaField = node.type==='area' ? [section.inputSchema, draft.definition.globalSchema].flatMap(s=>Object.entries(s.fields))
        .find(([,f])=>f.type==='area'&&f.areaId===node.props?.areaId)?.[0] : undefined;
      const inline = node.children?.map(x=>x.type==='field-ref'?'{{'+x.key+'}}':x.text??'').join('');
      const label = areaField ?? (inline || (['table-row','table-cell'].includes(node.type) ? kinds[node.type]+' '+(position+1) : kinds[node.type]??node.type));
      const result: Outline = {id,label,type:node.type,section,node,format,parent,band:parent.band,children:[]};
      if (node.type==='area') {
        result.children = Object.entries(draft.definition.areaFormats??{}).filter(([,f])=>f.ownerAreaId===node.props?.areaId).map(([formatId,f])=>{
          const item: Outline = {id:formatId,label:f.label??f.key,type:'format',section,parent:result,format:f,children:[]};
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
    const part:Outline={id:section.id+'-'+type,label,type,section,parent:root,band,children:[]};
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
    const li=element('li'), row=element('div');
    row.className='tree-row';
    const itemButton=button(item.label,()=>select(item,true));
    itemButton.dataset.kind=item.type;
    itemButton.dataset.nodeId=item.id;
    treeNodes.set(item,itemButton);
    const type=element('small',kinds[item.type]??item.type);
    type.className='type';
    const toggle=button('▸',()=>{
      if (!branch) branch=li.appendChild(drawBranch(item.children,depth+1));
      branch.hidden=toggle.getAttribute('aria-expanded')==='true';
      toggle.setAttribute('aria-expanded',String(!branch.hidden));
      toggle.textContent=branch.hidden?'▸':'▾';
      if(selection)treeNodes.get(selection)?.setAttribute('aria-current','true');
    });
    toggle.className='toggle';
    toggle.setAttribute('aria-label','ขยายหรือยุบ '+item.label);
    toggle.setAttribute('aria-expanded',String(depth<2&&item.children.length>0));
    toggle.hidden=!item.children.length;
    row.append(toggle,itemButton,type);
    li.append(row);
    let branch: HTMLUListElement|undefined;
    if(depth<2&&item.children.length){
      branch=li.appendChild(drawBranch(item.children,depth+1));
      toggle.textContent='▾';
    }
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
  if(measure)afterPaint('flowdoc:tree-selection',started,{type:item.type});
}
function showDraft(data: Draft, keepSectionId?: string) {
  draft=data;
  title.textContent=data.name;
  q('revision').textContent='Model 20 · Revision '+data.revision;
  const roots=data.definition.sections.map(outline);
  treeNodes.clear();selection=undefined;paperSection=undefined;
  tree.replaceChildren(drawBranch(roots));
  select(roots.find(x=>x.id===keepSectionId)??roots[0],false);
  previewTab.disabled=false;
  editor.hidden=showingPreview;
  document.body.dataset.revision=String(data.revision);
}
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
    hasConflict=false;conflict.hidden=true;input.readOnly=false;save.disabled=false;
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
  if(!item||item.type!=='section'||!label||isSaving||hasConflict)return;
  if(label===item.section.label){status.textContent='ชื่อส่วนยังเหมือนเดิม';return;}
  isSaving=true;input.readOnly=true;save.disabled=true;
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
    cancelPreview();showDraft(data,item.id);
    status.textContent='บันทึกแล้ว · Revision '+data.revision;
    if(showingPreview)void loadPreview();
  }catch{
    status.textContent='ยังยืนยันผลบันทึกไม่ได้ ชื่อที่พิมพ์ยังอยู่';
  }finally{
    isSaving=false;input.readOnly=false;save.disabled=hasConflict;
  }
});
q('reload').addEventListener('click',()=>void load());
previewTab.addEventListener('click',()=>changeMode(true));
defineTab.addEventListener('click',()=>changeMode(false));
previous.addEventListener('click',()=>{if(pageIndex>0){pageIndex--;showPage();}});
next.addEventListener('click',()=>{if(preview&&pageIndex<preview.pageCount-1){pageIndex++;showPage();}});
refreshPreview.addEventListener('click',()=>{cancelPreview();void loadPreview();});
void load();
