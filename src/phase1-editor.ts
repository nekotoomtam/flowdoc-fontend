import './phase1-editor.css';
import {mountColumnEdges} from './editor-column-edges';
import {treeIcon} from './editor-tree-icon';
import {addBand,addVariable,applyPart,canEditSectionContent,changePage,newDefinition,partValue,settings} from './editor-creation';
import type {Part} from './editor-creation';
import {openVisualAuthoring} from './editor-visual-authoring';
import {mountTrial} from './editor-trial';
import {issuePanel, type IssueContext} from './editor-api-issue';
import {installTrialExport} from './editor-trial-export';
import {installPreviewShare} from './editor-preview-share';
import {trialValueChanges} from '../scripts/trial-value-delta.mjs';
import type {Trial} from './editor-trial';

import {FormatBindingRequired,reorderTargets, canMoveBetweenCells, applyStructureChange, canAddPlainRows, defaultCellPadding, groupSources, lengthInPoints, paddingSides, refKey, structureOrder} from './editor-structure';
import type {MoveBinding, Band, Change, Definition, DocNode, Format, Fragment, Host, Inline, Length, Ref, Schema, Section} from './editor-structure';

type Draft = {readOnly?:boolean;canSharePreview?:boolean;templateId:string;docKey?:string;name:string;revision:number;fingerprint:string;definition:Definition};
type Outline = {id:string;ref:Ref;label:string;type:string;section:Section;format?:Format;children:Outline[];parent?:Outline;node?:DocNode;band?:Band;inline?:Inline;detail?:string};
type FieldMark={keys:string[];xPt:number;yPt:number;widthPt:number;heightPt:number};
type DrawPage = {
  formMarks?:FieldMark[];
  widthPt: number; heightPt: number; backgroundColor: string; sectionDefinitionId?:string;
  sampleImages?: {xPt:number; yPt:number; widthPt:number; heightPt:number; color?:string; resourceId?:string}[];
  glyphs?:Record<string,string>;
  fills?: {xPt: number; yPt: number; widthPt: number; heightPt: number; color: string}[];
  borders?: {x1Pt: number; y1Pt: number; x2Pt: number; y2Pt: number; widthPt: number; color: string; style?:string}[];
  lines: {text: string; xPt: number; yPt: number; widthPt:number; heightPt:number; fontSizePt: number; baselineOffsetPt: number; color: string; weight?: number; scale?:number; glyphUses?:[string,number,number][]; edit?:PreviewEdit}[];
};
type TrialTab = {occurrence:string;pageIndex:number};
type PreviewEdit = {previous?:TrialTab;next?:TrialTab;key:string;occurrence:string;start:number;end:number;blank?:boolean;contentWidth?:number;align?:string;clusters:[number,number,number][]};
type Preview = {fieldPages?:Record<string,number>;trialPatchBase?:boolean;pageKeys?:(string|null)[];pageSizes?:[number,number,string][];pageIndex?:number;previewId?:string;revision: number; fingerprint: string; engineVersion: string; engineMs: number; renderMs: number; layoutHash: string; renderPath?:string; pageCount: number; pages: DrawPage[]; paged?:boolean; entryCount?:number; imagePlacements?:number};
type ServiceReply = {ok: boolean; value?: Draft; expiresAt?:string; issues?: {code: string; path?:string}[]};
const q = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id)! as T;
const title = q('title'), status = q('status'), editor = q('editor'), tree = q('tree'), paper = q('paper'), variables = q('variables');
const form = q<HTMLFormElement>('rename'), input = q<HTMLInputElement>('section-name'), save = q<HTMLButtonElement>('save');
const defineTab = q<HTMLButtonElement>('define-tab'), previewTab = q<HTMLButtonElement>('preview-tab');
const conflict = q('conflict'), previewPanel = q('preview'), previewStatus = q('preview-status'), previewPaper = q('preview-paper');
const previous = q<HTMLButtonElement>('previous-page'), next = q<HTMLButtonElement>('next-page'), refreshPreview = q<HTMLButtonElement>('refresh-preview');
const jump=q<HTMLInputElement>('jump-page');
const sharedPreview=location.pathname==='/shared-preview';
const paperOnly=!sharedPreview&&new URLSearchParams(location.search).get('view')==='paper';
const paperVersion=paperOnly?new URLSearchParams(location.search).get('version'):null;
if(paperOnly)document.body.classList.add('library-paper');
const sharedPreviewHeaders:Record<string,string>=sharedPreview?{
  'X-FlowDoc-Preview-Share':location.hash.slice(1),
  'X-FlowDoc-Preview-Session':crypto.randomUUID()
}:{};
const shareUnavailable='ลิงก์หมดอายุหรือถูกยกเลิกแล้ว กรุณาขอลิงก์ใหม่';
const benchmark=!sharedPreview&&sessionStorage.getItem('flowdoc:benchmark-preview')==='1';
const canvasPreview=new URLSearchParams(location.search).get('previewRenderer')==='canvas';
const resumablePreview=!sharedPreview&&new URLSearchParams(location.search).get('previewEngine')==='resume';
const fullTrialTransport=new URLSearchParams(location.search).get('previewTransport')==='full'||
  sessionStorage.getItem('flowdoc:full-trial-transport')==='1';
let pendingPage:AbortController|undefined;
const editorApi='/api/editor-phase1/drafts';
const newMode=!sharedPreview&&new URLSearchParams(location.search).get('new')==='1';
let templateId = new URLSearchParams(location.search).get('id');
const fromTemplate=new URLSearchParams(location.search).get('from');
if(!sharedPreview&&!paperOnly&&fromTemplate&&/^[a-f0-9-]{36}$/.test(fromTemplate)){
  const details=document.createElement('a');details.href='/library.html?phase1=1#'+fromTemplate;
  details.textContent='รายละเอียดแม่แบบ';
  q('editor-library-link').after(document.createTextNode('　/　'),details);
}
let endpoint=sharedPreview?'/shared-preview/api':editorApi+'/'+encodeURIComponent(templateId??'');
let createKey:string|undefined;
const creationMode=()=>newMode||Boolean(draft?.docKey?.startsWith('editor-draft-'));
const kinds: Record<string,string> = {section:'Section',area:'Area',format:'Format',table:'ตาราง','table-row':'แถว','table-cell':'เซลล์','text-block':'ข้อความ','page-break':'ขึ้นหน้าใหม่',image:'ภาพ',line:'เส้น','table-of-contents':'สารบัญ',header:'หัวกระดาษ',footer:'ท้ายกระดาษ',columns:'ชุดคอลัมน์',column:'คอลัมน์','field-ref':'ตัวแปร',text:'ข้อความคงที่','system-page-field':'เลขหน้า','row-group':'กลุ่มแถว',repeat:'วนซ้ำ'};
const treeNodes = new Map<Outline, HTMLButtonElement>();
const rootRows=new Map<Outline,HTMLLIElement>();
const paperNodes = new Map<Outline, HTMLElement>();
let savedDefinition:Definition|undefined;
let draft: Draft, selection: Outline | undefined;
const sectionSheets=new Map<Outline,HTMLElement>();
const activeFormats=new Map<string,Format>();
let roots:Outline[] = [], outlines=new Map<string,Outline>();
const expanded=new Map<string,boolean>();
const history:{definition:Definition;selection:Ref}[]=[];
let isSaving = false, isLoading = false, hasConflict = false, showingPreview = false;
let trialBase:{previewId:string;trial:Trial;structure:number}|undefined;
let preview: Preview | undefined, pendingPreview: AbortController | undefined, pageIndex = 0;

type SectionBackground={sha256:string;name:string;format:'png'|'jpeg'};
let sectionBackgrounds:Record<string,SectionBackground>={};
let sectionBackgroundEnabled=false,sectionPublicationEnabled=false;
const sectionBackgroundUrl=(key='')=>endpoint+'/section-backgrounds'+(key?'/'+encodeURIComponent(key):'');
function sectionBackgroundImage(id:string|undefined){
  const setting=id&&sectionBackgrounds[id];
  return setting?sectionBackgroundUrl(setting.sha256):undefined;
}
async function readSectionBackgrounds(){
  if(sharedPreview||!templateId)return;
  const response=await fetch(sectionBackgroundUrl());
  sectionBackgroundEnabled=response.ok;
  sectionBackgrounds=response.ok?(await response.json()).value:{};
  sectionPublicationEnabled=(await fetch(endpoint+'/section-publication')).ok;
}
async function publishSectionBackground(){
  if(isSaving||isDirty()){status.textContent='บันทึกโครงก่อนเผยแพร่';return;}
  isSaving=true;refreshButtons();
  try{
    const backgrounds=Object.fromEntries(Object.entries(sectionBackgrounds).filter(([id])=>draft.definition.sections.some(section=>section.id===id)).sort().map(([id,item])=>[id,item.sha256]));
    const response=await fetch(endpoint+'/section-publication',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:draft.revision,fingerprint:draft.fingerprint,backgrounds})});
    const result=await response.json();
    if(!response.ok)throw Error(result.error==='STALE_CURRENT'?'ร่างเปลี่ยนแล้ว กรุณาเปิดใหม่':result.error==='background_required'?'บันทึกภาพพื้นหลังก่อนเผยแพร่':'เผยแพร่ไม่สำเร็จ');
    status.textContent='เผยแพร่เวอร์ชัน '+result.value.version+' แล้ว';
  }catch(e){status.textContent=e instanceof Error?e.message:'เผยแพร่ไม่สำเร็จ';}
  finally{isSaving=false;refreshButtons();}
}
async function editSectionBackground(item:Outline){
  const dialog=document.createElement('dialog');
  dialog.className='section-background-dialog';
  const title=document.createElement('h2');title.textContent='พื้นหลัง · '+item.label;
  const label=document.createElement('label');label.textContent='เลือกภาพ PNG หรือ JPEG';
  const file=document.createElement('input');file.type='file';file.accept='image/png,image/jpeg';label.append(file);
  const detail=document.createElement('p');detail.textContent=sectionBackgrounds[item.section.id]?.name??'ยังไม่มีภาพ';
  detail.setAttribute('role','status');
  const saveButton=button('บันทึกภาพ',()=>void submit('PUT'));saveButton.disabled=true;
  const remove=button('ลบภาพพื้นหลัง',()=>void submit('DELETE'));remove.disabled=!sectionBackgrounds[item.section.id];
  const close=button('ปิด',()=>dialog.close());
  file.onchange=()=>{saveButton.disabled=!file.files?.length;};
  dialog.append(title,detail,label,saveButton,remove,close);
  document.body.append(dialog);dialog.addEventListener('close',()=>dialog.remove(),{once:true});dialog.showModal();
  async function submit(method:'PUT'|'DELETE'){
    saveButton.disabled=remove.disabled=true;
    const picture=file.files?.[0];
    try{
      if(method==='PUT'&&picture){const url=URL.createObjectURL(picture);try{const image=new Image();image.src=url;await image.decode();}finally{URL.revokeObjectURL(url);}}
      const response=await fetch(sectionBackgroundUrl(item.section.id),{method,headers:{
        'If-Match':sectionBackgrounds[item.section.id]?.sha256??'none',
        'X-Image-Name':encodeURIComponent(picture?.name??'')
      },body:method==='PUT'?picture:undefined});
      if(!response.ok)throw Error(response.status===409?'ภาพถูกแก้จากอีกหน้าต่าง กรุณาเปิดโครงใหม่':response.status===413?'ภาพใหญ่เกิน 8 MiB':'บันทึกภาพไม่สำเร็จ');
      sectionBackgrounds=(await response.json()).value;
      for(const [outline,sheet] of sectionSheets){
        const background=sectionBackgroundImage(outline.section.id);
        sheet.style.backgroundImage=background?'url("'+background+'")':'';
        sheet.style.backgroundSize='100% 100%';
      }
      cancelPreview();
      status.textContent=method==='PUT'?'บันทึกพื้นหลังแล้ว':'ลบพื้นหลังแล้ว';
      dialog.close();
    }catch(e){detail.textContent=e instanceof Error?e.message:'บันทึกภาพไม่สำเร็จ';}
    finally{saveButton.disabled=!file.files?.length;remove.disabled=!sectionBackgrounds[item.section.id];}
  }
}

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
function inlineText(inline:Inline){
  if(inline.type==='field-ref')return '{{'+inline.key+'}}';
  if(inline.type==='system-page-field')return '{{'+(inline.field==='total'?'จำนวนหน้า':'เลขหน้า')+'}}';
  if(inline.type==='line-break')return 'ขึ้นบรรทัดใหม่';
  return inline.text||kinds[inline.type]||inline.type;
}
function outline(section: Section): Outline {
  const root: Outline = {id:section.id, ref:{sectionId:section.id},label:section.label, type:'section',section,children:[]};
  function nodes(fragment: Fragment, ids: string[], parent: Outline, host: Host, format?: Format): Outline[] {
    return ids.map((id, position) => {
      const node = fragment.nodes[id];
      const areaField = node.type==='area' ? [section.inputSchema, draft.definition.globalSchema].flatMap(s=>Object.entries(s.fields))
        .find(([,f])=>f.type==='area'&&f.areaId===node.props?.areaId)?.[0] : undefined;
      const inline = node.children?.map(inlineText).join('');
      const gap=node.type==='text-block'&&!node.children?.length&&node.props?.heightMode==='fixed'&&node.props.height;
      const label = areaField ?? ((inline&&!inline.trim()?'เว้นวรรค':inline) || (gap?'เว้นระยะ '+displayLength(gap):['table-row','table-cell'].includes(node.type) ? kinds[node.type]+' '+(position+1) : kinds[node.type]??node.type));
      const result: Outline = {id,ref:{...parent.ref,nodeId:id,part:undefined},label,type:node.type,section,node,format,parent,band:parent.band,children:[]};
      if (node.type==='area') {
        result.children = Object.entries(draft.definition.areaFormats??{}).filter(([,f])=>f.ownerAreaId===node.props?.areaId).map(([formatId,f])=>{
          const item: Outline = {id:formatId,ref:{sectionId:section.id,formatId},label:f.label??f.key,type:'format',section,parent:result,format:f,children:[]};
          item.children=nodes(f.fragment,f.fragment.rootIds,item,f,f);
          return item;
        });
      } else {
        const part=(id:string,label:string,type:string,detail?:string):Outline=>({
          id,ref:{...result.ref,part:id},type,label,section,parent:result,format,band:parent.band,children:[],detail
        });
        if(node.type==='columns'){
          result.children=(node.columns??[]).map((column,i)=>{
            const item=part('column:'+i,'คอลัมน์ '+(i+1),'column','สัดส่วน '+(column.weight??1));
            item.children=nodes(fragment,column.childIds??[],item,host,format);return item;
          });
        }else{
          result.children=nodes(fragment,node.rowIds??node.cellIds??node.childIds??[],result,host,format);
        }
        for(const [i,inline] of (node.children??[]).entries()){
          const item=part('inline:'+(inline.id??i),inlineText(inline),inline.type,inline.scope?'ขอบเขต '+inline.scope:undefined);
          item.inline=inline;result.children.push(item);
        }
        for(const [i,group] of (host.rowGroups??[]).entries())if(group.tableId===id){
          result.children.push(part('group:'+i,'กลุ่มแถว · '+group.source.key,'row-group',
            group.source.scope+':'+group.source.key+'[] › '+group.memberRepeat.source.key+'[] · แถวสมาชิก '+group.memberRepeat.rowTemplateId+' · แถวว่าง '+group.memberRepeat.emptyRowTemplateId));
        }
        for(const [i,repeat] of (host.repeats??[]).entries())if(repeat.tableId===id){
          result.children.push(part('repeat:'+i,'วนแถว · '+repeat.source?.key,'repeat','แถวต้นแบบ '+repeat.rowTemplateId));
        }
        for(const [i,repeat] of (host.cellRepeats??[]).entries())if(repeat.cellId===id){
          result.children.push(part('cell-repeat:'+i,'วนเนื้อหาเซลล์ · '+repeat.source?.key,'repeat',repeat.childTemplateIds.join(' · ')));
        }
      }
      return result;
    });
  }
  const fragment=section.source.fragment;
  const makeBand = (band:Band, type:string, label:string) => {
    const part:Outline={id:section.id+'-'+type,ref:{sectionId:section.id,band:type as 'header'|'footer'},label,type,section,parent:root,band,children:[]};
    part.children=nodes(band.fragment,band.fragment.rootIds,part,band);
    return part;
  };
  if(section.header)root.children.push(makeBand(section.header,'header','หัวกระดาษ'));
  if(fragment)root.children.push(...nodes(fragment,fragment.rootIds,root,section.source));
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
    const itemButton=button(item.label,()=>{
      if(item.type==='field-ref')focusPaper(item);
      else select(item,true);
    });
    const spacer=item.node?.type==='text-block'&&(item.node.children?.length ? item.node.children.every(i=>i.type==='text'&&!i.text?.trim()) : item.node.props?.heightMode==='fixed'&&item.node.props.height);
    const kindLabel=spacer?'ระยะเว้น':kinds[item.type]??item.type;
    const treeLabel=item.inline?.type==='field-ref' ? item.inline.key??item.label : item.label;
    itemButton.replaceChildren(treeIcon(spacer?'spacer':item.type),element('span',treeLabel));
    itemButton.title=item.label===kindLabel?kindLabel:item.label+' · '+kindLabel;
    itemButton.setAttribute('aria-description',kindLabel);
    itemButton.dataset.kind=item.type;
    itemButton.dataset.nodeId=item.id;
    itemButton.dataset.ref=refKey(item.ref);
    treeNodes.set(item,itemButton);

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
    const open=item.children.length>0&&(expanded.get(refKey(item.ref))??(depth<2&&(item.type!=='area'||item.children.length<=4)));
    toggle.setAttribute('aria-expanded',String(open));
    toggle.hidden=!item.children.length;
    row.append(toggle,itemButton);
    if(item.type==='area')row.append(element('small',item.children.length+' รูปแบบ'));
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
const paperSizes:Record<string,[number,number]>={A4:[595.276,841.89],A3:[841.89,1190.551],Letter:[612,792],Legal:[612,1008]};
function drawSectionPaper(root: Outline, preferred?: Format) {
  const sheet=element('div');sheet.className='definition-sheet';sheet.dataset.sectionId=root.id;
  const background=sectionBackgroundImage(root.section.id);
  if(background){sheet.style.backgroundImage='url("'+background+'")';sheet.style.backgroundSize='100% 100%';}
  const switcher=element('div');switcher.className='definition-section-tools structure-tools';
  const layout=draft.definition.pageLayouts?.[root.section.pageLayoutId??draft.definition.book.defaultPageLayoutId]?.page;
  const [short,long]=paperSizes[layout?.size??'A4']??paperSizes.A4;
  const [width,height]=layout?.orientation==='landscape'?[long,short]:[short,long];
  const points=(value?:Length)=>value?(value.unit==='mm'?value.value*72/25.4:value.value):0;
  const unit=(n:number)=>'calc('+n+' * var(--sheet-pt))';
  const length=(value?:Length)=>value?unit(points(value)):'';
  const hex=(value?:string)=>value&&/^[0-9a-f]{6}$/i.test(value)?'#'+value:'';
  let registerControl=true;
  const choose=(item:Outline,label=item.label,className='definition-control')=>{
    const control=button(label,()=>{if(item.ref.band)paperNodes.set(item,control);select(item,false);});control.className=className;
    control.dataset.paperRef=refKey(item.ref);
    control.dataset.kind=item.type;
    if(item.inline?.type==='text')control.addEventListener('dblclick',()=>openInlineEditor(item));
    if(registerControl)paperNodes.set(item,control);
    return control;
  };
  function contents(item: Outline): HTMLElement {
    const block=element('div');block.className='definition-block';block.dataset.kind=item.type;
    const props=item.node?.props;
    if(item.type==='area'){
      block.classList.add('definition-area');
      const areaControl=choose(item,'Area '+item.label,'definition-area-control');
      areaControl.title='เลือกพื้นที่ '+item.label;
      const tools=element('div');tools.className='definition-area-tools';
      tools.append(areaControl);
      block.append(tools);
      const areaKey=refKey(item.ref);
      const active=item.children.find(child=>child.format===preferred)
        ??item.children.find(child=>child.format===activeFormats.get(areaKey))??item.children[0];
      if(active?.format)activeFormats.set(areaKey,active.format);
      if(active&&item.children.length===1){
        const current=button('Format '+active.label,()=>select(active,false));
        current.className='definition-current-format';
        tools.append(current);
      }else if(active){
        const group=element('details');group.className='format-picker';
        const options=element('div');options.className='format-choices';
        for(const format of item.children){
          if(format===active)continue;
          options.append(choose(format,format.label,'definition-format-choice'));
        }
        group.append(element('summary','Format '+active.label),options);
        tools.append(group);
      }
      if(active)block.append(contents(active));
    }else if(item.type==='format'){
      block.classList.add('definition-format');
      block.append(choose(item),...item.children.map(contents));
    }else if(item.type==='table'){
      const table=element('table'), body=element('tbody'), columns=element('colgroup');
      const widths=(item.node?.columns??[]).map(column=>points(column.width));
      const total=widths.reduce((sum,width)=>sum+width,0);
      for(const width of widths){
        const col=element('col');if(total)col.style.width=(width/total*100)+'%';columns.append(col);
      }
      if(total)table.style.width='min(100%, '+unit(total)+')';
      const tableHandle=choose(item,'ตาราง','definition-control definition-table-handle');
      const tableNumber=(item.parent?.children.filter(child=>child.type==='table').indexOf(item)??0)+1;
      tableHandle.setAttribute('aria-label','เลือกตาราง '+tableNumber);
      block.classList.add('definition-table');
      block.append(tableHandle,table);table.append(columns,body);
      block.addEventListener('click',event=>{if(event.target===block||event.target===table)select(item,false);});
      const metadata=item.children.filter(child=>child.type!=='table-row');
      if(metadata.length){const controls=element('div');controls.className='definition-meta';
        controls.append(...metadata.map(item=>choose(item,item.label,'definition-marker')));block.append(controls);}
      for(const [index,row] of item.children.filter(child=>child.type==='table-row').entries()){
        const tr=element('tr');tr.dataset.authoredRow=String(index+1);
        const rowButton=choose(row,row.label,'definition-marker definition-row');
        // Merged rows can have no authored cells of their own.
        if(!row.children.length)block.append(rowButton);
        for(const [cellIndex,cell] of row.children.entries()){
          const td=element('td'),cellProps=cell.node?.props;
          td.dataset.authoredColumn=String((cellProps?.columnIndex??cellIndex)+1);
          td.colSpan=cellProps?.colSpan??1;td.rowSpan=cellProps?.rowSpan??1;
          td.style.backgroundColor=hex(cellProps?.fillColor??(index<(props?.headerRowCount??0)?props?.headerFillColor:undefined));
          td.style.borderColor=hex(props?.borderColor);
          if(props?.borderWidth)td.style.borderWidth=length(props.borderWidth);
          for(const side of ['top','right','bottom','left'] as const){
            const padding=cellProps?.padding?.[side];
            td.style.setProperty('padding-'+side,padding?length(padding):unit(defaultCellPadding));
          }
          const cellControl=choose(cell,cell.label,'definition-cell-control');
          td.addEventListener('click',event=>{
            const hit=event.target as Element;
            if(hit.closest('td')===td&&!hit.closest('button'))cellControl.click();
          });
          if(cellIndex===0)td.append(rowButton);
          td.append(cellControl,...cell.children.map(contents));tr.append(td);
        }
        body.append(tr);
      }
    }else if(item.type==='text-block'){
      block.classList.add('definition-text');
      const spacer=props?.heightMode==='fixed'&&props.height&&!item.children.length;
      const blockControl=choose(item,spacer?item.label:'ข้อความ','definition-marker'+(spacer?' fixed-spacer':''));
      block.append(blockControl);
      block.addEventListener('click',event=>{
        if(event.target===block&&!block.closest('td'))blockControl.click();
      });
      const style=draft.definition.styles[props?.textStyleId??''] as {fontSize?:Length;lineHeightPt?:number;fontWeight?:string;font?:{weight?:number}}|undefined;
      if(style?.fontSize)block.style.fontSize=length(style.fontSize);
      if(style?.lineHeightPt)block.style.lineHeight=unit(style.lineHeightPt);
      if(style?.font?.weight)block.style.fontWeight=String(style.font.weight);
      else if(style?.fontWeight)block.style.fontWeight=style.fontWeight;
      if(props?.heightMode==='fixed'&&props.height){
        block.style.minHeight=length(props.height);
        if(item.children.length){
          block.style.alignContent=props.verticalAlign==='bottom'?'end':props.verticalAlign==='center'?'center':'start';
        }
      }
      if(props?.textAlign)block.style.textAlign=props.textAlign;
      for(const part of item.children){
        if(part.type==='line-break')block.append(choose(part,'↵','definition-inline'),element('br'));
        else block.append(choose(part,part.label,'definition-inline'+(part.type==='field-ref'?' definition-token':'')));
      }
    }else if(item.type==='image'){
      const image=choose(item,props?.source?'ภาพ · {{'+props.source.key+'}}':'ภาพ','definition-image');
      if(props?.width)image.style.width=length(props.width);
      if(props?.height)image.style.height=length(props.height);
      image.title=image.textContent??'';image.setAttribute('aria-label',image.title);
      image.textContent='';
      const icon=document.createElementNS('http://www.w3.org/2000/svg','svg');
      icon.setAttribute('viewBox','0 0 24 24');icon.setAttribute('aria-hidden','true');
      icon.innerHTML='<path d="M3 4h18v16H3z M4 18l6-7 3 3 3-4 4 6" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="16" cy="8" r="1.5" fill="currentColor"/>';
      image.append(icon);
      const align=(props as {align?:string}|undefined)?.align;
      if(align==='center')image.style.marginInline='auto';
      if(align==='right')image.style.marginLeft='auto';
      block.append(image);
    }else if(item.type==='line'){
      const rule=choose(item,'เส้น','definition-rule');
      if(props?.width)rule.style.width=length(props.width);
      rule.style.height=length(props?.thickness)||'1px';
      rule.style.backgroundColor=hex(props?.color)||'#31463e';
      block.classList.add('definition-line');
      for(const [side,value] of [['before',props?.spaceBefore],['after',props?.spaceAfter]] as const){
        if(!value||value.value<=0)continue;
        block.style.setProperty(side==='before'?'padding-top':'padding-bottom',length(value));
        if(points(value)<12)continue;
        const note=(side==='before'?'เว้นก่อนเส้น ':'เว้นหลังเส้น ')+displayLength(value);
        const guide=button(note,()=>{select(item,false,side);editLineSpacing(item,side);});
        guide.className='spacing-guide spacing-'+side;
        guide.style.height=length(value);
        guide.setAttribute('aria-label',note);
        block.append(guide);
      }
      if(props?.align==='center')rule.style.marginInline='auto';
      if(props?.align==='right')rule.style.marginLeft='auto';
      block.append(rule);
    }else if(item.type==='columns'){
      const columns=element('div');columns.className='definition-columns';
      columns.style.gap=length(props?.gap)||'0';
      for(const [i,column] of item.children.entries()){
        const view=contents(column);view.style.flex=String(item.node?.columns?.[i]?.weight??1);
        columns.append(view);
      }
      block.append(choose(item),columns);
    }else{
      const control=choose(item);
      block.append(control,...item.children.map(contents));
      if(item.type==='column')block.addEventListener('click',event=>{
        if(event.target!==block)return;
        event.stopPropagation();
        control.click();
      });
    }
    return block;
  }
  sheet.dataset.widthPt=String(width);sheet.dataset.heightPt=String(height);
  sheet.style.width='calc('+width+' * var(--sheet-pt))';
  sheet.style.minHeight=unit(height);
  sheet.dataset.pageSize=layout?.size??'A4';
  const body=element('div');body.className='definition-body';
  if(root.section.source.kind==='blank'){
    const empty=element('div');empty.className='empty-authoring-paper';
    empty.append(element('strong','กระดาษเปล่า'),element('p','เลือกองค์ประกอบแรกของ Section นี้'),
      button('+ เพิ่มพื้นที่ (Area)',()=>askArea(root.ref)),button('+ เพิ่มข้อความ',()=>tryStage({kind:'node',at:root.ref,type:'text-block'})));
    if(draft.readOnly)empty.replaceChildren(element('strong','กระดาษเปล่า'));
    body.append(empty);
  }
  const margin=layout?.margin??{};
  let top=margin.top,bottom=margin.bottom;
  const bands:Outline[]=[];
  function bandSlot(item:Outline){
    const band=item.band!,placement=band.placement,header=item.ref.band==='header';
    const edge=header?'top':'bottom';
    const offset=placement?.offset??margin[edge];
    const view=element('div');view.className='definition-band';view.dataset.band=item.ref.band;
    view.style.marginInlineStart=length(placement?.left??margin.left);
    view.style.marginInlineEnd=length(placement?.right??margin.right);
    const style=draft.definition.styles[band.baseTextStyleId??''] as {lineHeightPt?:number}|undefined;
    const lineHeight=style?.lineHeightPt;
    const height=band.sizing?.height?points(band.sizing.height):Math.max(lineHeight??12,points(band.sizing?.minHeight));
    view.style.minHeight=unit(height);
    const handle=choose(item,'','definition-band-hit');
    handle.setAttribute('aria-label','เลือก'+item.label);
    handle.title='เลือกพื้นที่'+item.label;
    if(header){
      view.style.setProperty('--header-inset',length(placement?.left??margin.left) || '0px');
      handle.classList.add('header-edge');
    }else handle.append(element('span',item.label));
    const content=element('div');content.className='definition-band-content';
    content.append(...item.children.map(contents));
    view.append(handle,content);
    const slot=element('div');slot.className='definition-band-slot definition-band-'+item.ref.band;
    slot.style.minHeight=length(margin[edge]);
    slot.style.paddingTop=length(header?offset:band.gap);
    slot.style.paddingBottom=length(header?band.gap:offset);
    if(points(offset)>=20)view.dataset.roomForLabel='true';
    slot.append(view);
    return slot;
  }
  for(const item of root.children){
    if(item.ref.band&&item.band){
      bands.push(item);
      if(item.ref.band==='header')top=undefined;else bottom=undefined;
    }else body.append(contents(item));
  }
  body.style.padding=[top,margin.right,bottom,margin.left].map(value=>unit(points(value))).join(' ');
  sheet.prepend(body);
  const control=choose(root,root.label+' · '+sheet.dataset.pageSize,'definition-section-control');
  switcher.prepend(control);
  const unitPanel=element('section');unitPanel.className='definition-section';unitPanel.append(switcher);
  // Authored page breaks create a new sheet. Keep the original controls so the Tree
  // and canvas continue to select the same definition IDs.
  function split(block:HTMLElement):HTMLElement[][]{
    if(block.dataset.kind==='page-break')return [[block],[]];
    if(!block.classList.contains('definition-area')&&!block.classList.contains('definition-format'))return [[block]];
    const fragments=partition([...block.children] as HTMLElement[]);
    if(fragments.length===1)return [[block]];
    return fragments.map(children=>{
      if(!children.length)return [];
      const wrapper=block.cloneNode(false) as HTMLElement;
      wrapper.append(...children);return [wrapper];
    });
  }
  function partition(blocks:HTMLElement[]){
    const pages:HTMLElement[][]=[[]];
    for(const block of blocks){
      const fragments=split(block);
      pages.at(-1)!.push(...fragments[0]);
      pages.push(...fragments.slice(1));
    }
    return pages;
  }
  const authored=partition([...body.children] as HTMLElement[]);
  for(const [index,blocks] of authored.entries()){
    const page=index===0?sheet:sheet.cloneNode(false) as HTMLElement;
    const content=index===0?body:body.cloneNode(false) as HTMLElement;
    content.replaceChildren(...blocks);
    if(index>0)page.append(content);
    registerControl=index===0;
    page.append(...bands.map(bandSlot));
    page.dataset.authoringPage=String(index+1);
    page.setAttribute('aria-label',root.label+' · หน้า '+(index+1));
    page.addEventListener('click',event=>{if(event.target===page||event.target===content)select(root,false);});
    unitPanel.append(page);
  }
  return unitPanel;
}


function scrollWithin(viewport:HTMLElement,target:HTMLElement){
  const box=viewport.getBoundingClientRect(), selected=target.getBoundingClientRect();
  if(selected.left<box.left)viewport.scrollLeft+=selected.left-box.left-8;
  else if(selected.right>box.right)viewport.scrollLeft+=selected.right-box.right+8;
  if(selected.top<box.top)viewport.scrollTop+=selected.top-box.top-8;
  else if(selected.bottom>box.bottom)viewport.scrollTop+=selected.bottom-box.bottom+8;
}
function variableScopes(item:Outline){
  const scopes: {scope:string;label:string;schema:Schema}[]=[
    {scope:'global',label:'ทั้งเอกสาร',schema:draft.definition.globalSchema},
    {scope:'section',label:'ส่วนเอกสาร',schema:item.section.inputSchema}
  ];
  if(item.band)scopes.push({scope:item.ref.band!,label:item.ref.band==='header'?'หัวกระดาษ':'ท้ายกระดาษ',schema:item.band.inputSchema});
  if(item.format)scopes.push({scope:'local',label:'รูปแบบ · '+item.format.key,schema:item.format.inputSchema});
  const host=item.format??item.band??item.section.source;
  const lineage=new Set<string>();
  for(let p:Outline|undefined=item;p;p=p.parent)if(p.node)lineage.add(p.node.id);
  const scopeField=(source?:{scope:string;key:string})=>source?scopes.find(x=>x.scope===source.scope)?.schema.fields[source.key]:undefined;
  const group=host.rowGroups?.find(group=>group.rowTemplateIds.some(row=>lineage.has(row)));
  const groupSchema=scopeField(group?.source)?.items;
  if(group&&groupSchema){
    scopes.push({scope:'group',label:'กลุ่ม · '+group.source.key+'[]',schema:groupSchema});
    const member=group.memberRepeat;
    const schema=groupSchema.fields[member.source.key]?.items;
    if(schema&&lineage.has(member.rowTemplateId))
      scopes.push({scope:'item',label:'รายการในกลุ่ม · '+member.source.key+'[]',schema});
  }
  const repeat=host.repeats?.find(repeat=>lineage.has(repeat.rowTemplateId));
  const cellRepeat=host.cellRepeats?.find(repeat=>repeat.childTemplateIds.some(node=>lineage.has(node)));
  const activeRepeat=cellRepeat??repeat;
  const itemSchema=scopeField(activeRepeat?.source)?.items;
  if(activeRepeat?.source&&itemSchema){
    const old=scopes.findIndex(x=>x.scope==='item');
    if(old>=0)scopes.splice(old,1);
    scopes.push({scope:'item',label:'รายการที่วนซ้ำ · '+activeRepeat.source.key+'[]',schema:itemSchema});
  }
  return scopes;
}
const variableGroups=new Map<Schema,HTMLElement>();
let contextVariables:HTMLElement;
function variableGroup(schema:Schema,scope:string,label:string,at?:Ref){
  const container=element('details');container.className='scope';container.open=true;
  container.dataset.scope=scope;
  if(at)container.dataset.owner=refKey(at);
  container.append(element('summary',label));
  const value=q('variable-detail');
  function fields(current:Schema,base=''):HTMLUListElement{
    const list=element('ul');
    for(const [key,definition] of Object.entries(current.fields)){
      const path=base+key,li=element('li');
      const field=button(key+' · '+definition.type,()=>{
        variables.querySelector('[aria-current=true]')?.removeAttribute('aria-current');
        field.setAttribute('aria-current','true');
        value.textContent=label+' › '+path+' · '+definition.type;
        showBindingTargets(current,key,label+' › '+path);
      });
      field.className='variable-field';
      field.dataset.variableScope=scope;field.dataset.variablePath=path;
      li.append(field);
      if(definition.items)li.append(fields(definition.items,path+'[].'));
      list.append(li);
    }
    return list;
  }
  container.append(Object.keys(schema.fields).length?fields(schema):element('p','ยังไม่มีตัวแปร'));
  if(at&&creationMode()&&!draft.readOnly){
    const add=button('+ ประกาศตัวแปร',()=>askVariable(at,scope as 'global'|'section'|'local'|'header'|'footer',label));
    const part:Part=scope==='global'?'globalSchema':scope==='section'?'section-schema':scope==='local'?'format-schema':'band-schema';
    const edit=button('แก้ไข / ลบตัวแปร',()=>editPart(at,part,'ตัวแปร · '+label));
    for(const control of [add,edit]){control.dataset.schemaAction='';container.append(control);}
  }
  variableGroups.set(schema,container);
  return container;
}
function drawDefinitionVariables(){
  variableGroups.clear();
  const groups:HTMLElement[]=[variableGroup(draft.definition.globalSchema,'global','ทั้งเอกสาร',roots[0].ref)];
  for(const [index,root] of roots.entries()){
    const section=element('section');section.className='variable-section';section.dataset.sectionId=root.id;
    section.append(element('h3','Section '+(index+1)+' · '+root.label),
      variableGroup(root.section.inputSchema,'section','ตัวแปรของ Section',root.ref));
    for(const band of ['header','footer'] as const){
      const definition=root.section[band];
      if(definition)section.append(variableGroup(definition.inputSchema,band,band==='header'?'หัวกระดาษ':'ท้ายกระดาษ',{...root.ref,band}));
    }
    function formats(item:Outline){
      if(item.type==='area'){
        const area=element('section');area.className='variable-area';area.append(element('h4','Area · '+item.label));
        for(const child of item.children)if(child.format)
          area.append(variableGroup(child.format.inputSchema,'local','Format · '+child.label,child.ref));
        section.append(area);
      }else item.children.forEach(formats);
    }
    root.children.forEach(formats);
    groups.push(section);
  }
  contextVariables=element('div');
  variables.replaceChildren(...groups,contextVariables);
}
function boundSource(item:Outline){
  const inline=item.inline;
  return inline?.type==='field-ref'&&inline.scope&&inline.key?{scope:inline.scope,key:inline.key}:
    item.node?.type==='image'?item.node.props?.source:undefined;
}
function focusPaper(item:Outline){
  select(item,true);
  const target=paperNodes.get(item);
  if(!target)return;
  target.focus({preventScroll:true});
  scrollWithin(paper.parentElement!,target);
  const bounds=target.getBoundingClientRect();
  const toolbar=document.querySelector('.editor-title')?.getBoundingClientRect();
  if(bounds.top<Math.max(0,toolbar?.bottom??0)+8||bounds.bottom>window.innerHeight-8)
    target.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});
}
const lastBinding=new WeakMap<Schema,Map<string,string>>();
function showBindingTargets(schema:Schema,key:string,label:string){
  const candidates=[...outlines.values()].filter(item=>{
    const source=boundSource(item);
    return source?.key===key&&variableScopes(item).some(s=>s.scope===source.scope&&s.schema===schema);
  });
  const current=candidates.find(item=>item===selection)??candidates.find(item=>refKey(item.ref)===lastBinding.get(schema)?.get(key));
  if(current||candidates.length===1){focusPaper(current??candidates[0]);return;}
  q('binding-inspector').hidden=false;
  q('binding-name').textContent=label;
  q<HTMLButtonElement>('binding-name').disabled=true;
  q('binding-return').hidden=true;
  q('binding-targets').replaceChildren(...(candidates.length?candidates.map(item=>button(outlinePath(item),()=>focusPaper(item))):
    [element('p','ยังไม่มีจุดที่ผูกบนกระดาษ')]));
}
q('binding-name').addEventListener('click',()=>{if(selection&&boundSource(selection))focusPaper(selection);});
q('binding-return').addEventListener('click',()=>{if(selection)focusPaper(selection);});
function drawVariables(item:Outline){
  const selected=item.inline?.type==='field-ref'&&item.inline.scope&&item.inline.key
    ?{scope:item.inline.scope,key:item.inline.key}:item.node?.type==='image'?item.node.props?.source:undefined;
  q('binding-inspector').hidden=!selected;
  q('binding-return').hidden=!selected;
  q('binding-targets').replaceChildren();
  q<HTMLButtonElement>('binding-name').disabled=!selected;
  q('binding-name').textContent=selected?selected.scope+' · '+selected.key:'';
  variables.querySelector('[aria-current=true]')?.removeAttribute('aria-current');
  q('variable-detail').textContent='';
  for(const stale of contextVariables.children){
    for(const [schema,group] of variableGroups)if(group===stale)variableGroups.delete(schema);
  }
  const scopes=variableScopes(item);
  contextVariables.replaceChildren(...scopes.filter(scope=>scope.scope==='group'||scope.scope==='item')
    .map(({schema,scope,label})=>variableGroup(schema,scope,label)));
  if(selected){
    const scope=scopes.find(scope=>scope.scope===selected.scope);
    if(scope){
      const seen=lastBinding.get(scope.schema)??new Map<string,string>();
      seen.set(selected.key,refKey(item.ref));lastBinding.set(scope.schema,seen);
    }
    const group=scope&&variableGroups.get(scope.schema);
    const field=group&&[...group.querySelectorAll<HTMLButtonElement>('[data-variable-path]')]
      .find(control=>control.dataset.variablePath===selected.key);
    if(field&&scope){field.setAttribute('aria-current','true');q('variable-detail').textContent=scope.label+' › '+field.textContent;}
  }
}

function select(item: Outline, measure: boolean, spacing?:'before'|'after') {
  const started=performance.now();
  if(paper.classList.contains('has-column-highlight')){
    for(const cell of paper.querySelectorAll('.column-highlight'))cell.classList.remove('column-highlight');
    paper.classList.remove('has-column-highlight');
  }
  if(selection) {
    treeNodes.get(selection)?.removeAttribute('aria-current');
    if(selection.ref.band){
      const key=CSS.escape(refKey(selection.ref));
      for(const control of paper.querySelectorAll('[data-paper-ref="'+key+'"]'))control.removeAttribute('aria-current');
    }else paperNodes.get(selection)?.removeAttribute('aria-current');
  }
  if(inlineTarget&&inlineTarget!==item)closeInlineEditor();
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
  const preferred=item.format;
  const currentSheet=sectionSheets.get(root);
  const control=paperNodes.get(item);
  if(preferred&&(!currentSheet?.contains(control??null)||control?.classList.contains('definition-format-choice'))){
    for(const [candidate] of paperNodes)if(candidate.section===root.section)paperNodes.delete(candidate);
    const nextSheet=drawSectionPaper(root,preferred);
    currentSheet?.replaceWith(nextSheet);sectionSheets.set(root,nextSheet);
    if(!measure){const target=paperNodes.get(item);if(target)scrollWithin(paper.parentElement!,target);}
  }
  const treeTarget=treeNodes.get(item);
  treeTarget?.setAttribute('aria-current','true');
  if(!measure&&treeTarget)scrollWithin(tree,treeTarget);
  if(item.ref.band){
    const key=CSS.escape(refKey(item.ref));
    for(const control of paper.querySelectorAll('[data-paper-ref="'+key+'"]'))control.setAttribute('aria-current','true');
  }else paperNodes.get(item)?.setAttribute('aria-current','true');
  q('selection').textContent=item.label;
  q('selection-detail').textContent=item.detail??(item.inline?.type==='text'?'แก้ข้อความนี้ได้บนกระดาษ':kinds[item.type]??item.type);
  const target=paperNodes.get(item);
  q<HTMLButtonElement>('zoom-selection').disabled=!target||item.type==='section';
  if(measure&&target&&paper.contains(target)){
    scrollWithin(paper.parentElement!,target);
  }
  q('path').textContent=path.join(' › ');
  form.hidden=item.type!=='section'||!!draft.readOnly;
  if(item.type==='section'&&!hasConflict) input.value=item.label;
  if(!hasConflict)status.textContent='';
  drawVariables(item);
  fitPaper();
  showLayoutFacts(item,spacing);
  showActions(item);
  updatePaperTools(item);
  if(measure)afterPaint('flowdoc:tree-selection',started,{type:item.type});
}
function reveal(item:Outline){
  for(let parent=item.parent;parent;parent=parent.parent)expanded.set(refKey(parent.ref),true);
}
const isDirty=()=>Boolean(draft&&draft.definition!==savedDefinition);
function confirmNavigation(event:BeforeUnloadEvent){event.preventDefault();event.returnValue='';}
type CatalogEntry={templateId:string;relatedDrafts?:{id:string;source:number}[];issuerVersion?:number|null;libraryVersions?:{pinned:number|null;versions:number[]}};
let draftContext:{parent:string;source?:number;active?:number}|undefined;
const compareSaved=q<HTMLButtonElement>('compare-saved');
compareSaved.onclick=()=>{
  if(!draftContext||!templateId||isDirty()||isSaving||hasConflict)return;
  const query=new URLSearchParams({phase1:'1',compareDraft:templateId});
  location.assign('/library.html?'+query+'#'+draftContext.parent);
};
async function readDraftContext(){
  if(!templateId||paperOnly||sharedPreview)return;
  try{
    const response=await fetch('/api/editor-phase1/catalog');
    if(!response.ok)return;
    const entries=(await response.json()).items as CatalogEntry[];
    const parent=entries.find(row=>row.relatedDrafts?.some(copy=>copy.id===templateId))??entries.find(row=>row.templateId===templateId);
    if(!parent)return;
    const source=parent.relatedDrafts?.find(copy=>copy.id===templateId)?.source;
    draftContext={parent:parent.templateId,source,active:parent.issuerVersion??parent.libraryVersions?.pinned??parent.libraryVersions?.versions[0]};
    if(draft)updateDraftHeader();
  }catch{/* The draft remains available if the library is offline. */}
}
function updateDraftHeader(){
  if(!draft||paperOnly||sharedPreview||draft.readOnly)return;
  const origin=draftContext?.source?'ร่างจากรุ่น '+draftContext.source:'ฉบับร่างปัจจุบัน';
  const state=hasConflict?'มีฉบับใหม่กว่า':isSaving?'กำลังบันทึก':isDirty()?'มีการแก้ไขที่ยังไม่บันทึก':draft.revision?'บันทึกครั้งที่ '+draft.revision:'ยังไม่บันทึก';
  q('revision').textContent=[origin,state,draftContext?.active?'ระบบรับงานใช้รุ่น '+draftContext.active:''].filter(Boolean).join(' · ');
  q('editor-badge').textContent=showingPreview?'Preview ฉบับร่าง':'แก้ฉบับร่าง';
  compareSaved.hidden=!draftContext?.active;
  compareSaved.disabled=isDirty()||isSaving||hasConflict||!draft.revision;
  compareSaved.title=compareSaved.disabled?'บันทึกร่างก่อนทาบ':'เทียบโครงที่บันทึกกับรุ่นที่ระบบรับงานใช้อยู่';
}
function refreshButtons(){
  const dirty=isDirty();
  updateDraftHeader();
  q('structure-pending').hidden=!dirty;
  if(dirty)window.addEventListener('beforeunload',confirmNavigation);
  else window.removeEventListener('beforeunload',confirmNavigation);
  q<HTMLButtonElement>('save-structure').disabled=!dirty||isSaving||hasConflict;
  q<HTMLButtonElement>('undo-structure').disabled=isSaving||hasConflict||!history.length;
  q<HTMLButtonElement>('discard-structure').disabled=isSaving||hasConflict||!savedDefinition;
  q<HTMLButtonElement>('add-section').disabled=isSaving||hasConflict||!!draft.readOnly;
  previewTab.disabled=dirty||!templateId||isSaving||hasConflict;
  previewTab.title=previewTab.disabled?'บันทึกโครงก่อนลองข้อมูล':'ลองค่าตัวแปรบนกระดาษเสมือน';
  save.disabled=dirty||isSaving||hasConflict||!templateId||!!draft.readOnly;
  input.readOnly=dirty||isSaving||!!draft.readOnly;
  if(selection)showActions(selection);
  for(const control of variables.querySelectorAll<HTMLButtonElement>('[data-schema-action]'))control.disabled=isSaving||hasConflict;
}
function showDraft(data: Draft, keep?: Ref) {
  draft=data;
  title.textContent=data.name;
  q('revision').textContent=data.revision?'Model 20 · Revision '+data.revision:'Model 20 · ฉบับร่างใหม่';
  q('creation-steps').hidden=Boolean(templateId)||!creationMode();
  q('editor-badge').textContent=data.readOnly?'อ่านอย่างเดียว':'แก้โครงเอกสาร';
  const prior=new Map(roots.map(root=>[root.section,root]));
  roots=data.definition.sections.map(section=>prior.get(section)??outline(section));
  outlines=new Map();
  const index=(item:Outline)=>{outlines.set(refKey(item.ref),item);item.children.forEach(index);};
  roots.forEach(index);
  for(const key of expanded.keys())if(!outlines.has(key))expanded.delete(key);
  const selected=(keep&&outlines.get(refKey(keep)))??roots[0];
  const availableFormats=new Set(data.definition.areaFormats?Object.values(data.definition.areaFormats):[]);
  for(const [key,format] of activeFormats)if(!availableFormats.has(format))activeFormats.delete(key);
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
  const viewport=paper.parentElement!,paperScroll=viewport.scrollTop;
  for(const [root] of sectionSheets)if(!roots.includes(root))sectionSheets.delete(root);
  for(const [item] of paperNodes)if(outlines.get(refKey(item.ref))!==item)paperNodes.delete(item);
  const sheets=roots.map(root=>{
    let sheet=sectionSheets.get(root);
    if(!sheet){sheet=drawSectionPaper(root,root.section===selected.section?selected.format:undefined);sectionSheets.set(root,sheet);}
    return sheet;
  });
  paper.replaceChildren(...sheets);viewport.scrollTop=paperScroll;
  drawDefinitionVariables();
  select(selected,false);
  refreshButtons();
  editor.hidden=showingPreview;
  document.body.dataset.revision=String(data.revision);
}
const dialog=q<HTMLDialogElement>('structure-dialog'), actionForm=q<HTMLFormElement>('structure-form');
type FormField={key:string;label:string;options?:[string,string][];value?:string;numeric?:boolean};
type FormControls=Map<string,HTMLInputElement|HTMLSelectElement>;
function ask(title:string, fields:FormField[], run:(values:Record<string,string>)=>void, note?:string, setup?:(controls:FormControls)=>void){
  const prior=selection?.ref;
  let submitted=false;
  const heading=element('h2',title);heading.id='structure-dialog-title';
  dialog.setAttribute('aria-labelledby',heading.id);actionForm.replaceChildren(heading);
  if(note)actionForm.append(element('p',note));
  const controls:FormControls=new Map();
  for(const field of fields){
    const label=element('label',field.label);
    const control=field.options?element('select'):element('input');
    control.required=true;control.name=field.key;
    if(control instanceof HTMLInputElement&&field.numeric){control.type='number';control.min='0';control.step='any';}
    if(control instanceof HTMLSelectElement)for(const [value,text] of field.options??[]){
      const option=element('option',text);option.value=value;control.append(option);
    }
    if(field.value!==undefined)control.value=field.value;
    controls.set(field.key,control);label.append(control);actionForm.append(label);
  }
  const error=element('p');error.id='structure-error';error.setAttribute('role','alert');
  const submit=element('button','ยืนยัน');submit.type='submit';submit.className='primary';
  actionForm.append(error,submit,button('ยกเลิก',()=>dialog.close()));
  actionForm.onsubmit=event=>{
    event.preventDefault();
    try{run(Object.fromEntries([...controls].map(([key,el])=>[key,el.value.trim()])));submitted=true;dialog.close();}
    catch(e){error.textContent=e instanceof Error?e.message:'แก้โครงไม่สำเร็จ';}
  };
  if(setup&&prior)dialog.addEventListener('close',()=>{
    const original=outlines.get(refKey(prior));
    if(submitted||!original||selection===original)return;
    select(original,false);
    q('paper-actions').querySelector<HTMLButtonElement>('.paper-quick-action button')?.focus({preventScroll:true});
  },{once:true});
  setup?.(controls);
  dialog.showModal();
}
function stage(change:Change){
  if(isSaving||hasConflict||draft.readOnly)return;
  const result=applyStructureChange(draft.definition,change);
  stageDefinition(result.definition,result.selection,change.kind);
}
function stageDefinition(definition:Definition,keep:Ref,action:string){
  if(isSaving||hasConflict||draft.readOnly)return;
  const started=performance.now();
  history.push({definition:draft.definition,selection:selection!.ref});
  if(history.length>20)history.shift();
  cancelPreview();
  showDraft({...draft,definition},keep);
  status.textContent='แก้บนกระดาษแล้ว · กดบันทึกร่างก่อนเปิด Preview';
  afterPaint('flowdoc:structure-edit',started,{action});
}
function outlinePath(item:Outline){
  const labels=[item.label];for(let p=item.parent;p;p=p.parent)labels.unshift(p.label);
  return labels.join(' › ');
}
function destinations(item:Outline){
  if(item.parent?.type==='column'&&item.ref.band&&['text-block','image','line'].includes(item.type))
    return (item.parent.parent?.children??[]).filter(column=>column!==item.parent&&!item.node?.props?.anchorId);
  if(item.type==='area')return roots.filter(x=>x.section!==item.section);
  if(item.type==='format')return [...outlines.values()].filter(x=>x.type==='area'&&x!==item.parent);
  if(['text-block','image'].includes(item.type)&&item.parent?.type==='table-cell')
    return (item.parent.parent?.children??[]).filter(x=>x!==item.parent&&canMoveBetweenCells(draft.definition,item.ref,x.ref));
  return [];
}
function askArea(at:Ref){
  ask('เพิ่ม Area พร้อม Format แรก',[{key:'key',label:'ชื่อ Area'},{key:'format',label:'ชื่อ Format แรก'}],
    v=>stage({kind:'area',at,key:v.key,format:v.format}),'Area เป็นตำแหน่งบนกระดาษ ส่วน Format กำหนดสิ่งที่จะวางในพื้นที่นี้');
}
function askVariable(at:Ref,scope:'global'|'section'|'local'|'header'|'footer',label:string){
  const types:[string,string][]=[['string','ข้อความ'],['image','ภาพ'],['link','ลิงก์']];
  if(!['header','footer'].includes(scope))types.push(['array','รายการ']);
  ask('ประกาศตัวแปร · '+label,[{key:'key',label:'ชื่อตัวแปร'},{key:'type',label:'ชนิด',options:types},
    {key:'required',label:'การส่งค่า',options:[['no','ไม่บังคับ'],['yes','บังคับ']]}],
    v=>stageDefinition(addVariable(draft.definition,at,scope,v),at,'variable'));
}
type FontOption={releaseId:string;familyName:string;version:number;faces:{weight:number;style:string}[]};
let fontCatalog:Promise<FontOption[]>|undefined;
function listFonts(){
  return fontCatalog??=fetch('/api/editor-phase1/fonts').then(async response=>{
    if(!response.ok)throw Error('เปิดคลังฟอนต์ไม่ได้');
    const body=await response.json();
    return body.value.releases as FontOption[];
  }).catch(()=>{fontCatalog=undefined;return [];});
}
async function editPart(at:Ref,part:Part,label:string,focusNodeId?:string){
  const fonts=part==='styles'?await listFonts():[];
  if(isSaving||hasConflict)return;
  const section=draft.definition.sections.find(s=>s.id===at.sectionId)!;
  const variables=new Set<string>();
  function names(schema:Schema|undefined){
    for(const [key,field] of Object.entries(schema?.fields??{})){
      variables.add(key);
      if(field.items)names(field.items);
    }
  }
  for(const schema of [draft.definition.globalSchema,section.inputSchema,section.header?.inputSchema,
    section.footer?.inputSchema,draft.definition.areaFormats?.[at.formatId??'']?.inputSchema])names(schema);
  openVisualAuthoring(q<HTMLDialogElement>('visual-definition-dialog'),part,label,partValue(draft.definition,at,part),{
    font:fonts.map(font=>({value:font.releaseId,label:font.familyName+' · '+font.version+' · '+font.faces.map(face=>face.weight+' '+face.style).join(', ')})),
    style:Object.keys(draft.definition.styles).map(key=>({value:key,label:key})),
    variable:[...variables].map(key=>({value:key,label:key})),
  },value=>stageDefinition(applyPart(draft.definition,at,part,value),focusNodeId?selection!.ref:at,'part'),focusNodeId);
}
function paperSettings(item:Outline){
  const at=item.ref;
  const layout=draft.definition.pageLayouts?.[item.section.pageLayoutId??draft.definition.book.defaultPageLayoutId]?.page;
  const edges=['top','right','bottom','left'] as const;
  const labels=['บน','ขวา','ล่าง','ซ้าย'];
  ask('ขนาดกระดาษและระยะขอบ',[{key:'size',label:'ขนาด',value:layout?.size??'A4',options:[['A4','A4'],['Letter','Letter']]},
    {key:'orientation',label:'แนว',value:layout?.orientation??'portrait',options:[['portrait','แนวตั้ง'],['landscape','แนวนอน']]},
    ...edges.map((key,i)=>{const length=layout?.margin?.[key];return {key,label:'ขอบ'+labels[i]+' (pt)',numeric:true,value:String(length?length.value*(length.unit==='mm'?72/25.4:1):36)};})],
    v=>stageDefinition(changePage(draft.definition,at,settings(v)),at,'page'));
}
function bandSettings(item:Outline){
  const at=item.ref,band=item.band!;
  const get=(length?:Length)=>String(length?length.value*(length.unit==='mm'?72/25.4:1):0);
  const margin=draft.definition.pageLayouts?.[item.section.pageLayoutId??draft.definition.book.defaultPageLayoutId]?.page.margin;
  const footer=at.band==='footer',edge=footer?'bottom':'top',sizing=band.sizing;
  ask('ขนาดและระยะ · '+item.label,[{key:'left',label:'จากขอบซ้าย (pt)',numeric:true,value:get(band.placement?.left??margin?.left)},
    {key:'right',label:'จากขอบขวา (pt)',numeric:true,value:get(band.placement?.right??margin?.right)},
    {key:'offset',label:'จากขอบ'+(footer?'ล่าง':'บน')+' (pt)',numeric:true,value:get(band.placement?.offset??margin?.[edge])},
    {key:'mode',label:'ความสูงของแถบ',value:sizing?.height?'fixed':'content',options:[['content','ตามเนื้อหา'],['fixed','กำหนดความสูง']]},
    {key:'height',label:'ความสูง (pt)',numeric:true,value:sizing?.height?get(sizing.height):'40'},
    {key:'gap',label:'ระยะถึงเนื้อหา (pt)',numeric:true,value:get(band.gap)}],
    values=>{
      const pt=(key:string)=>{const value=Number(values[key]);if(!Number.isFinite(value)||value<0||value>420)throw Error('ตรวจระยะ 0–420 pt');return {value,unit:'pt'};};
      const nextSizing=values.mode==='fixed'?{mode:'fixed',height:pt('height')}:sizing?.height?{mode:'content'}:sizing;
      stageDefinition(applyPart(draft.definition,at,'band',{...band,
        placement:{mode:'page',left:pt('left'),right:pt('right'),offset:pt('offset')},
        ...(nextSizing?{sizing:nextSizing}:{}),gap:pt('gap')}),at,'band-settings');
    },undefined,controls=>{
      const mode=controls.get('mode')!,height=controls.get('height')!;
      const update=()=>{height.disabled=mode.value!=='fixed';height.closest('label')!.hidden=height.disabled;};
      mode.addEventListener('change',update);update();
    });
}
function nodeOptions(item:Outline):[string,string][]{
  if(item.type==='table-cell')return [['text-block','ข้อความ'],['image','ภาพ']];
  if(['header','footer'].includes(item.type))return [['text-block','ข้อความ'],['line','เส้น'],['image','ภาพ']];
  if(['section','format'].includes(item.type))return [['text-block','ข้อความ'],['table','ตาราง 2 คอลัมน์'],['line','เส้น'],['page-break','ขึ้นหน้าใหม่'],['image','ภาพ'],['table-of-contents','สารบัญ']];
  return [];
}
function chooseNode(item:Outline,options:[string,string][],position?:{anchor:string;side:'before'|'after'}){
  const at=item.ref;
  ask((position?(position.side==='before'?'แทรกก่อน':'แทรกหลัง'):'เพิ่มใน')+' · '+item.label,[{key:'type',label:'ชนิดองค์ประกอบ',options}],v=>{
    if(v.type==='image'){
      const scopes:[string,Schema|undefined][]=[['global',draft.definition.globalSchema],['section',item.section.inputSchema],
        ['local',item.format?.inputSchema],...(item.ref.band?[[item.ref.band,item.band?.inputSchema] as [string,Schema|undefined]]:[])];
      const images=scopes.flatMap(([scope,schema])=>Object.entries(schema?.fields??{}).filter(([,f])=>f.type==='image')
        .map(([key])=>[scope+':'+key,scope+' › '+key] as [string,string]));
      if(!images.length)throw Error('ประกาศตัวแปรชนิดภาพก่อน');
      queueMicrotask(()=>ask('เลือกตัวแปรสำหรับกรอบภาพ',[{key:'source',label:'ตัวแปรภาพ',options:images}],values=>{
        const [scope,key]=values.source.split(':');stage({kind:'node',at,type:'image',source:{scope,key},position});
      }));
    }else stage({kind:'node',at,type:v.type,position});
  });
}
function askBinding(item:Outline){
  const options=variableScopes(item).flatMap(({scope,label,schema})=>Object.entries(schema.fields)
    .filter(([,f])=>f.type==='string'||f.type==='link').map(([key])=>[scope+':'+key,label+' › '+key] as [string,string]));
  if(!options.length){status.textContent='ประกาศตัวแปรข้อความหรือลิงก์ในขอบเขตนี้ก่อน';return;}
  ask('ผูกตัวแปรกับข้อความ',[{key:'field',label:'ตัวแปร',options}],values=>{
    const [scope,key]=values.field.split(':');stage({kind:'binding',at:item.ref,scope,key});
  });
}
function displayLength(value:Length){return new Intl.NumberFormat('th-TH',{maximumFractionDigits:3}).format(value.value)+' '+value.unit;}
function editLineSpacing(item:Outline,side:'before'|'after'){
  if(isSaving||hasConflict||draft.readOnly)return;
  const before=side==='before';
  const prior=(before?item.node?.props?.spaceBefore:item.node?.props?.spaceAfter)??{value:0,unit:'pt'};
  const label=before?'ระยะเว้นก่อนเส้น':'ระยะเว้นหลังเส้น';
  ask('ปรับ'+label,[{key:'length',label:label+' ('+prior.unit+')',numeric:true,value:String(prior.value)}],values=>{
    const value=Number(values.length);
    if(value!==prior.value)stage({kind:'line-spacing',at:item.ref,side,length:{value,unit:prior.unit}});
  },outlinePath(item)+' · ใส่ 0 เพื่อนำระยะเว้นนี้ออก');
}
const paddingNames={top:'บน',right:'ขวา',bottom:'ล่าง',left:'ซ้าย'};
function inspectColumn(table:Outline,index:number){
  select(table,true);
  const width=table.node?.columns?.[index]?.width;
  if(width){
    const description=element('p','คอลัมน์ '+(index+1)+' · กว้าง '+displayLength(width));
    description.className='layout-column-result';description.setAttribute('role','status');
    q('layout-facts').prepend(description);
  }
  const view=paperNodes.get(table)?.closest('.definition-table');
  paper.classList.toggle('has-column-highlight',Boolean(view));
  for(const cell of view?.querySelectorAll<HTMLTableCellElement>(':scope > table > tbody > tr > td')??[]){
    const start=Number(cell.dataset.authoredColumn)-1;
    cell.classList.toggle('column-highlight',start<=index&&index<start+cell.colSpan);
  }
}
function editTableRow(table:Outline,current?:Outline){
  const rows=table.children.filter(child=>child.type==='table-row');
  const headerCount=table.node?.props?.headerRowCount??0;
  const available=rows.slice(headerCount);
  const chosen=current&&available.includes(current)?current:available[0];
  if(!chosen)return;
  ask('แก้แถวในตาราง',[
    {key:'row',label:'แถวต้นแบบ',value:chosen.id,options:available.map((row,index)=>[row.id,'แถว '+(index+headerCount+1)])},
    {key:'break',label:'เมื่อแถวไม่พอดีท้ายหน้า',options:[['keep','ย้ายทั้งแถวไปหน้าถัดไป'],['split','อนุญาตให้แบ่งแถวข้ามหน้า']]},
  ],values=>{
    const row=available.find(item=>item.id===values.row)!;
    const allowBreak=values.break==='split';
    if(allowBreak!==Boolean(row.node?.props?.allowBreak))stage({kind:'row-break',at:row.ref,allowBreak});
  },'การตั้งค่านี้ใช้กับแถวต้นแบบที่เลือก รวมถึงทุกครั้งที่แถวนี้ถูกนำมาวนซ้ำ'+
    (headerCount?' · หัวตารางอยู่ด้วยกันเสมอ':''),controls=>{
    const picker=controls.get('row')!,setting=controls.get('break')!;
    const update=()=>{
      const row=available.find(item=>item.id===picker.value)!;
      setting.value=row.node?.props?.allowBreak?'split':'keep';
      select(row,true);
    };
    picker.addEventListener('change',update);update();
  });
}
function editTableColumn(table:Outline,chosen:number){
  const columns=table.node?.columns??[];
  if(!columns.length)return;
  const index=chosen<columns.length?chosen:0;
  ask('แก้ความกว้างคอลัมน์',[
    {key:'column',label:'คอลัมน์',value:String(index),options:columns.map((_,i)=>[String(i),'คอลัมน์ '+(i+1)])},
    {key:'width',label:'ความกว้าง (pt)',numeric:true},
  ],values=>{
    const column=Number(values.column),value=Number(values.width);
    const prior=columns[column]?.width;
    if(prior&&value===lengthInPoints(prior))return;
    stage({kind:'column-width',at:table.ref,column,length:{value,unit:'pt'}});
    const updated=outlines.get(refKey(table.ref));
    if(updated)inspectColumn(updated,column);
  },'เปลี่ยนความกว้างของคอลัมน์นี้ตลอดทั้งตาราง',controls=>{
    const picker=controls.get('column')!,width=controls.get('width')!;
    const update=()=>{
      const column=Number(picker.value),prior=columns[column]?.width;
      width.value=prior?String(lengthInPoints(prior)):'';
      inspectColumn(table,column);
    };
    picker.addEventListener('change',update);update();
  });
}
function editTableCell(table:Outline,current?:Outline){
  const targets=table.children.filter(child=>child.type==='table-row').flatMap((row,index)=>
    row.children.filter(child=>child.type==='table-cell').map((cell,position)=>({
      cell,label:'แถว '+(index+1)+' · คอลัมน์ '+((cell.node?.props?.columnIndex??position)+1)+
        ((cell.node?.props?.colSpan??1)>1?' (เซลล์ผสาน)':''),
    })));
  const chosen=targets.find(target=>target.cell===current)??targets[0];
  if(!chosen)return;
  const padding=(cell:Outline,side:typeof paddingSides[number])=>{
    const prior=cell.node?.props?.padding?.[side];
    return prior?lengthInPoints(prior):defaultCellPadding;
  };
  ask('แก้ระยะขอบในเซลล์',[
    {key:'cell',label:'เซลล์',value:chosen.cell.id,options:targets.map(({cell,label})=>[cell.id,label])},
    ...paddingSides.map(side=>({key:side,label:'ขอบ'+paddingNames[side]+' (pt)',numeric:true})),
  ],values=>{
    const {cell}=targets.find(target=>target.cell.id===values.cell)!;
    const changed=paddingSides.flatMap(side=>{
      const value=Number(values[side]);
      return value===padding(cell,side)?[]:[[side,{value,unit:'pt' as const}]];
    });
    if(changed.length)stage({kind:'cell-padding',at:cell.ref,padding:Object.fromEntries(changed)});
  },'ระยะจากขอบเซลล์ถึงเนื้อหาภายใน · ใช้กับเซลล์ที่เลือก',controls=>{
    const picker=controls.get('cell')!;
    const update=()=>{
      const {cell}=targets.find(target=>target.cell.id===picker.value)!;
      for(const side of paddingSides)controls.get(side)!.value=String(padding(cell,side));
      select(cell,true);
    };
    picker.addEventListener('change',update);update();
  });
}
function paintControl(item:Outline,property:'color'|'borderColor'|'fillColor',label:string){
  const group=element('fieldset');group.className='paint-control';group.dataset.paint=property;
  group.append(element('legend',label));
  const current=item.node?.props?.[property]?.toUpperCase();
  const apply=(value:string)=>{if(value!==current)tryStage({kind:'paint',at:item.ref,property,value});};
  for(const [value,name] of [['172A3A','กรมท่า'],['286695','น้ำเงิน'],['187A65','เขียว'],['B94C39','แดง'],['FFFFFF','ขาว'],['000000','ดำ']]){
    const swatch=button('',()=>apply(value));swatch.style.backgroundColor='#'+value;
    swatch.dataset.color=value;swatch.title=name+' #'+value;swatch.setAttribute('aria-label',swatch.title);
    swatch.setAttribute('aria-pressed',String(value===current));group.append(swatch);
  }
  const custom=element('input');custom.type='color';custom.value='#'+(current??'000000');
  custom.title='เลือกสีเอง';custom.setAttribute('aria-label',label+' · เลือกสีเอง');
  custom.addEventListener('change',()=>apply(custom.value.substring(1).toUpperCase()));
  group.append(custom);group.disabled=isSaving||hasConflict||draft.readOnly===true;
  return group;
}
function showLayoutFacts(item:Outline,spacing?:'before'|'after'){
  const panel=q('layout-facts'),summary=q('paper-layout-summary'),actions=q('paper-layout-actions');
  actions.replaceChildren();
  panel.replaceChildren();summary.textContent='';summary.hidden=true;
  const note=(label:string,value:string)=>{
    const block=element('div');block.className='layout-fact';
    block.append(element('strong',label),element('p',value));panel.append(block);
    if(summary.hidden){summary.textContent=label+' · '+value;summary.hidden=false;}
  };
  const navigate=(label:string,target:Outline)=>panel.append(button(label,()=>select(target,true)));
  const edit=(label:string,run:()=>void)=>{
    const control=button(label,run);control.disabled=isSaving||hasConflict||draft.readOnly===true;
    if(!draft.readOnly)actions.append(control);
    return control;
  };
  const paint=q('paper-paint');paint.replaceChildren();
  if(item.type==='line')paint.append(paintControl(item,'color','สีเส้น'));
  if(item.type==='table')paint.append(paintControl(item,'borderColor','สีขอบตาราง'));
  if(item.type==='table-cell')paint.append(paintControl(item,'fillColor','สีพื้นเซลล์'));
  const lineage:Outline[]=[];
  for(let current:Outline|undefined=item;current;current=current.parent)lineage.push(current);
  const table=lineage.find(current=>current.type==='table');
  const row=lineage.find(current=>current.type==='table-row');
  const cell=lineage.find(current=>current.type==='table-cell');
  const band=lineage.find(current=>current.type==='header'||current.type==='footer');
  const props=item.node?.props;
  if(table){
    const rows=table.node?.rowIds?.length??0,columns=table.node?.columns?.length??0;
    const rowNumber=row&&table.node?.rowIds?table.node.rowIds.indexOf(row.id)+1:0;
    const cellIndex=cell&&row?.node?.cellIds?row.node.cellIds.indexOf(cell.id):-1;
    const column=cell?(cell.node?.props?.columnIndex??cellIndex)+1:0;
    const position=[rowNumber?'แถว '+rowNumber+(rowNumber<=(table.node?.props?.headerRowCount??0)?' (หัวตาราง)':''):'',
      column?'คอลัมน์ '+column+(cell?.node?.props?.colSpan&&cell.node.props.colSpan>1?' ครอบ '+cell.node.props.colSpan+' คอลัมน์':''):''].filter(Boolean);
    note(position.length?'อยู่ในตาราง · '+position.join(' · '):'ตาราง',rows+' แถวต้นแบบ × '+columns+' คอลัมน์');
    actions.append(element('strong','แก้ตาราง'));
    const editRow=edit('การแบ่งหน้าแถว',()=>editTableRow(table,row));
    if(rows<=(table.node?.props?.headerRowCount??0)){
      editRow.disabled=true;editRow.title='ตารางนี้มีเฉพาะหัวตาราง';
    }
    edit('ความกว้างคอลัมน์',()=>editTableColumn(table,Math.max(0,column-1)));
    edit('ระยะขอบในเซลล์',()=>editTableCell(table,cell));
    if(row)note('การแบ่งหน้า',
      rowNumber<=(table.node?.props?.headerRowCount??0)?'หัวตารางอยู่ด้วยกัน':
      row.node?.props?.allowBreak?'อนุญาตให้แบ่งแถวข้ามหน้า':'ย้ายทั้งแถวไปหน้าถัดไปเมื่อพื้นที่ไม่พอ');
    if(table.node?.props?.borderColor?.toUpperCase()==='FFFFFF')
      note('เส้นขอบสีขาว','ตารางนี้กำหนดเส้นขอบสีขาวไว้ กรอบสีเขียวอ่อนบนกระดาษช่วยให้เห็นโครงของตาราง');
    const rules=table.children.filter(child=>child.type==='row-group'||child.type==='repeat');
    if(rules.length)note('ตารางนี้มีแถววนซ้ำ',rules.map(rule=>rule.label).join(' · '));
    const padding=cell?.node?.props?.padding;
    if(cell){
      const values=paddingSides.map(side=>paddingNames[side]+' '+(padding?.[side]?displayLength(padding[side]):defaultCellPadding+' pt'));
      note('ระยะขอบในเซลล์',values.join(' · '));
    }
    if(cell&&cell!==item)navigate('เลือกเซลล์',cell);
    if(table!==item)navigate('เลือกตาราง',table);
  }
  if(item.type==='text-block'&&!item.node?.children?.length&&props?.heightMode==='fixed'&&props.height){
    const prior=props.height;
    note('ความสูงบล็อกเว้นระยะ',displayLength(prior));
    edit('ปรับความสูง',()=>ask('ปรับความสูงบล็อกเว้นระยะ',[
      {key:'height',label:'ความสูง ('+prior.unit+')',numeric:true,value:String(prior.value)},
    ],values=>{
      const value=Number(values.height);
      if(value!==prior.value)stage({kind:'spacer-height',at:item.ref,length:{unit:prior.unit,value}});
    }));
  }
  if(item.type==='line'){
    edit('ปรับระยะก่อนเส้น',()=>editLineSpacing(item,'before'));
    edit('ปรับระยะหลังเส้น',()=>editLineSpacing(item,'after'));
    const lengths=[props?.spaceBefore&&'ก่อนเส้น '+displayLength(props.spaceBefore),
      props?.spaceAfter&&'หลังเส้น '+displayLength(props.spaceAfter)].filter(Boolean);
    const chosen=spacing==='before'?props?.spaceBefore:spacing==='after'?props?.spaceAfter:undefined;
    if(chosen)note(spacing==='before'?'ช่องว่างก่อนเส้น':'ช่องว่างหลังเส้น','เส้นนี้กำหนดให้เว้น '+displayLength(chosen));
    if(lengths.length)note('ระยะที่ตั้งไว้กับเส้น',lengths.join(' · '));
    if(props?.color?.toUpperCase()==='FFFFFF')note('เส้นสีขาว','เส้นกลืนกับกระดาษ แต่ระยะเว้นก่อนหรือหลังเส้นยังมีผล');
  }
  const peers=item.parent?.children??[];
  const index=peers.indexOf(item);
  if(index>=0&&item.type!=='line'){
    for(const [neighbor,key,direction] of [[peers[index-1],'spaceAfter','ด้านบน'],[peers[index+1],'spaceBefore','ด้านล่าง']] as const){
      const length=neighbor?.type==='line'?neighbor.node?.props?.[key]:undefined;
      if(!length||length.value<=0)continue;
      note('ช่องว่าง'+direction,'เส้นที่อยู่ติดกันตั้งระยะเว้น '+displayLength(length));
      navigate('ไปยังเส้น'+direction,neighbor);
    }
  }
  const binding=item.inline?.type==='field-ref'&&item.inline.scope&&item.inline.key
    ?{scope:item.inline.scope,key:item.inline.key}:item.node?.type==='image'?item.node.props?.source:undefined;
  if(binding){
    const source=variableScopes(item).find(scope=>scope.scope===binding.scope);
    if(source)note('ผูกกับตัวแปร '+binding.key,source.label+' · ใส่ค่าตอนสร้างเอกสาร');
  }
  const text=lineage.find(current=>current.type==='text-block');
  const styleId=text?.node?.props?.textStyleId??(text?band?.band?.baseTextStyleId:undefined);
  const style=styleId?draft.definition.styles[styleId] as {lineHeightPt?:number}|undefined:undefined;
  if(style?.lineHeightPt)note('ระยะบรรทัดของข้อความ',style.lineHeightPt+' pt ตามสไตล์ข้อความ');
  if(item.type==='columns'&&props?.gap)note('ช่องว่างระหว่างคอลัมน์',displayLength(props.gap));
  if(item===band&&band.band){
    const definition=band.band;
    const values=[definition.placement?.offset&&'จากขอบกระดาษ '+displayLength(definition.placement.offset),
      definition.sizing?.height&&'ความสูง '+displayLength(definition.sizing.height),
      definition.gap&&'เว้นถึงเนื้อหา '+displayLength(definition.gap)].filter(Boolean);
    if(values.length)note('ตำแหน่ง'+itemType(band),values.join(' · '));
  }
  if(item.type==='table-of-contents')note('สารบัญอัตโนมัติ','Engine ดึงข้อความและเลขหน้าจากหัวข้อที่กำหนดระดับสารบัญไว้');
  if(item.type==='section'){
    const margins=draft.definition.pageLayouts?.[item.section.pageLayoutId??draft.definition.book.defaultPageLayoutId]?.page.margin;
    if(margins){
      const values=(['top','right','bottom','left'] as const).flatMap((side,i)=>margins[side]?[[ 'บน','ขวา','ล่าง','ซ้าย'][i]+' '+displayLength(margins[side])]:[]);
      if(values.length)note('ระยะขอบกระดาษ',values.join(' · '));
    }
    note('เริ่มจากกระดาษ','คลิกกรอบตารางหรือแถบระยะเว้นเพื่อดูว่าเป็นของส่วนไหน');
  }
  if(!panel.childElementCount)note(itemType(item),'ดูตำแหน่งจากชื่อส่วนเหนือกระดาษ และคลิกรายการใกล้กันเพื่อดูระยะของส่วนนั้น');
}
const editorTitle=document.querySelector<HTMLElement>('.editor-title')!;
const titleSize=new ResizeObserver(()=>document.documentElement.style.setProperty('--editor-title-height',editorTitle.offsetHeight+'px'));
titleSize.observe(editorTitle);
function itemType(item:Outline){return item.type==='text-block'?'กล่องข้อความ':kinds[item.type]??item.type;}
function showPaperLocation(item:Outline){
  const path=q('paper-path'),order=q('paper-order');
  path.replaceChildren();order.replaceChildren();
  const ancestors:Outline[]=[];
  for(let parent=item.parent;parent;parent=parent.parent)ancestors.unshift(parent);
  for(const ancestor of ancestors){
    const type=itemType(ancestor);
    const jump=button(ancestor.label.startsWith(type)?ancestor.label:type+' '+ancestor.label,()=>select(ancestor,true));
    jump.title=outlinePath(ancestor);
    path.append(jump,element('span','›'));
  }
  if(!ancestors.length)path.append(element('span','ระดับเอกสาร'));
  path.scrollLeft=path.scrollWidth;
  const selected=q('paper-selection');
  const type=itemType(item);
  const hasType=item.label===type||item.label.startsWith(type+' ');
  selected.replaceChildren(element('span','เลือกอยู่ · '+(hasType?item.label:type)));
  if(!hasType)selected.append(document.createTextNode(item.label));
  selected.title=outlinePath(item);
  if(draft.readOnly){
    order.append(element('p','ดูโครงต้นฉบับ · เปิดฉบับแก้ไขเพื่อเปลี่ยนโครง'));
    return;
  }

  if(item.inline&&item.parent){
    const parent=item.parent;
    order.append(button('เลือก'+itemType(parent),()=>select(parent,true)),
      element('span','เลือกทั้งกล่องเพื่อย้ายหรือลบ'));
    return;
  }
  const ordered=item;
  const state=structureOrder(draft.definition,ordered.ref);
  if(state?.ids.length===1&&state.up==='ถึงขอบเขตที่ย้ายได้แล้ว'){
    order.append(element('p','มีรายการเดียวในตำแหน่งนี้'));
    return;
  }
  if(item.type==='table-cell'&&item.parent){
    const row=item.parent;
    order.append(button('เลือก'+itemType(row),()=>select(row,true)),element('span','เซลล์อยู่กับแถว'));
    return;
  }
  if(!state){
    if(item.type==='format')order.append(element('p','จัดลำดับได้จากองค์ประกอบภายใน Format'));
    return;
  }
  const peers=ordered.parent?.children??roots;
  const label=(index:number)=>{
    const peer=peers.find(candidate=>candidate.id===state.ids[index]);
    return peer?(index+1)+'. '+peer.label:undefined;
  };
  const previous=label(state.index-1),next=label(state.index+1);
  order.append(element('strong','ลำดับ '+(state.index+1)+' จาก '+state.ids.length));
  const neighbors=[previous&&'ก่อนหน้า '+previous,next&&'ถัดไป '+next].filter(Boolean).join(' · ');
  if(neighbors){
    const detail=element('span',neighbors);detail.title=neighbors;order.append(detail);
  }
  const controls=element('div');
  for(const [delta,name,reason] of [[-1,'เลื่อนขึ้น',state.up],[1,'เลื่อนลง',state.down]] as const){
    const control=button(name,()=>{
      const keyboard=document.activeElement===control;
      tryStage({kind:'reorder',at:ordered.ref,delta});
      if(keyboard){
        const buttons=order.querySelectorAll<HTMLButtonElement>('button:not(:disabled)');
        const next=Array.from(buttons).find(candidate=>candidate.dataset.delta===String(delta))??buttons[0];
        next?.focus({preventScroll:true});
      }
    });
    control.dataset.delta=String(delta);
    control.title=reason||'สลับกับ '+(delta===-1?previous:next);
    control.disabled=Boolean(reason)||isSaving||hasConflict;
    controls.append(control);
  }
  if(state.up&&state.down){
    order.append(element('span',state.up));
    return;
  }
  order.append(controls);
}
function showActions(item:Outline){
  const actions=q('actions'),paperActions=q('paper-actions');
  actions.replaceChildren();paperActions.replaceChildren();
  showPaperLocation(item);
  if(draft.readOnly)return;
  const quick=element('div');
  quick.className='paper-quick-action';
  paperActions.append(quick);
  const directLabels=new Map([
    ['แก้ข้อความ','แก้ข้อความ'],['เปลี่ยนตัวแปรที่ผูก','เปลี่ยนตัวแปร'],
    ['แก้รูปแบบรายการนี้','แก้รูปแบบ'],['ขนาดกระดาษและระยะขอบ','ตั้งกระดาษ'],
    ['จัดเนื้อหา ตัวแปร และการวนแถว','แก้ Format'],
    ['ขนาดและระยะของแถบ','ขนาดและระยะ'],
    ['จัดเนื้อหาและรูปแบบหัว–ท้าย','แก้รูปแบบ'],['+ เพิ่ม Format','+ เพิ่ม Format'],
  ]);
  const groups={
    add:element('details'),edit:element('details'),more:element('details'),
  };
  const labels={add:'+ เพิ่ม',edit:'แก้ไข',more:'เพิ่มเติม'};
  for(const key of ['add','edit','more'] as const){
    const menu=groups[key];
    const label=element('summary',labels[key]);
    const commands=element('div');commands.className='paper-command-list';
    menu.append(label,commands);paperActions.append(menu);
    menu.addEventListener('toggle',()=>{
      if(menu.open)for(const other of Object.values(groups))if(other!==menu)other.open=false;
    });
  }
  if(creationMode()){
    const part:Part=item.ref.formatId?'format-schema':item.ref.band?'band-schema':'section-schema';
    const owner=item.format?.label??item.format?.key??(item.ref.band?(item.ref.band==='header'?'หัวกระดาษ':'ท้ายกระดาษ'):item.section.label);
    const control=button('นิยามตัวแปร',()=>{groups.more.open=false;void editPart(item.ref,part,'ตัวแปร · '+owner);});
    control.disabled=isSaving||hasConflict;groups.more.lastElementChild!.append(control);
  }
  const add=(name:string,run:()=>void,kind:keyof typeof groups='edit',sidebar=true)=>{
    const invoke=()=>{groups[kind].open=false;run();};
    for(const target of [groups[kind].lastElementChild!,...(sidebar?[actions]:[])]){
      const label=target===actions?name:name.replace('เพิ่ม node','เพิ่มองค์ประกอบ');
      const control=button(label,invoke);
      control.disabled=isSaving||hasConflict;target.append(control);
    }
    const direct=directLabels.get(name);
    const tableStructure=['table','table-row','table-cell'].includes(item.type);
    if(direct&&!quick.childElementCount&&!(tableStructure&&name==='แก้รูปแบบรายการนี้')){
      const control=button(direct,invoke);
      control.title=name;
      control.disabled=isSaving||hasConflict;quick.append(control);
    }
  };
  function finish(){
    const layoutControls=Array.from(q('paper-layout-actions').querySelectorAll<HTMLButtonElement>('button'));
    const primary=layoutControls.filter(control=>
      (item.type==='line'&&['ปรับระยะก่อนเส้น','ปรับระยะหลังเส้น'].includes(control.textContent??''))||
      (item.type==='table-cell'&&control.textContent==='ระยะขอบในเซลล์')||
      control.textContent==='ปรับความสูง');
    if(primary.length)quick.replaceChildren(...primary.map(control=>{
      const shortcut=button(control.textContent??'',()=>control.click());
      shortcut.disabled=control.disabled;
      return shortcut;
    }));
    if(!quick.childElementCount){
      const wanted=item.type==='table'?'ความกว้างคอลัมน์':undefined;
      const layoutAction=layoutControls.find(control=>!control.disabled&&(!wanted||control.textContent===wanted));
      if(layoutAction){
        const control=button(layoutAction.textContent??'',()=>layoutAction.click());
        control.title=layoutAction.textContent??'';
        quick.append(control);
      }
    }
    for(const layout of layoutControls){
      const control=button(layout.textContent??'',()=>{groups.edit.open=false;layout.click();});
      control.disabled=layout.disabled||isSaving||hasConflict;
      control.title=layout.title;
      groups.edit.lastElementChild!.append(control);
    }
    const empty={add:'เพิ่มรายการใหม่ในส่วนที่ครอบรายการนี้',edit:'เลือกรายการที่มีรายละเอียดให้แก้',more:''};
    for(const key of ['add','edit','more'] as const){
      const menu=groups[key],commands=menu.lastElementChild!;
      if(!commands.childElementCount){
        if(key==='more'){menu.hidden=true;continue;}
        commands.append(element('p',empty[key]));
        if(key==='add'){
          let parent=item.parent;
          while(parent&&!['section','area','format','header','footer','table','table-cell'].includes(parent.type))parent=parent.parent;
          if(parent){
            const destination=parent;
            commands.append(button('ไปที่ '+itemType(destination)+' เพื่อเพิ่ม',()=>select(destination,true)));
          }
        }
      }
    }
  }
  function addInlineContentEditor(){
    if(!creationMode()||!item.parent||(!item.ref.formatId&&!item.ref.band))return;
    const parent=item.parent;
    const {sectionId,formatId,band}=item.ref;
    add('เพิ่มหรือลบส่วนของข้อความ',()=>editPart({sectionId,formatId,band},
      band?'band':'format','แก้เนื้อหา · '+parent.label,parent.id),'edit',false);
  }
  if(item.inline?.type==='text'){
    add('แก้ข้อความ',()=>openInlineEditor(item));
    addInlineContentEditor();
    finish();return;
  }
  if(item.inline?.type==='field-ref'&&creationMode()){
    add('เปลี่ยนตัวแปรที่ผูก',()=>askBinding(item));
    addInlineContentEditor();
    finish();return;
  }
  if(item.ref.part){finish();return;}
  const at=item.ref;
  const promptKey=(label:string,run:(key:string)=>void)=>ask(label,[{key:'key',label:'ชื่อในนิยาม'}],v=>run(v.key));
  if(item.type==='section')add('+ เพิ่ม Section',addSection,'add',false);
  if(item.type==='section'||(item.type==='table-cell'&&!at.formatId&&!at.band)){
    add('+ เพิ่ม Area',()=>askArea(at),'add');
  }
  if(item.type==='section'){
    add('ขนาดกระดาษและระยะขอบ',()=>paperSettings(item));
    for(const band of ['header','footer'] as const)if(!item.section[band])add(band==='header'?'+ เพิ่มหัวกระดาษ':'+ เพิ่มท้ายกระดาษ',()=>stageDefinition(addBand(draft.definition,at,band),{sectionId:at.sectionId,band},'band'),'add');
  }
  if(item.type==='area')add('+ เพิ่ม Format',()=>promptKey('เพิ่ม Format ใน '+item.label,key=>stage({kind:'format',at,key})),'add');
  const options=nodeOptions(item);
  if(options.length)add('+ เพิ่ม node',()=>chooseNode(item,options),'add');
  if(creationMode()&&item.type==='text-block')add('ผูกตัวแปร',()=>askBinding(item));
  if(creationMode()&&item.node&&item.parent){
    const parent=item.parent, choices=nodeOptions(parent);
    if(choices.length){
      add('+ แทรกก่อน',()=>chooseNode(parent,choices,{anchor:item.id,side:'before'}),'add');
      add('+ แทรกหลัง',()=>chooseNode(parent,choices,{anchor:item.id,side:'after'}),'add');
    }
  }
  if(item.type==='header'||item.type==='footer'){
    add('ขนาดและระยะของแถบ',()=>bandSettings(item));
    add('+ เพิ่มเลขหน้า',()=>ask('เพิ่มเลขหน้า',[{key:'field',label:'ชนิด',options:[['current','เลขหน้าปัจจุบัน'],['total','จำนวนหน้าทั้งหมด']]}],
      v=>stage({kind:'node',at,type:'page-field',pageField:v.field as 'current'|'total'})),'add');
  }
  if(item.type==='text-block'){
    const editable=item.children.filter(child=>child.inline?.type==='text');
    if(editable.length===1)add('แก้ข้อความ',()=>openInlineEditor(editable[0]),'edit',false);
  }
  const plainRows=item.type==='table'&&canAddPlainRows(draft.definition,at);
  if(item.type==='table'&&!plainRows&&creationMode()&&at.formatId){
    add('จัดแถวและกฎการวนใน Format',()=>editPart({sectionId:at.sectionId,formatId:at.formatId},'format','จัดแถว · '+item.label,item.id),'add',false);
  }
  if(plainRows){
    add('+ เพิ่มแถว',()=>tryStage({kind:'node',at,type:'table-row'}),'add');
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
    for(const control of q('paper-order').querySelectorAll('button')){
      const copy=button(control.textContent??'',()=>control.click());
      copy.disabled=control.disabled;copy.title=control.title;actions.append(copy);
    }
  }
  const targets=destinations(item);
  if(targets.length){
    add('ย้ายไป…',()=>{
      ask('ย้าย '+item.label,[{key:'target',label:'ตำแหน่งใหม่',options:targets.map(x=>[refKey(x.ref),outlinePath(x)])}],
        v=>stage({kind:'move',at,to:outlines.get(v.target)!.ref}));
    },'more');
  }
  if(item.type==='section'&&sectionPublicationEnabled)add('เผยแพร่เวอร์ชันใหม่',()=>{
    ask('เผยแพร่เวอร์ชันใหม่',[],()=>{void publishSectionBackground();});
  });
  if(item.type==='section'&&sectionBackgroundEnabled)add('พื้นหลังกระดาษ',()=>void editSectionBackground(item));
  if(creationMode()){
    const part=(key:Part,label:string)=>add(label,()=>editPart(at,key,label));
    if(item.type==='section'){part('globalSchema','ตัวแปรทั้งเอกสาร');part('section-schema','ตัวแปรของ Section');part('styles','สไตล์เอกสาร');part('section-settings','กฎของ Section');}
    if(!at.formatId&&!at.band&&canEditSectionContent(item.section)){
      if(item.type==='section')part('section-content','จัดเนื้อหาและสไตล์ของ Section');
      if(item.node)add('แก้รูปแบบรายการนี้',()=>editPart({sectionId:at.sectionId},'section-content','แก้รูปแบบ · '+item.label,item.id),'edit',false);
    }
    if(item.type==='format')part('format','จัดเนื้อหา ตัวแปร และการวนแถว');
    if(item.type==='header'||item.type==='footer')part('band','จัดเนื้อหาและรูปแบบหัว–ท้าย');
    if(item.node&&at.formatId)add('แก้รูปแบบรายการนี้',()=>editPart({sectionId:at.sectionId,formatId:at.formatId},'format','แก้รูปแบบ · '+item.label,item.id),'edit',false);
    if(item.node&&at.band)add('แก้รูปแบบรายการนี้',()=>editPart({sectionId:at.sectionId,band:at.band},'band','แก้รูปแบบ · '+item.label,item.id),'edit',false);
  }
  if(item.type!=='table-cell'){
    const label='ลบ '+itemType(item);
    const remove=()=>ask(label+' · '+item.label,[],()=>stage({kind:'delete',at}),
      outlinePath(item)+(item.children.length?' · รายการย่อยจะถูกลบด้วย':'')+' · ย้อนกลับได้ก่อนบันทึก');
    const locked=item.type==='section'&&roots.length===1;
    if(!locked){
      const direct=button('ลบ',remove);
      direct.className='paper-remove';
      direct.setAttribute('aria-label',label);
      direct.title=label;
      direct.disabled=isSaving||hasConflict;
      paperActions.append(direct);
    }
    for(const target of [groups.more.lastElementChild!,actions]){
      const control=button(target===actions?'ลบรายการนี้':label,()=>{groups.more.open=false;remove();});
      control.className='paper-remove';
      control.disabled=locked||isSaving||hasConflict;
      if(locked)control.title='เอกสารต้องมีอย่างน้อยหนึ่ง Section';
      target.append(control);
    }
  }
finish();
}
const inlineEditor=q<HTMLFormElement>('inline-editor'), inlineInput=q<HTMLInputElement>('inline-value');
let inlineTarget:Outline|undefined;
function closeInlineEditor(){
  inlineTarget=undefined;inlineEditor.hidden=true;q('inline-error').textContent='';
}
function openInlineEditor(item:Outline){
  if(item.inline?.type!=='text'||isSaving||hasConflict||draft.readOnly)return;
  select(item,true);
  const anchor=paperNodes.get(item);
  if(!anchor||!paper.contains(anchor))return;
  inlineTarget=item;
  const at=anchor.getBoundingClientRect();
  const width=Math.min(320,window.innerWidth-24);
  inlineEditor.style.left=Math.max(12,Math.min(at.left,window.innerWidth-width-12))+'px';
  inlineEditor.style.top=Math.max(12,Math.min(at.bottom+6,window.innerHeight-160))+'px';
  inlineEditor.style.width=width+'px';
  inlineInput.value=item.inline.text??'';inlineEditor.hidden=false;
  inlineInput.focus({preventScroll:true});inlineInput.select();
}
inlineEditor.addEventListener('submit',event=>{
  event.preventDefault();
  const item=inlineTarget;
  if(!item)return;
  const text=inlineInput.value;
  if(text===item.inline?.text){closeInlineEditor();return;}
  try{
    stage({kind:'inline-text',at:item.ref,text});closeInlineEditor();
    const current=outlines.get(refKey(item.ref));
    if(current)paperNodes.get(current)?.focus({preventScroll:true});
  }
  catch(e){q('inline-error').textContent=e instanceof Error?e.message:'แก้ข้อความไม่สำเร็จ';}
});
inlineEditor.addEventListener('keydown',event=>{
  if(event.key==='Escape'){event.preventDefault();const target=inlineTarget;closeInlineEditor();if(target)paperNodes.get(target)?.focus();}
});
q('inline-cancel').addEventListener('click',closeInlineEditor);
let paperZoom=75;
let fitMode:'page'|'width'|'manual'='manual';
const paperViewport=paper.parentElement!;
function setPaperZoom(value:number){
  paperZoom=value;
  paper.style.setProperty('--sheet-pt',String(4/3*value/100)+'px');
  q('paper-zoom').textContent=Math.round(value)+'%';
  q('zoom-fit').setAttribute('aria-pressed',String(fitMode==='page'));
  q('zoom-width').setAttribute('aria-pressed',String(fitMode==='width'));
  q<HTMLButtonElement>('zoom-out').disabled=value<=20;
  q<HTMLButtonElement>('zoom-in').disabled=value>=250;
}
function fitPaper(){
  if(fitMode==='manual'||!paperViewport.clientWidth)return;
  const sheet=(selection&&paperNodes.get(selection)?.closest<HTMLElement>('.definition-sheet'))??
    (selection&&sectionSheets.get(roots.find(root=>root.section===selection!.section)!)?.querySelector<HTMLElement>('.definition-sheet'))??
    paper.querySelector<HTMLElement>('.definition-sheet');
  if(!sheet)return;
  const tools=sheet.parentElement?.querySelector<HTMLElement>('.definition-section-tools');
  const width=Number(sheet.dataset.widthPt)*4/3,height=Number(sheet.dataset.heightPt)*4/3;
  const viewportStyle=getComputedStyle(paperViewport);
  const horizontal=parseFloat(viewportStyle.paddingLeft)+parseFloat(viewportStyle.paddingRight);
  const vertical=parseFloat(viewportStyle.paddingTop)+parseFloat(viewportStyle.paddingBottom);
  const toolStyle=tools&&getComputedStyle(tools);
  const toolbar=tools&&toolStyle?tools.offsetHeight+parseFloat(toolStyle.marginTop)+parseFloat(toolStyle.marginBottom):0;
  const byWidth=(paperViewport.clientWidth-horizontal-8)/width*100;
  const byHeight=(paperViewport.clientHeight-vertical-toolbar-6)/height*100;
  setPaperZoom(Math.min(250,fitMode==='width'?byWidth:Math.min(byWidth,byHeight)));
}
setPaperZoom(paperZoom);
function changePaperScale(value:number,clientX?:number,clientY?:number){
  const view=paperViewport.getBoundingClientRect();
  const x=clientX??view.left+paperViewport.clientWidth/2;
  const y=clientY??view.top+paperViewport.clientHeight/2;
  const at=document.elementFromPoint(x,y);
  const anchor=at&&paper.contains(at)?at.closest<HTMLElement>('[data-paper-ref],.definition-sheet')??paper:paper;
  const before=anchor.getBoundingClientRect();
  const rx=(x-before.left)/Math.max(1,before.width);
  const ry=(y-before.top)/Math.max(1,before.height);
  fitMode='manual';
  setPaperZoom(Math.max(20,Math.min(250,value)));
  const after=anchor.getBoundingClientRect();
  paperViewport.scrollBy({left:after.left+rx*after.width-x,top:after.top+ry*after.height-y,behavior:'instant'});
}
function zoomPaper(delta:number){
  const step=delta>0?Math.floor(paperZoom/25):Math.ceil(paperZoom/25);
  changePaperScale(step*25+delta);
}
function isZoomInput(target:EventTarget|null){
  return target instanceof Element&&!!target.closest('input,textarea,select,[contenteditable]:not([contenteditable=false])');
}
paperViewport.addEventListener('wheel',event=>{
  if(!event.ctrlKey||event.altKey||event.metaKey||!event.cancelable||!event.deltaY||isZoomInput(event.target))return;
  event.preventDefault();
  const units=event.deltaMode===WheelEvent.DOM_DELTA_LINE?16:event.deltaMode===WheelEvent.DOM_DELTA_PAGE?paperViewport.clientHeight:1;
  const delta=Math.max(-120,Math.min(120,event.deltaY*units));
  changePaperScale(paperZoom*Math.exp(-delta*.0025),event.clientX,event.clientY);
},{passive:false});
paperViewport.addEventListener('keydown',event=>{
  if(!event.ctrlKey||event.altKey||event.metaKey||event.isComposing||isZoomInput(event.target))return;
  if(!['+','=','-','0'].includes(event.key))return;
  event.preventDefault();
  if(event.key==='0')changePaperScale(100);
  else zoomPaper(event.key==='-'?-25:25);
});
q('zoom-selection').addEventListener('click',()=>{
  const target=selection&&paperNodes.get(selection);
  if(!target)return;
  fitMode='manual';
  setPaperZoom(Math.max(125,paperZoom));
  const box=target.getBoundingClientRect(),view=paperViewport.getBoundingClientRect();
  paperViewport.scrollBy(box.left+box.width/2-view.left-paperViewport.clientWidth/2,
    box.top+box.height/2-view.top-paperViewport.clientHeight/2);
  target.focus({preventScroll:true});
});
function fitView(mode:'width'|'page'){
  fitMode=mode;fitPaper();
  const current=selection&&paperNodes.get(selection);
  if(!current)return;
  const page=current.closest<HTMLElement>('.definition-sheet')??current.closest('.definition-section')?.querySelector<HTMLElement>('.definition-sheet');
  if(mode==='page'&&page)scrollWithin(paperViewport,page);
  else scrollWithin(paperViewport,current);
}
q('zoom-fit').addEventListener('click',()=>fitView('page'));
q('zoom-width').addEventListener('click',()=>fitView('width'));
const workspace=paperViewport.closest<HTMLElement>('.workspace')!;
const layerTools=element('div');
layerTools.className='node-tools';layerTools.hidden=true;
const layerMenu=element('div');layerMenu.className='node-layer-menu';layerMenu.hidden=true;
const grip=button('⠿',()=>{});
grip.setAttribute('aria-label','ย้ายกล่องข้อความ');grip.title='ลากกล่องข้อความ หรือกดเพื่อเลือกเซลล์ปลายทาง';
const layerChoice=button('▱ ชั้น',()=>{
  columnMenu.hidden=true;columnEdit.setAttribute('aria-expanded','false');
  layerMenu.hidden=!layerMenu.hidden;
  layerChoice.setAttribute('aria-expanded',String(!layerMenu.hidden));
  if(!layerMenu.hidden)layerMenu.querySelector('button')?.focus();
});
layerChoice.setAttribute('aria-expanded','false');
const movementRole=element('small');movementRole.className='node-movement-role';
const nodeCaption=element('span');nodeCaption.className='node-caption';
const columnMenu=element('div');columnMenu.className='node-layer-menu column-menu';columnMenu.hidden=true;
const columnEdit=button('แก้คอลัมน์',()=>{
  columnMenu.hidden=!columnMenu.hidden;layerMenu.hidden=true;
  columnEdit.setAttribute('aria-expanded',String(!columnMenu.hidden));
  layerChoice.setAttribute('aria-expanded','false');
});
layerTools.append(grip,nodeCaption,movementRole,columnEdit,layerChoice,layerMenu,columnMenu);workspace.append(layerTools);
let hitStack:Outline[]=[];
let dragBox:Outline|undefined;
let anchor:HTMLElement|undefined;
let pointHits:Outline[]=[];
let pointerStart:{x:number;y:number}|undefined;
let dragged=false;
type PaperDrop={target:Outline;change:Change;label:string;blocked?:string;fields?:MoveBinding[];edge?:'before'|'after'};
const dropCells=new Map<HTMLElement,PaperDrop>();
const dropReason=element('p');dropReason.className='node-drop-reason';dropReason.hidden=true;
dropReason.setAttribute('role','status');workspace.append(dropReason);
function explainDrop(target?:PaperDrop){
  dropReason.textContent=target?.blocked?target.label+' · '+target.target.label+' — '+target.blocked:'';
  dropReason.hidden=!target?.blocked;
}
function paperDrops(item:Outline):PaperDrop[]{
  const drops:PaperDrop[]=[];
  const order=reorderTargets(draft.definition,item.ref);
  for(const peer of item.parent?.children??roots){
    const delta=order.get(peer.id);
    if(delta)drops.push({target:peer,change:{kind:'reorder',at:item.ref,delta,targetId:peer.id},
      edge:delta<0?'before':'after',label:delta<0?'แทรกก่อน':'แทรกหลัง'});
  }
  for(const target of destinations(item)){
    if(item.type==='format'&&(target.ref.formatId||item.parent===target))continue;
    const change:Change={kind:'move',at:item.ref,to:target.ref};
    if(item.type==='area'||item.type==='format'){
      try{applyStructureChange(draft.definition,change);}catch(error){
        const fields=error instanceof FormatBindingRequired?error.fields:undefined;
        const canRebind=fields?.every(({key})=>Object.values(target.section.inputSchema.fields)
          .some(f=>f.type===item.section.inputSchema.fields[key]?.type&&['string','link'].includes(f.type)));
        drops.push({target,change,label:canRebind?'ผูกตัวแปรเพื่อวาง':'วางไม่ได้',fields,
          blocked:error instanceof Error?error.message:'ปลายทางนี้รับรายการไม่ได้'});
        continue;
      }
    }
    drops.push({target,change,label:target.type==='table-cell'?'วางที่นี่':'ย้ายเข้า '+itemType(target)});
  }
  return drops;
}
function dropUnder(el:Element|null){
  for(let e=el;e&&e!==paper;e=e.parentElement)if(e instanceof HTMLElement&&dropCells.has(e))return e;
}

function paperFrame(control:HTMLElement){
  if(control.dataset.kind==='area')return control.closest<HTMLElement>('.definition-area')??control;
  if(control.dataset.kind==='table-cell')return control.closest<HTMLElement>('td')??control;
  if(control.dataset.kind==='table-row')return control.closest<HTMLElement>('tr')??control;
  if(control.matches('.definition-marker,.definition-control'))return control.closest<HTMLElement>('.definition-block')??control;
  return control;
}
function positionNodeTools(){
  if(!anchor?.isConnected||!workspace.offsetWidth){layerTools.hidden=true;return;}
  const r=anchor.getBoundingClientRect(),v=paperViewport.getBoundingClientRect(),w=workspace.getBoundingClientRect();
  layerTools.hidden=r.bottom<=v.top||r.top>=v.bottom||r.right<=v.left||r.left>=v.right;
  if(layerTools.hidden)return;
  const beside=r.top-layerTools.offsetHeight-3<v.top&&r.right+layerTools.offsetWidth+4<v.right;
  const width=layerTools.offsetWidth;
  const clampLeft=(x:number)=>Math.max(v.left,Math.min(x,v.right-width-6));
  let left=clampLeft(beside?r.right+4:r.left);
  const height=layerTools.offsetHeight,above=r.top-height-3;
  const areaTools=anchor.closest('.definition-area')?.querySelector(':scope>.definition-area-tools')?.getBoundingClientRect();
  const below=areaTools&&areaTools.bottom>above&&areaTools.top<r.top&&r.bottom+height+4<=v.bottom;
  let top=Math.max(v.top,Math.min(below?r.bottom+4:above,v.bottom-height));
  const table=anchor.closest('table');
  if(table){
    const sheet=table.closest('.definition-sheet')??table;
    const obstacles=[r,...Array.from(sheet.querySelectorAll('.definition-inline,.definition-area-tools,.definition-image,.definition-rule'),el=>el.getBoundingClientRect())];
    const candidates=[[left,top],[left,r.bottom+4],[clampLeft(r.right+5),r.top],[clampLeft(r.left-width-5),r.top]];
    for(const y of [above,r.bottom+4])for(const x of [r.right-width,table.getBoundingClientRect().left,v.left+3,v.right-width-6])
      candidates.push([clampLeft(x),y]);
    const clear=candidates.find(([x,y])=>y>=v.top&&y+height<=v.bottom&&
      !obstacles.some(o=>o.width&&o.height&&o.left<x+width+1&&o.right>x-1&&o.top<y+height+1&&o.bottom>y-1));
    if(clear)[left,top]=clear;
  }
  layerTools.style.left=(left-w.left)+'px';
  layerTools.style.top=(top-w.top)+'px';
  layerMenu.style.maxHeight=Math.max(70,v.bottom-w.top-parseFloat(layerTools.style.top)-layerTools.offsetHeight-4)+'px';
}
paper.addEventListener('click',event=>{
  pointHits=[];
  for(const hit of document.elementsFromPoint(event.clientX,event.clientY)){
    if(!paper.contains(hit))continue;
    const control=hit.closest<HTMLElement>('[data-paper-ref]');
    if(!control||getComputedStyle(control).opacity==='0')continue;
    const item=outlines.get(control.dataset.paperRef??'');
    if(item&&!pointHits.includes(item))pointHits.push(item);
  }
  queueMicrotask(()=>{pointHits=[];});
},true);
function stopPaperMove(){
  explainDrop();
  for(const el of dropCells.keys()){el.classList.remove('node-drop','node-drop-over');el.removeAttribute('data-drop-label');el.removeAttribute('data-drop-edge');el.removeAttribute('data-drop-blocked');if(!(el instanceof HTMLButtonElement))el.removeAttribute('tabindex');}
  dropCells.clear();workspace.querySelector('.node-drag-source')?.classList.remove('node-drag-source');
  layerTools.classList.remove('moving');grip.textContent='⠿ '+nodeCaption.textContent;layerChoice.disabled=false;
}
function editColumn(item:Outline){
  columnMenu.hidden=true;columnMenu.replaceChildren();columnEdit.setAttribute('aria-expanded','false');
  columnEdit.hidden=item.type!=='column'||!item.ref.band||!!draft.readOnly||hasConflict||isSaving;
  if(columnEdit.hidden)return;
  const at=item.ref,columns=item.parent!.node!.columns!,index=Number(at.part!.slice(7));
  const weight=columns[index].weight??1;
  const addContent=(target:Ref,type:'text-block'|'line')=>{
    columnMenu.hidden=true;columnEdit.setAttribute('aria-expanded','false');
    if(type==='line')tryStage({kind:'column-content',at:target,type});
    else ask('ใส่ข้อความในคอลัมน์ '+(Number(target.part!.slice(7))+1),[{key:'text',label:'ข้อความ'}],
      values=>stage({kind:'column-content',at:target,type,text:values.text}));
  };
  const resize=button('ปรับสัดส่วน · '+weight,()=>ask('ปรับสัดส่วน '+item.label,[{key:'weight',label:'สัดส่วนความกว้าง',numeric:true,value:String(weight)}],
    values=>stage({kind:'layout-column',at,action:'weight',weight:Number(values.weight)}),'สัดส่วนของชุดนี้ '+columns.map(c=>c.weight??1).join(' : ')));
  columnMenu.append(resize,button('+ คอลัมน์ซ้าย',()=>tryStage({kind:'layout-column',at,action:'add-before'})),
    button('+ คอลัมน์ขวา',()=>tryStage({kind:'layout-column',at,action:'add-after'})));
  for(const [type,name] of [['text-block','ข้อความ'],['line','เส้น']] as const){
    let origin:{x:number;y:number}|undefined,dragging=false,suppressClick=false;
    const targets=new Map<HTMLElement,Outline>();
    const tool=button('⠿ '+name,()=>{if(!suppressClick)addContent(at,type);suppressClick=false;});
    tool.className='column-insert';tool.title='ลากไปวาง หรือกดเพื่อใส่ใน '+item.label;
    function clear(){
      for(const frame of targets.keys()){
        frame.classList.remove('node-drop','node-drop-over');delete frame.dataset.dropLabel;
      }
      origin=undefined;dragging=false;targets.clear();layerTools.classList.remove('column-placing');
      document.removeEventListener('keydown',cancel);
    }
    function cancel(event:KeyboardEvent){if(event.key==='Escape'){suppressClick=true;clear();}}
    tool.onpointerdown=e=>{
      if(e.button!==0)return;
      origin={x:e.clientX,y:e.clientY};suppressClick=false;tool.setPointerCapture(e.pointerId);
      document.addEventListener('keydown',cancel);
    };
    const hit=(x:number,y:number)=>document.elementFromPoint(x,y)?.closest<HTMLElement>('.definition-columns>[data-kind=column]');
    tool.onpointermove=e=>{
      if(!origin)return;
      if(!dragging&&Math.hypot(e.clientX-origin.x,e.clientY-origin.y)>5){
        dragging=true;suppressClick=true;layerTools.classList.add('column-placing');
        for(const column of item.parent!.children){
          const control=paperNodes.get(column);if(!control)continue;
          const frame=paperFrame(control);targets.set(frame,column);
          frame.classList.add('node-drop');frame.dataset.dropLabel='วาง'+name;
        }
      }
      if(dragging){const over=hit(e.clientX,e.clientY);for(const frame of targets.keys())frame.classList.toggle('node-drop-over',over===frame);}
    };
    tool.onpointerup=e=>{
      const frame=dragging&&hit(e.clientX,e.clientY),target=frame&&targets.get(frame);
      clear();if(target)addContent(target.ref,type);
    };
    tool.onpointercancel=()=>{suppressClick=true;clear();};
    columnMenu.append(tool);
  }
  const del=button('ลบ '+item.label,()=>ask('ลบ '+item.label,[],()=>stage({kind:'layout-column',at,action:'remove'}),
    item.children.length?'ลบเนื้อหาภายใน '+item.children.length+' รายการด้วย':'คอลัมน์นี้ว่าง'));
  del.disabled=columns.length<=1;columnMenu.append(del);
}
function mountTableDivider(selected:Outline){
  let cell:Outline|undefined=selected;
  while(cell&&cell.type!=='table-cell')cell=cell.parent;
  const table=cell?.parent?.parent;
  if(!cell||table?.type!=='table')return;
  const control=paperNodes.get(cell),td=control?.closest('td');
  if(!td||td.colSpan!==1)return;
  const widths=(table.node?.columns??[]).map(c=>c.width?lengthInPoints(c.width):0);
  if(widths.length<2||widths.some(w=>w<=0))return;
  const cols=(el:Element)=>Array.from(el.querySelectorAll<HTMLTableColElement>(':scope > colgroup > col'));
  const groups=[cols(td.closest('table')!)];
  // Delivery Order headings live in the page header, separately from each cargo line.
  // Verify the labels, bindings and geometry before treating two tables as a pair.
  if(table.format?.key!=='cargo'&&table.ref.band!=='header')return;
  const tables=[...outlines.values()].filter(h=>h.type==='table'&&h.section===table.section&&
    h.node?.columns?.length===widths.length&&h.node.columns.every((c,i)=>c.width&&Math.abs(lengthInPoints(c.width)-widths[i])<0.001));
  const visible=tables.flatMap(h=>{
    const el=paperNodes.get(h)?.closest('.definition-table')?.querySelector('table');
    return el?[{h,el,cells:el.rows[0]?.cells}]:[];
  });
  const headers=visible.filter(({h,cells})=>h.ref.band==='header'&&cells?.[0]?.textContent?.includes('MARK AND NUMBERS')&&
    cells[1]?.textContent?.includes('DESCRIPTION OF GOODS'));
  const cargo=visible.filter(({h,cells})=>h.format?.key==='cargo'&&cells?.[0]?.querySelector('.definition-token')?.textContent?.trim()==='{{marks}}'&&
    cells[1]?.querySelector('.definition-token')?.textContent?.trim()==='{{description}}');
  if(headers.length!==1||cargo.length!==1)return;
  const header=headers[0],body=cargo[0];
  if(table!==header.h&&table!==body.h)return;
  groups.push(cols(table===body.h?header.el:body.el));
  const column=Number(td.dataset.authoredColumn)-1,cellRef=cell.ref;
  return mountColumnEdges(td,widths,column,(left,fraction)=>tryStage({
    kind:'table-divider',at:body.h.ref,header:header.h.ref,cell:cellRef,left,fraction
  }),{columns:groups,linked:true});
}
let clearColumnEdges:(()=>void)|undefined;
function updatePaperTools(item:Outline){
  clearColumnEdges?.();clearColumnEdges=undefined;
  stopPaperMove();layerMenu.hidden=true;layerChoice.setAttribute('aria-expanded','false');
  editColumn(item);
  const control=paperNodes.get(item);
  anchor?.classList.remove('node-selected-frame');
  anchor=control?paperFrame(control):undefined;
  anchor?.classList.add('node-selected-frame');
  if(anchor&&item.type==='column'&&item.ref.band&&!draft.readOnly&&!isSaving&&!hasConflict){
    const weights=item.parent!.node!.columns!.map(c=>c.weight??1);
    clearColumnEdges=mountColumnEdges(anchor,weights,Number(item.ref.part!.slice(7)),(left,fraction)=>
      tryStage({kind:'column-boundary',at:item.ref,left,fraction}));
  }
  if(!clearColumnEdges&&!draft.readOnly&&!isSaving&&!hasConflict)clearColumnEdges=mountTableDivider(item);
  dragBox=item.inline?item.parent:item;
  const options=dragBox&&!draft.readOnly&&!isSaving&&!hasConflict?paperDrops(dragBox):[];
  if(!options.length)dragBox=undefined;
  const canOrder=options.some(drop=>drop.edge),canPlace=options.some(drop=>!drop.edge&&!drop.blocked);
  movementRole.textContent=draft.readOnly?'อ่านอย่างเดียว':dragBox
    ?(item.inline?'ย้ายทั้งกล่อง':canOrder&&canPlace?'สลับ / ย้ายเข้า':canOrder?'สลับลำดับ':canPlace?'ย้ายเข้า':'ดูข้อจำกัด')
    :item.ref.part||['header','footer','table-cell'].includes(item.type)?'อยู่กับ'+(item.parent?itemType(item.parent):'โครง'):'คงตำแหน่ง';

  const kind=itemType(item),label=item.label.replace(/^\{\{(.+)\}\}$/,'$1');
  const caption=label===kind||label.startsWith(kind+' ')?label:kind+' · '+label;
  nodeCaption.hidden=!!dragBox;nodeCaption.textContent=caption;nodeCaption.title=caption;
  grip.hidden=!dragBox;
  if(dragBox){
    const name='ย้าย'+itemType(dragBox);
    grip.textContent='⠿ '+caption;grip.setAttribute('aria-label',name);grip.title=name+' · '+dragBox.label;
  }
  hitStack=[...new Set([item,...pointHits])];
  for(let parent=item.parent;parent;parent=parent.parent)if(!hitStack.includes(parent))hitStack.push(parent);
  layerMenu.replaceChildren(...hitStack.map(candidate=>button(itemType(candidate)+(candidate.label===itemType(candidate)?'':' · '+candidate.label),()=>{
    select(candidate,false);layerChoice.focus({preventScroll:true});
  })));
  positionNodeTools();
}
function startPaperMove(){
  const box=dragBox;
  if(!box||draft.readOnly||hasConflict||isSaving)return;
  select(box,false);
  const source=paperNodes.get(box);if(!source)return;
  for(const drop of paperDrops(box)){
    const control=paperNodes.get(drop.target);
    if(!control||!control.isConnected)continue;
    const el=paperFrame(control);
    if(!el.getClientRects().length)continue;
    dropCells.set(el,drop);el.tabIndex=0;el.classList.add('node-drop');el.dataset.dropLabel=drop.label;
    if(drop.edge)el.dataset.dropEdge=drop.edge;
    if(drop.blocked)el.dataset.dropBlocked=drop.blocked;
  }
  if(!dropCells.size)return;
  paperFrame(source).classList.add('node-drag-source');layerTools.classList.add('moving');
  const row=box.parent?.parent;
  const host=box.format??box.band??box.section.source;
  const repeat=row&&host.repeats?.some(rule=>rule.rowTemplateId===row.id);
  grip.textContent='⠿ '+box.label+(repeat?' · ทุกแถวที่วนซ้ำ':'');layerChoice.disabled=true;positionNodeTools();
}
function placePaperBox(cell?:HTMLElement){
  const target=cell&&dropCells.get(cell),source=dragBox;
  stopPaperMove();
  if(target?.blocked){
    explainDrop(target);
    if(source&&target.fields&&target.change.kind==='move'){
      const change=target.change,fields=target.fields,section=target.target.section;
      const inputs=fields.map((field,index)=>{
        const type=source.section.inputSchema.fields[field.key]?.type;
        const options:[string,string][]=Object.entries(section.inputSchema.fields)
          .filter(([,f])=>f.type===type&&['string','link'].includes(type)).map(([key])=>[key,key]);
        return {key:String(index),label:(source.type==='area'?field.format+' · ':'')+field.key+' → '+section.label,options};
      });
      if(inputs.some(input=>!input.options.length)){
        dropReason.append(' · ประกาศตัวแปรชนิดเดียวกันใน Section ปลายทางก่อน');return;
      }
      const rebind=button('เลือกตัวแปรปลายทาง',()=>{
        ask('ย้าย '+source.label+' ไป '+target.target.label,inputs.map(i=>({...i,options:[['','เลือกตัวแปร'],...i.options]})),values=>{
          const bindings=Object.fromEntries(fields.map((field,index)=>[field.id,values[String(index)]]));
          stage({...change,bindings});
        },'เปลี่ยนทุกจุดใน Format ที่ใช้ตัวแปรเดิม · ย้อนทั้งการย้ายและการผูกได้ในครั้งเดียว');
      });
      dropReason.append(' ',rebind);rebind.focus({preventScroll:true});
    }
    return;
  }
  if(source&&target)tryStage(target.change);
}
function cellAt(x:number,y:number){return dropUnder(document.elementFromPoint(x,y));}
grip.addEventListener('pointerdown',e=>{
  if(e.button!==0)return;
  pointerStart={x:e.clientX,y:e.clientY};dragged=false;grip.setPointerCapture(e.pointerId);
});
grip.addEventListener('pointermove',e=>{
  if(!pointerStart)return;
  if(!dragged&&Math.hypot(e.clientX-pointerStart.x,e.clientY-pointerStart.y)>5){dragged=true;startPaperMove();}
  if(dragged){
    const view=paperViewport.getBoundingClientRect();
    if(!cellAt(e.clientX,e.clientY)&&e.clientY>=view.top&&e.clientY<=view.bottom){
      if(e.clientY<view.top+36)paperViewport.scrollTop-=28;
      else if(e.clientY>view.bottom-36)paperViewport.scrollTop+=28;
    }
    const over=cellAt(e.clientX,e.clientY);explainDrop(over&&dropCells.get(over));for(const el of dropCells.keys())el.classList.toggle('node-drop-over',el===over);}
});
grip.addEventListener('pointerup',e=>{
  pointerStart=undefined;if(dragged)placePaperBox(cellAt(e.clientX,e.clientY));
});
grip.addEventListener('pointercancel',()=>{pointerStart=undefined;dragged=false;stopPaperMove();});
grip.addEventListener('click',()=>{
  if(!dragged){
    if(dropCells.size)stopPaperMove();
    else{startPaperMove();dropCells.keys().next().value?.focus({preventScroll:true});}
  }
  dragged=false;
});
paper.addEventListener('focusin',e=>{
  if(dropCells.size)explainDrop(dropCells.get(e.target as HTMLElement));
});
paper.addEventListener('pointerover',e=>{
  if(dropCells.size){const el=dropUnder(e.target as Element);explainDrop(el&&dropCells.get(el));}
});
paper.addEventListener('click',e=>{
  if(!dropCells.size)return;
  e.preventDefault();e.stopImmediatePropagation();placePaperBox(dropUnder(e.target as Element));
},true);
document.addEventListener('keydown',e=>{
  if((e.key==='Enter'||e.key===' ')&&e.target instanceof HTMLElement&&dropCells.has(e.target)){
    const blocked=dropCells.get(e.target)?.blocked;
    e.preventDefault();placePaperBox(e.target);if(!blocked)grip.focus({preventScroll:true});return;
  }
  if(e.key==='Escape'&&!columnMenu.hidden&&!document.querySelector('dialog[open]')){
    columnMenu.hidden=true;columnEdit.setAttribute('aria-expanded','false');columnEdit.focus();
  }
  if(e.key==='Escape'&&(dropCells.size||!layerMenu.hidden)){
    pointerStart=undefined;stopPaperMove();layerMenu.hidden=true;layerChoice.setAttribute('aria-expanded','false');layerChoice.focus();e.preventDefault();
  }
});
paperViewport.addEventListener('scroll',positionNodeTools,{passive:true});
new ResizeObserver(positionNodeTools).observe(paperViewport);
function sizeWorkspace(){
  if(!workspace.offsetWidth)return;
  const top=Math.round(editor.getBoundingClientRect().top+window.scrollY);
  editor.style.setProperty('--workbench-top',top+'px');
}
const chromeSize=new ResizeObserver(sizeWorkspace);
for(const part of [editorTitle,status,q('structure-pending'),workspace.querySelector('.paper-toolbar')!])chromeSize.observe(part);
window.addEventListener('resize',sizeWorkspace);
new ResizeObserver(()=>fitPaper()).observe(paperViewport);
q('zoom-in').addEventListener('click',()=>zoomPaper(25));
q('zoom-out').addEventListener('click',()=>zoomPaper(-25));
q('show-guides').addEventListener('click',()=>{
  const control=q('show-guides'),show=control.getAttribute('aria-pressed')!=='true';
  control.setAttribute('aria-pressed',String(show));
  paper.classList.toggle('show-guides',show);
  q('guide-legend').hidden=!show;
});
q('show-handles').addEventListener('click',()=>{
  const control=q('show-handles'),show=control.getAttribute('aria-pressed')!=='true';
  control.setAttribute('aria-pressed',String(show));control.textContent=show?'ซ่อนจุดเลือก':'แสดงจุดเลือก';paper.classList.toggle('show-handles',show);
  control.closest('details')!.open=false;
});
function tryStage(change:Change){
  try{stage(change);}catch(e){status.textContent=e instanceof Error?e.message:'แก้โครงไม่สำเร็จ';}
}
function addSection(){ask('เพิ่ม Section',[{key:'label',label:'ชื่อส่วนเอกสาร'}],v=>stage({kind:'section',label:v.label}));}
q('add-section').addEventListener('click',addSection);
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
  if(!isDirty()||isSaving||hasConflict||draft.readOnly)return;
  const started=performance.now(), keep=selection?.ref;
  isSaving=true;refreshButtons();
  status.textContent='กำลังตรวจโครงกับ Core และบันทึก…';
  try{
    const creating=!templateId;
    const response=await fetch(creating?editorApi:endpoint+'/structure',{method:creating?'POST':'PUT',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({definition:draft.definition,expectedRevision:draft.revision,idempotencyKey:creating?(createKey??=crypto.randomUUID()):crypto.randomUUID()}),
      signal:AbortSignal.timeout(20000)});
    const result=await response.json() as ServiceReply;
    if(response.status===409&&result.issues?.[0]?.code==='STALE_CURRENT'){
      hasConflict=true;conflict.hidden=false;q<HTMLDetailsElement>('advanced-details').open=true;status.textContent='มีฉบับใหม่กว่า · การแก้โครงในหน้านี้ยังอยู่';return;
    }
    if(!response.ok||!result.ok||!result.value){
      const issue=result.issues?.[0];
      status.textContent=issue?'Core ไม่รับโครงนี้ · '+issue.code+' · '+(issue.path??''):'ยังยืนยันผลบันทึกไม่ได้ · การแก้ยังอยู่';
      return;
    }
    if(creating){
      templateId=result.value.templateId;endpoint=editorApi+'/'+encodeURIComponent(templateId);
      historyReplaceDraft(templateId);
    }
    history.length=0;savedDefinition=result.value.definition;cancelPreview();
    await readSectionBackgrounds().catch(()=>{sectionBackgroundEnabled=false;sectionBackgrounds={};});
    showDraft(result.value,keep);
    status.textContent='บันทึกร่างแล้ว · ครั้งที่ '+draft.revision;
    afterPaint('flowdoc:structure-save',started,{revision:draft.revision});
  }catch{status.textContent='ยังยืนยันผลบันทึกไม่ได้ · การแก้ยังอยู่';}
  finally{isSaving=false;refreshButtons();}
});
async function readDraft() {
  const response=await fetch(paperVersion?endpoint+'/versions/'+encodeURIComponent(paperVersion):endpoint,{headers:sharedPreviewHeaders,signal:AbortSignal.timeout(15000)});
  if(sharedPreview&&response.status===410)throw Error(shareUnavailable);
  const reply=await response.json() as ServiceReply;
  if(!response.ok||!reply.ok||!reply.value||(!sharedPreview&&reply.value.templateId!==templateId)||
    reply.value.definition.nodeModelVersion!==20||!reply.value.definition.sections.length)throw Error('Draft unavailable');
  if(sharedPreview&&reply.expiresAt){
    const time=new Intl.DateTimeFormat('th-TH',{dateStyle:'medium',timeStyle:'short'}).format(new Date(reply.expiresAt));
    q('revision').textContent='Revision '+reply.value.revision+' · ลิงก์ใช้ได้ถึง '+time;
  }
  return reply.value;
}
function cancelPreview() {
  issuePreviewId=undefined;
  pendingPreview?.abort();pendingPreview=undefined;
  paperDraft=undefined;closePaperEdit();
  resetPreviewPages();paperInteractionBlocked=false;jump.disabled=true;
  preview=undefined;trialBase=undefined;previewPaper.replaceChildren();
  delete previewPaper.dataset.revision;
  delete previewPaper.dataset.run;
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
    if(sharedPreview){
      templateId=data.templateId;draft=data;title.textContent=data.name;
      changeMode('preview');return;
    }
    if(paperOnly){
      if(!paperVersion)await readSectionBackgrounds().catch(()=>{sectionBackgrounds={};});
      showDraft({...data,readOnly:true});
      paper.inert=true;paper.classList.remove('show-guides');
      fitMode=new URLSearchParams(location.search).get('fit')==='page'?'page':'width';fitPaper();
      window.parent.postMessage({type:'flowdoc-paper-ready',revision:data.revision,fingerprint:data.fingerprint},location.origin);return;
    }
    await readSectionBackgrounds().catch(()=>{sectionBackgroundEnabled=false;sectionBackgrounds={};});
    showDraft(data);void readDraftContext();
    const fromCard=Number(sessionStorage.getItem('flowdoc:open:'+templateId));
    sessionStorage.removeItem('flowdoc:open:'+templateId);
    afterPaint('flowdoc:open-definition',started,{revision:data.revision});
    const offset=fromCard-performance.timeOrigin;
    if(fromCard&&offset<=started&&started-offset<20000)afterPaint('flowdoc:open-from-library',offset<0?0:offset,{revision:data.revision,navigationMs:offset<0?-offset:0});
    if(showingPreview)openPreview();
  }catch(error){
    if(sharedPreview){
      title.textContent='เปิด Preview ไม่ได้';
      status.textContent=error instanceof Error&&error.message===shareUnavailable?shareUnavailable:'โหลด Preview ไม่สำเร็จ กรุณาลองใหม่';
    }else status.textContent='เปิดโครงทดสอบไม่ได้ กรุณาโหลดหน้าใหม่';
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
const assetUrl=(id:string,run?:string)=>endpoint+(run?'/preview-runs/'+encodeURIComponent(run)+'/assets/':'/preview-assets/')+encodeURIComponent(id);
const guestImages=new Map<string,string>();
async function readyImages(page:DrawPage,run?:string){
  if(sharedPreview){
    const ids=[...new Set((page.sampleImages??[]).flatMap(image=>image.resourceId?[image.resourceId]:[]))];
    for(const id of ids){
      if(guestImages.has(id))continue;
      const response=await fetch(assetUrl(id,run),{headers:sharedPreviewHeaders,signal:AbortSignal.timeout(15000)});
      if(!response.ok)throw Error('Preview asset unavailable');
      const url=URL.createObjectURL(await response.blob());
      const asset=new Image();asset.src=url;
      try{await asset.decode();}catch(error){URL.revokeObjectURL(url);throw error;}
      if(guestImages.has(id))URL.revokeObjectURL(url);
      else guestImages.set(id,url);
      if(guestImages.size>64){
        const first=guestImages.keys().next().value!;
        URL.revokeObjectURL(guestImages.get(first)!);guestImages.delete(first);
      }
    }
    return;
  }
  const urls=[...new Set((page.sampleImages??[]).flatMap(image=>image.resourceId?[assetUrl(image.resourceId,run)]:[]))];
  for(let i=0;i<urls.length;i+=4)await Promise.all(urls.slice(i,i+4).map(url=>{
    const asset=new Image();asset.src=url;return asset.decode();
  }));
}
function visitBorderStrokes(page:DrawPage,stroke:(x1:number,y1:number,x2:number,y2:number,width:number,color:string,dash:number[],cap:CanvasLineCap)=>void){
  for(const b of page.borders??[]){
    const w=b.widthPt,style=b.style??'single';
    const dx=b.x2Pt-b.x1Pt,dy=b.y2Pt-b.y1Pt,length=Math.hypot(dx,dy);
    if(!length)continue;
    const paint=(weight:number,offset=0,dash:number[]=[],cap:CanvasLineCap='butt')=>{
      const x=-dy/length*offset,y=dx/length*offset;
      stroke(b.x1Pt+x,b.y1Pt+y,b.x2Pt+x,b.y2Pt+y,weight,color(b.color),dash,cap);
    };
    const dash=(a:number,b:number)=>[a*w,b*w];
    if(style==='double'){paint(w,-w);paint(w,w);}
    else if(style==='thickThinWideGap'){paint(.6*w,-.2*w,dash(4,12));paint(.2*w,.4*w,dash(4,12));}
    else if(style==='dashed')paint(w,0,dash(3,2));
    else if(style==='dotted')paint(w,0,dash(0,2),'round');
    else if(style==='dashSmallGap')paint(.96*w,0,dash(3.2,1.6));
    else paint(w);
  }
}
function paintBorders(sheet:SVGElement,page:DrawPage){
  visitBorderStrokes(page,(x1,y1,x2,y2,width,ink,dash,cap)=>{
    sheet.append(svg('line',{x1,y1,x2,y2,stroke:ink,'stroke-width':width,
      ...(dash.length?{'stroke-dasharray':dash.join(' ')}:{}),...(cap==='round'?{'stroke-linecap':cap}:{})}));
  });
}
const canvasInk=new WeakMap<Element,(occurrence?:string)=>void>();
function canvasSurface(page:DrawPage,cssWidth:number,sheet:SVGElement){
  // Keep the experiment on pages whose paint is entirely described by Engine geometry.
  if(!page.glyphs||page.lines.some(line=>!line.glyphUses)||(page.sampleImages??[]).some(image=>image.resourceId))return;
  const canvas=element('canvas'),context=canvas.getContext('2d');
  if(!context)return;
  const ctx=context;
  const ratio=Math.min(cssWidth*devicePixelRatio/page.widthPt,Math.sqrt(1_400_000/(page.widthPt*page.heightPt)));
  canvas.width=Math.max(1,Math.floor(page.widthPt*ratio));canvas.height=Math.max(1,Math.floor(page.heightPt*ratio));
  const scaleX=canvas.width/page.widthPt,scaleY=canvas.height/page.heightPt;
  canvas.setAttribute('aria-hidden','true');
  const surface=element('div');surface.className='preview-canvas-surface';surface.append(canvas,sheet);
  const glyphs=new Map(Object.entries(page.glyphs).map(([id,path])=>[id,new Path2D(path)]));
  const editable=new Set(page.lines.flatMap(line=>line.edit?[line.edit.occurrence]:[]));
  let hidden:string|undefined,painted=false;
  function paint(occurrence?:string){
    const active=occurrence&&editable.has(occurrence)?occurrence:undefined;
    if(painted&&active===hidden)return;
    hidden=active;painted=true;
    ctx.setTransform(scaleX,0,0,scaleY,0,0);
    ctx.fillStyle=color(page.backgroundColor);ctx.fillRect(0,0,page.widthPt,page.heightPt);
    for(const f of page.fills??[]){
      ctx.fillStyle=color(f.color);ctx.fillRect(f.xPt,f.yPt,f.widthPt,f.heightPt);
    }
    visitBorderStrokes(page,(x1,y1,x2,y2,width,ink,dash,cap)=>{
      ctx.strokeStyle=ink;ctx.lineWidth=width;ctx.lineCap=cap;ctx.setLineDash(dash);
      ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.stroke();
    });
    for(const line of page.lines){
      if(active&&line.edit?.occurrence===active)continue;
      ctx.fillStyle=color(line.color);
      const scale=line.scale??1;
      for(const [glyph,x,y] of line.glyphUses!){
        const path=glyphs.get(glyph);
        if(!path)continue;
        ctx.setTransform(scale*scaleX,0,0,-scale*scaleY,x*scaleX,y*scaleY);ctx.fill(path);
      }
    }
    ctx.setTransform(scaleX,0,0,scaleY,0,0);
    for(const image of page.sampleImages??[])if(image.color){
      ctx.fillStyle=color(image.color);ctx.fillRect(image.xPt,image.yPt,image.widthPt,image.heightPt);
    }
  }
  canvasInk.set(surface,paint);
  return surface;
}
const trialPaperValue=q<HTMLTextAreaElement>('trial-paper-value');
const trialPaperDraft=q('trial-paper-draft');
let trialForm:ReturnType<typeof mountTrial>|undefined;
let paperInteractionBlocked=false;
let paperEdit:{key:string;occurrence:string;pageIndex:number;composing:boolean;previous?:TrialTab;next?:TrialTab}|undefined;
let paperDraft:{key:string;occurrence?:string}|undefined;
let draftStart=0;
const trialHits=new WeakMap<SVGElement,PreviewEdit>();
let coveredInk:{surface:Element;occurrence:string}|undefined;
function updatePaperInk(surface?:Element|null,occurrence?:string){
  if(coveredInk&&coveredInk.surface===surface&&coveredInk.occurrence===occurrence)return;
  if(coveredInk){
    const previous=coveredInk.surface;
    for(const ink of previous.querySelectorAll('.trial-ink-active'))ink.classList.remove('trial-ink-active');
    if(previous!==surface||!occurrence)canvasInk.get(previous)?.();
  }
  coveredInk=surface&&occurrence?{surface,occurrence}:undefined;
  if(coveredInk){
    for(const ink of coveredInk.surface.querySelectorAll<SVGElement>('[data-trial-ink]'))
      if(ink.dataset.trialInk===occurrence)ink.classList.add('trial-ink-active');
    canvasInk.get(coveredInk.surface)?.(occurrence);
  }
}
function fitPaperInput(input:HTMLElement,first:SVGRectElement,last:SVGRectElement){
  const bounds=first.getBoundingClientRect();
  const bottom=Math.min(last.getBoundingClientRect().bottom,first.closest('.preview-page-sheet')!.getBoundingClientRect().bottom);
  const scale=bounds.height/Number(first.getAttribute('height'));
  Object.assign(input.style,{
    left:bounds.left+'px',top:bounds.top+'px',width:bounds.width+'px',height:Math.max(0,bottom-bounds.top)+'px',
    fontSize:Number(first.dataset.fontSize)*scale+'px',lineHeight:bounds.height+'px',
    fontWeight:first.dataset.weight??'400',textAlign:first.dataset.align??'left',color:first.dataset.inkColor??'#172b21',
  });
}
function showDraftText(){
  trialPaperDraft.textContent=(paperDraft&&trialForm?.read(paperDraft.key) || '').slice(draftStart);
}
function positionPaperEditor(){
  trialPaperDraft.hidden=true;
  if(!showingPreview){updatePaperInk();return;}
  if(paperEdit){
    const slot=pageSlots[paperEdit.pageIndex];
    const hits=[...slot?.querySelectorAll<SVGRectElement>('[data-trial-key]')??[]]
      .filter(hit=>hit.dataset.trialOccurrence===paperEdit?.occurrence);
    trialPaperValue.style.opacity=hits.length?'':'0';
    if(!hits.length){updatePaperInk();return;}
    const owner=trialHits.get(hits[0])!;
    paperEdit.previous=owner.previous;paperEdit.next=owner.next;
    fitPaperInput(trialPaperValue,hits[0],hits.at(-1)!);
    updatePaperInk(slot.firstElementChild,paperEdit.occurrence);
    return;
  }
  if(paperDraft){
    const {key,occurrence:preferred}=paperDraft;
    for(const index of [...mountedPages].sort((a,b)=>Math.abs(a-pageIndex)-Math.abs(b-pageIndex))){
      const slot=pageSlots[index];
      const hits=[...slot.querySelectorAll<SVGRectElement>('[data-trial-key]')].filter(hit=>
        hit.dataset.trialKey===key&&(!preferred||hit.dataset.trialOccurrence===preferred));
      const visible=hits.find(hit=>{
        const bounds=hit.getBoundingClientRect();
        return bounds.bottom>0&&bounds.top<innerHeight;
      });
      if(!visible)continue;
      const occurrence=visible.dataset.trialOccurrence;
      const fragment=hits.filter(hit=>hit.dataset.trialOccurrence===occurrence);
      draftStart=trialHits.get(fragment[0])!.start;
      showDraftText();
      fitPaperInput(trialPaperDraft,fragment[0],fragment.at(-1)!);
      trialPaperDraft.hidden=false;
      updatePaperInk(slot.firstElementChild,occurrence);
      return;
    }
  }
  updatePaperInk();
}
function beginPaperEdit(edit:PreviewEdit,offset:number,index:number){
  if(paperInteractionBlocked)return;
  const value=trialForm?.read(edit.key);
  if(value===undefined)return;
  paperEdit={key:edit.key,occurrence:edit.occurrence,pageIndex:index,composing:false,previous:edit.previous,next:edit.next};
  trialPaperValue.value=value;
  trialPaperValue.scrollTop=0;
  const label=trialForm?.reveal(edit.key);
  if(label)void locateFormField(edit.key,label,false,index);
  trialPaperValue.hidden=false;
  positionPaperEditor();
  trialPaperValue.focus({preventScroll:true});
  trialPaperValue.setSelectionRange(offset,offset);
}
function closePaperEdit(){
  paperEdit=undefined;trialPaperValue.hidden=true;positionPaperEditor();
}
function syncPaperEdit(composing:boolean){
  if(!paperEdit)return;
  const active=paperEdit,{key,occurrence}=active,value=trialPaperValue.value;
  const fallback={key,occurrence,pageIndex:active.pageIndex,offset:trialPaperValue.selectionStart};
  const readFocus=()=>paperEdit===active?{...fallback,pageIndex:active.pageIndex,offset:trialPaperValue.selectionStart}:fallback;
  trialForm?.write(key,value,readFocus,composing);
  paperDraft={key,occurrence};
}
trialPaperValue.addEventListener('compositionstart',()=>{if(paperEdit)paperEdit.composing=true;});
trialPaperValue.addEventListener('input',event=>syncPaperEdit(Boolean(paperEdit?.composing||(event as InputEvent).isComposing)));
trialPaperValue.addEventListener('compositionend',()=>{
  if(!paperEdit)return;
  paperEdit.composing=false;syncPaperEdit(false);
});
async function tabOnPaper(stop:TrialTab){
  const active=paperEdit;
  if(!await ensurePage(stop.pageIndex))return;
  if(paperEdit!==active)return;
  const hit=[...pageSlots[stop.pageIndex]?.querySelectorAll<SVGRectElement>('[data-trial-occurrence]')??[]]
    .find(element=>element.dataset.trialOccurrence===stop.occurrence);
  const edit=hit&&trialHits.get(hit);
  if(edit){
    hit.scrollIntoView({block:'nearest',inline:'nearest'});
    beginPaperEdit(edit,edit.start,stop.pageIndex);
    reportPage(stop.pageIndex);
  }
}
trialPaperValue.addEventListener('keydown',event=>{
  if(!paperEdit||paperEdit.composing||event.isComposing)return;
  if(event.key==='Escape'){event.preventDefault();closePaperEdit();return;}
  if(event.key==='Tab'){
    const stop=event.shiftKey?paperEdit.previous:paperEdit.next;
    if(stop){event.preventDefault();void tabOnPaper(stop);}
  }
});
trialPaperValue.addEventListener('blur',closePaperEdit);
window.addEventListener('resize',positionPaperEditor);
window.addEventListener('scroll',positionPaperEditor,true);
const markSources=new WeakMap<SVGElement,FieldMark[]>();
let formSelection:{key:string;label:string}|undefined;
function drawFormSelection(sheet:SVGElement){
  sheet.querySelectorAll('.form-field-mark').forEach(mark=>mark.remove());
  if(!formSelection)return;
  const {key}=formSelection;
  // Empty text fields have a real editable box wider than their blank glyph.
  const hits=sheet.querySelectorAll<SVGRectElement>('[data-trial-key="'+CSS.escape(key)+'"]');
  const marks=hits.length?[...hits].map(hit=>({xPt:hit.x.baseVal.value,yPt:hit.y.baseVal.value,
    widthPt:hit.width.baseVal.value,heightPt:hit.height.baseVal.value})):
    (markSources.get(sheet)??[]).filter(mark=>mark.keys.includes(key));
  for(const mark of marks){
    const box=svg('rect',{x:mark.xPt-1,y:mark.yPt-1,width:Math.max(9,mark.widthPt)+2,
      height:Math.max(6,mark.heightPt)+2,rx:1,'aria-hidden':'true'});
    box.classList.add('form-field-mark');box.dataset.markKey=key;sheet.append(box);
  }
}
async function locateFormField(key:string,label:string,scroll=true,fromPage=pageIndex){
  formSelection={key,label};
  const result=preview;
  const status=q('trial-location');
  if(!result)return;
  const pageFromIndex=result.fieldPages?.[key];
  let target:number|undefined;
  for(const index of [...mountedPages].sort((a,b)=>Math.abs(a-fromPage)-Math.abs(b-fromPage))){
    const sheet=pageSlots[index]?.querySelector('svg[aria-label]');
    if(sheet instanceof SVGElement){
      drawFormSelection(sheet);
      if(target===undefined&&sheet.querySelector('.form-field-mark'))target=index;
    }
  }
  target??=pageFromIndex;
  if(target===undefined){
    status.textContent=label+' · ยังไม่มีตำแหน่งบนหน้าที่จัดแล้ว';
    return;
  }
  if(!await ensurePage(target)||preview!==result||formSelection?.key!==key||!showingPreview)return;
  const sheet=pageSlots[target].querySelector('svg[aria-label]');
  if(!(sheet instanceof SVGElement))return;
  drawFormSelection(sheet);
  const mark=sheet.querySelector('.form-field-mark');
  if(!mark){status.textContent=label+' · ยังไม่มีตำแหน่งบนหน้าที่จัดแล้ว';return;}
  status.textContent=label+' · หน้า '+(target+1);
  if(scroll){
    const box=mark.getBoundingClientRect(),top=document.querySelector('.editor-title')?.getBoundingClientRect().bottom??0;
    if(box.top<top+12||box.bottom>innerHeight-12)mark.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});
    reportPage(target);
  }
}
function showPage(page:DrawPage,index:number) {
  if(!preview)return;
  const sheet=svg('svg',{viewBox:'0 0 '+page.widthPt+' '+page.heightPt,role:preview.previewId?'group':'img','aria-label':'กระดาษ Engine หน้า '+(index+1)});
  const background=sectionBackgroundImage(page.sectionDefinitionId);
  const surface=!background&&canvasPreview&&preview.previewId?canvasSurface(page,pageSlots[index].clientWidth||previewPaper.clientWidth,sheet):undefined;
  if(surface){
    for(const line of page.lines)sheet.append(svg('g',{role:'img','aria-label':line.text}));
    canvasInk.get(surface)?.();
  }else{
    sheet.append(svg('rect',{width:page.widthPt,height:page.heightPt,fill:color(page.backgroundColor)}));
    if(background)sheet.append(svg('image',{href:background,width:page.widthPt,height:page.heightPt,preserveAspectRatio:'none','data-section-background':page.sectionDefinitionId!}));
    for(const f of page.fills??[])sheet.append(svg('rect',{x:f.xPt,y:f.yPt,width:f.widthPt,height:f.heightPt,fill:color(f.color)}));
    paintBorders(sheet,page);
    for(const line of page.lines){
      if(line.glyphUses){
        const run=svg('g',{fill:color(line.color),'aria-label':line.text});
        if(line.edit)run.dataset.trialInk=line.edit.occurrence;
        for(const [glyph,x,y] of line.glyphUses)
          run.append(svg('use',{href:'#p'+index+'-'+glyph,transform:'translate('+x+' '+y+') scale('+line.scale+' -'+line.scale+')'}));
        sheet.append(run);
      }else{
        const text=svg('text',{x:line.xPt,y:line.yPt+line.baselineOffsetPt,fill:color(line.color),
          'font-size':line.fontSizePt,'font-weight':line.weight??400,'xml:space':'preserve'});
        if(line.edit)text.dataset.trialInk=line.edit.occurrence;
        text.textContent=line.text;sheet.append(text);
      }
    }
    if(page.glyphs){
      const defs=svg('defs',{});
      for(const [id,path] of Object.entries(page.glyphs))defs.append(svg('path',{id:'p'+index+'-'+id,d:path}));
      sheet.prepend(defs);
    }
    for(const image of page.sampleImages??[]){
      const bounds={x:image.xPt,y:image.yPt,width:image.widthPt,height:image.heightPt};
      if(image.resourceId){const url=sharedPreview?guestImages.get(image.resourceId):assetUrl(image.resourceId,preview.previewId);
        if(url)sheet.append(svg('image',{...bounds,href:url,preserveAspectRatio:'none'}));}
      else if(image.color)sheet.append(svg('rect',{...bounds,fill:color(image.color)}));
    }
  }
  for(const line of page.lines){
    const edit=line.edit;
    if(printAccurate||!edit||trialForm?.read(edit.key)===undefined)continue;
    const width=Math.max(edit.contentWidth??(edit.blank?80:line.widthPt),1);
    const left=edit.align==='right'?width-line.widthPt:edit.align==='center'?(width-line.widthPt)/2:0;
    const hit=svg('rect',{x:line.xPt-left,y:line.yPt,width,
      height:line.heightPt,fill:'transparent',tabindex:0,role:'button','aria-label':edit.blank?'พิมพ์ค่า '+JSON.parse(edit.key).at(-1):'แก้ค่า '+line.text});
    hit.dataset.fontSize=String(line.fontSizePt);hit.dataset.align=edit.align??'left';hit.dataset.inkColor=color(line.color);
    hit.dataset.weight=String(line.weight??400);
    if(edit.blank)hit.classList.add('trial-field-blank');
    hit.classList.add('trial-field-hit');trialHits.set(hit,edit);
    hit.dataset.trialKey=edit.key;hit.dataset.trialOccurrence=edit.occurrence;hit.dataset.start=String(edit.start);hit.dataset.end=String(edit.end);
    hit.addEventListener('click',event=>{
      const mouse=event as MouseEvent,rect=hit.getBoundingClientRect();
      const x=(mouse.clientX-rect.left)*width/rect.width-left;
      let offset=edit.end;
      for(let i=0;i<edit.clusters.length;i++){
        const [start,from]=edit.clusters[i];
        const end=edit.clusters[i+1]?.[0]??line.widthPt;
        if(x<(start+end)/2){offset=from;break;}
      }
      beginPaperEdit(edit,offset,index);
    });
    hit.addEventListener('keydown',event=>{
      const key=(event as KeyboardEvent).key;
      if(key==='Enter'||key===' '){event.preventDefault();beginPaperEdit(edit,edit.start,index);}
    });
    sheet.append(hit);
  }
  markSources.set(sheet,page.formMarks??[]);
  drawFormSelection(sheet);
  pageSlots[index]?.replaceChildren(surface??sheet);
  mountedPages.add(index);
  if(paperEdit?.pageIndex===index||(!paperEdit&&paperDraft))positionPaperEditor();
}
let pageSlots:HTMLElement[]=[];
let pageObserver:IntersectionObserver|undefined;
const nearbyPages=new Set<number>(),mountedPages=new Set<number>();
const pageLoads=new Map<number,Promise<boolean>>();
const retainedPages=new Map<number,{sheet:Element;nodes:number;bitmapBytes:number}>();
const retainedPageLimit=8,retainedNodeLimit=8000,retainedBitmapLimit=24*1024*1024;
let retainedNodes=0,retainedBitmapBytes=0;
function resetPreviewPages(){
  stopPageLoads();
  retainedPages.clear();retainedNodes=0;retainedBitmapBytes=0;
  pageObserver?.disconnect();pageObserver=undefined;
  nearbyPages.clear();mountedPages.clear();pageSlots=[];
}
function stopPageLoads(){
  pendingPage?.abort();pendingPage=undefined;pageLoads.clear();
}
function removeRetainedPage(index:number){
  const cached=retainedPages.get(index);
  if(cached){retainedPages.delete(index);retainedNodes-=cached.nodes;retainedBitmapBytes-=cached.bitmapBytes;}
  return cached?.sheet;
}
function restorePage(index:number){
  const sheet=removeRetainedPage(index);
  if(!sheet)return false;
  pageSlots[index].replaceChildren(sheet);mountedPages.add(index);
  if(paperEdit?.pageIndex===index||(!paperEdit&&paperDraft))positionPaperEditor();
  return true;
}
function retainPage(index:number){
  const sheet=pageSlots[index].firstElementChild;
  if(!sheet)return;
  if(coveredInk?.surface===sheet)updatePaperInk();
  const nodes=1+sheet.querySelectorAll('*').length;
  const canvas=sheet.querySelector('canvas');
  const bitmapBytes=canvas?canvas.width*canvas.height*4:0;
  if(nodes>retainedNodeLimit||bitmapBytes>retainedBitmapLimit)return;
  retainedPages.set(index,{sheet,nodes,bitmapBytes});retainedNodes+=nodes;retainedBitmapBytes+=bitmapBytes;
  while(retainedPages.size>retainedPageLimit||retainedNodes>retainedNodeLimit||retainedBitmapBytes>retainedBitmapLimit)
    removeRetainedPage(retainedPages.keys().next().value!);
}
function reportPage(index:number){
  if(!preview)return;
  pageIndex=index;
  q('page-number').textContent=(index+1)+' / '+preview.pageCount;
  jump.value=String(index+1);jump.max=String(preview.pageCount);jump.disabled=false;
  previous.disabled=index===0;next.disabled=index===preview.pageCount-1;
  prunePages();
}
function prunePages(){
  if(!pageObserver)return;
  for(const index of mountedPages){
    if(nearbyPages.has(index)||index===pageIndex||index===paperEdit?.pageIndex)continue;
    retainPage(index);
    pageSlots[index]?.replaceChildren();mountedPages.delete(index);
  }
}
function pumpPages(){
  if(!showingPreview)return;
  for(const index of [...nearbyPages].sort((a,b)=>Math.abs(a-pageIndex)-Math.abs(b-pageIndex))){
    if(pageLoads.size>=2&&!retainedPages.has(index))continue;
    if(!pageSlots[index]?.childElementCount)void ensurePage(index);
  }
}
function ensurePage(index:number):Promise<boolean>{
  const slot=pageSlots[index],result=preview,controller=pendingPage;
  if(!slot||!result||!controller)return Promise.resolve(false);
  if(slot.childElementCount||restorePage(index))return Promise.resolve(true);
  const ongoing=pageLoads.get(index);
  if(ongoing)return ongoing;
  const run=(async()=>{
    let refreshSharedPage=false;
    try{
      let page=result.paged?(index===(result.pageIndex??0)?result.pages[0]:undefined):result.pages[index];
      if(!page){
        const route=result.previewId?'/preview-runs/'+encodeURIComponent(result.previewId)+'/pages/'+index:'/preview-pages/'+result.revision+'/'+index;
        const response=await fetch(endpoint+route,{headers:sharedPreviewHeaders,signal:AbortSignal.any([controller.signal,AbortSignal.timeout(15000)])});
        if(response.status===410){previewStatus.textContent=shareUnavailable;return false;}
        const data=await response.json();
        refreshSharedPage=sharedPreview&&response.status===404&&data.error==='PREVIEW_EXPIRED';
        if(!response.ok||data.revision!==result.revision||data.index!==index||!data.page)throw Error('Page unavailable');
        page=data.page as DrawPage;
      }
      await readyImages(page,result.previewId);
      if(preview!==result||controller.signal.aborted||!showingPreview)return false;
      showPage(page,index);
      return true;
    }catch{
      if(!controller.signal.aborted&&preview===result){
        nearbyPages.delete(index);
        const retry=button('ลองเปิดหน้า '+(index+1)+' อีกครั้ง',()=>{
          slot.replaceChildren();
          if(refreshSharedPage){trialBase=undefined;reportPage(index);trialForm?.refresh();}
          else void ensurePage(index);
        });
        retry.className='preview-page-retry';slot.replaceChildren(retry);
      }
      return false;
    }
  })();
  pageLoads.set(index,run);
  void run.finally(()=>{
    if(preview===result&&pageLoads.get(index)===run){pageLoads.delete(index);pumpPages();}
  });
  return run;
}
function mountPreview(result:Preview,focusPage?:number){
  const prior=preview,oldIndex=pageIndex;
  stopPageLoads();
  pendingPage=new AbortController();
  preview=result;paperInteractionBlocked=false;
  const start=result.pageIndex??0,selected=focusPage??start;
  const initial=result.pages[0];
  const reusable=(index:number)=>{
    const key=result.pageKeys?.[index];
    return Boolean(key&&key===prior?.pageKeys?.[index]&&prior?.fingerprint===result.fingerprint);
  };
  for(const index of retainedPages.keys())if(!reusable(index))removeRetainedPage(index);
  for(const index of mountedPages){
    if(reusable(index))continue;
    pageSlots[index].replaceChildren();mountedPages.delete(index);
  }
  while(pageSlots.length>result.pageCount){
    const sheet=pageSlots.pop()!;
    pageObserver?.unobserve(sheet);nearbyPages.delete(pageSlots.length);
    sheet.parentElement!.remove();
  }
  const additions=document.createDocumentFragment();
  const firstNew=pageSlots.length;
  for(let i=0;i<result.pageCount;i++){
    const data=result.pageSizes?.[i]??[result.pages[i]?.widthPt??initial.widthPt,result.pages[i]?.heightPt??initial.heightPt,''];
    const before=prior?.pageSizes?.[i];
    if(i<firstNew&&before?.[0]===data[0]&&before[1]===data[1]&&before[2]===data[2])continue;
    const label='หน้า '+(i+1)+(data[2]?' · '+data[2]:'');
    let sheet=pageSlots[i],page=sheet?.parentElement;
    if(!page){
      page=element('section');page.className='preview-page';page.dataset.pageIndex=String(i);
      const caption=element('p');caption.className='preview-page-label';
      sheet=element('div');sheet.className='preview-page-sheet';sheet.dataset.pageIndex=String(i);
      page.append(caption,sheet);pageSlots.push(sheet);additions.append(page);
    }
    page.setAttribute('aria-label',label);page.firstElementChild!.textContent=label;
    sheet.style.aspectRatio=data[0]+'/'+data[1];
  }
  previewPaper.append(additions);
  previewPaper.dataset.revision=String(result.revision);
  if(result.previewId)previewPaper.dataset.run=result.previewId;
  if(paperEdit)paperEdit.pageIndex=selected;
  if(!mountedPages.has(start)&&!restorePage(start))showPage(initial,start);
  reportPage(selected);
  if(selected!==start)void ensurePage(selected);
  if(prior&&selected!==oldIndex)pageSlots[selected]?.parentElement?.scrollIntoView({block:'start'});
  positionPaperEditor();
  if(!pageObserver){
    const observer=new IntersectionObserver(entries=>{
      if(pageObserver!==observer)return;
      for(const entry of entries){
        const index=Number((entry.target as HTMLElement).dataset.pageIndex);
        if(pageSlots[index]!==entry.target)continue;
        if(entry.isIntersecting)nearbyPages.add(index);
        else nearbyPages.delete(index);
      }
      prunePages();pumpPages();trackVisiblePage();
    },{rootMargin:'600px 0px'});
    pageObserver=observer;
  }
  for(const slot of pageSlots.slice(firstNew))pageObserver.observe(slot);
  pumpPages();
}
async function goPage(index:number,stillCurrent=()=>true){
  const result=preview,slot=pageSlots[index];
  if(!result||!slot)return false;
  if(!await ensurePage(index)||preview!==result||!stillCurrent())return false;
  slot.parentElement?.scrollIntoView({block:'start'});
  reportPage(index);
  return true;
}
let trackPageFrame=0;
function trackVisiblePage(){
  if(!showingPreview||!preview||trackPageFrame)return;
  trackPageFrame=requestAnimationFrame(()=>{
    trackPageFrame=0;
    let best=pageIndex,distance=Infinity;
    for(const index of nearbyPages){
      const box=pageSlots[index]?.getBoundingClientRect();
      if(!box||box.bottom<0||box.top>window.innerHeight)continue;
      const score=Math.abs((box.top+box.bottom)/2-window.innerHeight/2);
      if(score<distance){distance=score;best=index;}
    }
    if(best!==pageIndex)reportPage(best);
  });
}
window.addEventListener('scroll',trackVisiblePage,{passive:true});

async function loadPreview(trial?:Trial,current=()=>true,usable=current,structure=0,fields?:ReadonlyMap<string,HTMLTextAreaElement>) {
  if(!draft||pendingPreview||!showingPreview||isDirty())return;
  const started=performance.now(), revision=draft.revision, fingerprint=draft.fingerprint;
  clearPreviewIssue();issuePreviewId=undefined;
  const request=new AbortController();pendingPreview=request;
  refreshPreview.disabled=true;
  previewStatus.textContent='กำลังจัดหน้า Revision '+revision+'…';
  try{
    const signal=AbortSignal.any([request.signal,AbortSignal.timeout(120000)]);
    const post=(input:object)=>fetch(endpoint+'/preview',{method:'POST',headers:{...sharedPreviewHeaders,'Content-Type':'application/json'},
      body:JSON.stringify({expectedRevision:revision,...(trial&&!printAccurate&&resumablePreview?{layoutMode:'resume'}:{}),...input}),signal});
    const full=trial?{trial}:benchmark?{sample:'benchmark'}:{};
    const base=trialBase;
    const changes=!printAccurate&&!fullTrialTransport&&trial&&base&&fields&&base.structure===structure
      ?trialValueChanges(base.trial,trial,fields):undefined;
    const patch=changes&&base&&trial?{trialPatch:{basePreviewId:base.previewId,changes,pageIndex:trial.pageIndex,focus:trial.focus}}:undefined;
    let response=await post(patch??full);
    if(!usable()||pendingPreview!==request)return;
    let data=await response.json() as Preview & {error?:string;issues?:{code:string;path?:string}[]};
    if(patch&&response.status===409&&data.error==='trial_base_unavailable'){
      if(!usable()||pendingPreview!==request)return;
      trialBase=undefined;
      if(!current())return;
      response=await post(full);
      if(!usable()||pendingPreview!==request)return;
      data=await response.json() as typeof data;
    }
    if(!usable()||pendingPreview!==request)return;
    if(response.status===409){previewStatus.textContent='ฉบับนี้มี revision ใหม่กว่าในระบบ กรุณาโหลดฉบับล่าสุด';return;}
    if(!response.ok){
      const detail=data.issues?.slice(0,4).map(issue=>(issue.path??'ข้อมูล')+' · '+issue.code).join(' / ');
      if(pendingPreview===request&&current())previewStatus.textContent=response.status===410?shareUnavailable:
        response.status===429?'Engine กำลังจัดหน้าอีกชุด ลองใหม่เมื่อพร้อม':
        data.error==='invalid_image'?'เปิดภาพไม่ได้ กรุณาเลือกไฟล์ PNG หรือ JPEG ที่ถูกต้อง':
        data.error==='resume_preview_disabled'?'แล็บนี้ยังไม่ได้เปิดการจัดหน้าต่อจากจุดพัก':
        data.error==='font_not_ready'?'ฟอนต์ของโครงยังใช้จัดหน้าไม่ได้':
        detail?'ตรวจค่าตัวแปร · '+detail:'จัดหน้าทดลองไม่สำเร็จ';
      return;
    }
    if(!response.ok||!data.pages?.length||data.revision!==revision||data.fingerprint!==fingerprint)throw Error('Preview unavailable');
    if(benchmark)await Promise.all([document.fonts.load('300 12px FlowDocLab'),document.fonts.load('400 12px FlowDocLab')]);
    await readyImages(data.pages[0],data.previewId);
    if(pendingPreview!==request||!usable()||draft.revision!==revision||!showingPreview)return;
    const desired=trial&&trial.focus?.occurrence!==paperEdit?.occurrence
      ?Math.min(pageIndex,data.pageCount-1):undefined;
    if(current())paperDraft=undefined;
    trialBase=!printAccurate&&trial&&data.trialPatchBase&&data.previewId?{previewId:data.previewId,trial,structure}:undefined;
    mountPreview(data,desired);
    if(formSelection)void locateFormField(formSelection.key,formSelection.label,false);
    issuePreviewId=trial&&current()?data.previewId:undefined;
    previewHasBlankMarkers=!!trial?.blanks.length;
    if(pendingPreview!==request)return;
    previewStatus.textContent=current()?(printAccurate?'หน้าที่จะออก PDF · ':'')+'ตัวอย่างฉบับร่าง · '+data.pageCount+' หน้า':
      'แสดงผลจัดหน้าล่าสุดระหว่างพิมพ์ · กำลังจัดหน้าต่อ…';
    afterPaint('flowdoc:engine-preview',started,{revision,pageCount:data.pageCount,engineMs:data.engineMs,renderMs:data.renderMs,layoutHash:data.layoutHash,renderPath:data.renderPath});
  }catch{
    if(!request.signal.aborted&&current())previewStatus.textContent='จัดหน้าทดลองไม่สำเร็จ ลองจัดหน้าใหม่อีกครั้ง';
  }finally{
    if(pendingPreview===request){pendingPreview=undefined;refreshPreview.disabled=false;showPreviewIssue();}
  }
}
let trialVersion='',issuePreviewId:string|undefined;
let printAccurate=false,previewHasBlankMarkers=false;
const printLayout=q<HTMLButtonElement>('preview-print-layout');
function setPrintLayout(on:boolean){
  clearPreviewIssue();issuePreviewId=undefined;
  printAccurate=on;
  printLayout.setAttribute('aria-pressed',String(on));
  printLayout.textContent=on?'กลับไปกรอกบนกระดาษ':'ดูหน้าที่จะออก PDF';
  q('trial-edit-hint').textContent=on?'แสดงช่องว่างตามข้อมูลจริง · แก้ข้อมูลได้ในแบบฟอร์ม':'พิมพ์ในฟอร์มหรือบนกระดาษ ค่าจะอัปเดตทั้งสองฝั่ง';
  cancelPreview();
  if(showingPreview)trialForm?.refresh();
}
printLayout.onclick=()=>setPrintLayout(!printAccurate);

const trialExport=q<HTMLDetailsElement>('trial-export');
installPreviewShare(()=>!sharedPreview&&showingPreview&&draft.canSharePreview&&!isDirty()
  ?{endpoint,revision:draft.revision,fingerprint:draft.fingerprint}:undefined);
installTrialExport(trialExport,q('trial-export-status'),()=>{
  if(!showingPreview||isDirty()||!trialForm||!draft.docKey||trialVersion!==templateId+'/'+draft.revision+'/'+draft.fingerprint)return;
  return {url:endpoint+'/export',docKey:draft.docKey,revision:draft.revision,fingerprint:draft.fingerprint,
    headers:sharedPreviewHeaders,snapshot:trialForm.exportSnapshot};
});
function openPreview(){
  const custom=!benchmark;
  trialExport.hidden=!custom;
  printLayout.hidden=!custom||sharedPreview||!!draft.readOnly;
  q('open-preview-share').hidden=sharedPreview||!draft.canSharePreview||draft.revision<1;
  q('trial-input').hidden=!custom;
  q('legacy-preview-description').hidden=custom;
  q('trial-edit-hint').hidden=!custom;
  const blankSheet=q('trial-empty-sheet');blankSheet.hidden=!custom;
  const page=draft.definition.pageLayouts?.[draft.definition.sections[0]?.pageLayoutId??draft.definition.book.defaultPageLayoutId]?.page;
  const [short,long]=paperSizes[page?.size??'A4']??paperSizes.A4;
  blankSheet.style.aspectRatio=page?.orientation==='landscape'?long+'/'+short:short+'/'+long;
  refreshPreview.hidden=custom;
  if(!custom){if(!preview)void loadPreview();return;}
  const version=templateId+'/'+draft.revision+'/'+draft.fingerprint;
  if(trialVersion===version){if((!preview||!issuePreviewId)&&!pendingPreview)trialForm?.refresh();return;}
  trialVersion=version;trialBase=undefined;
  formSelection=undefined;q('trial-location').textContent='';
  printAccurate=false;printLayout.setAttribute('aria-pressed','false');printLayout.textContent='ดูหน้าที่จะออก PDF';
  trialForm?.dispose();paperDraft=undefined;closePaperEdit();
  previewStatus.textContent='กำลังเปิดกระดาษจากโครง · Revision '+draft.revision;
  const starter=new Map([...activeFormats.values()].map(format=>[format.ownerAreaId,format.key]));
  trialForm=mountTrial(q<HTMLFormElement>('trial-form'),draft.definition,starter,(structural,key)=>{
    clearPreviewIssue();issuePreviewId=undefined;
    if(structural){
      formSelection=undefined;q('trial-location').textContent='';
      previewPaper.querySelectorAll('.form-field-mark').forEach(mark=>mark.remove());
      paperInteractionBlocked=true;paperDraft=undefined;closePaperEdit();
    }else if(key){
      if(paperDraft?.key===key&&!trialPaperDraft.hidden)showDraftText();
      else{paperDraft={key};positionPaperEditor();}
    }
    previewStatus.textContent='กำลังอัปเดตข้อมูลทดลอง…';
  },async(trial,current,usable,structure,fields)=>{
    if(trialVersion!==version||!showingPreview||isDirty())return;
    if(printAccurate){
      const snapshot=await trialForm!.exportSnapshot();
      if(!current()||!usable()||!printAccurate||!showingPreview)return;
      await loadPreview({...snapshot,blanks:[],pageIndex},current,usable,structure,fields);
    }else await loadPreview({...trial,pageIndex},current,usable,structure,fields);
  },(key,label)=>{void locateFormField(key,label);});
}
let previewIssueRequest:AbortController|undefined;
function clearPreviewIssue(){
  previewIssueRequest?.abort();
  previewIssueRequest=undefined;
  q('preview-issue-slot').replaceChildren();
}
function issueContext():IssueContext|undefined{
  if(sharedPreview||draft.readOnly||!templateId||!draft.docKey||isDirty())return;
  return {url:endpoint+'/issue',templateId,name:draft.name,docKey:draft.docKey,revision:draft.revision,fingerprint:draft.fingerprint,
    currentRun:()=>!pendingPreview&&trialForm&&trialVersion===templateId+'/'+draft.revision+'/'+draft.fingerprint
      &&!previewHasBlankMarkers&&preview?.previewId===issuePreviewId?issuePreviewId:undefined,
    needsPrintLayout:()=>!!issuePreviewId&&previewHasBlankMarkers,
    openPrintLayout:()=>{changeMode('preview');setPrintLayout(true);},
    snapshot:()=>trialForm!.exportSnapshot(),openPreview:()=>changeMode('preview'),
    refreshSource:()=>{void load().then(()=>changeMode('preview'));}};
}
function showPreviewIssue(){
  if(!showingPreview||!printAccurate||previewIssueRequest)return;
  const context=issueContext();
  if(!context?.currentRun())return;
  previewIssueRequest=new AbortController();
  q('preview-issue-slot').append(issuePanel(context,previewIssueRequest.signal,'preview'));
}
function changeMode(mode:'define'|'preview') {
  const toPreview=mode==='preview';
  showingPreview=toPreview;previewPanel.hidden=!toPreview;editor.hidden=mode!=='define';
  defineTab.setAttribute('aria-pressed',String(mode==='define'));previewTab.setAttribute('aria-pressed',String(toPreview));
  updateDraftHeader();
  if(toPreview){openPreview();positionPaperEditor();pumpPages();showPreviewIssue();}
  else clearPreviewIssue();
  if(!toPreview)closePaperEdit();
  if(!toPreview&&pendingPreview){
    cancelPreview();refreshPreview.disabled=false;
    if(!benchmark)previewStatus.textContent='กำลังรอเปิดกระดาษทดลอง';
  }
}
form.addEventListener('submit',async event=>{
  event.preventDefault();
  const item=selection,label=input.value.trim();
  if(!item||item.type!=='section'||!label||isSaving||hasConflict||isDirty()||draft.readOnly)return;
  if(label===item.section.label){status.textContent='ชื่อส่วนยังเหมือนเดิม';return;}
  isSaving=true;refreshButtons();
  status.textContent='กำลังบันทึก…';
  try{
    const response=await fetch(endpoint,{method:'PUT',headers:{'Content-Type':'application/json'},signal:AbortSignal.timeout(15000),
      body:JSON.stringify({sectionId:item.id,label,expectedRevision:draft.revision,idempotencyKey:crypto.randomUUID()})});
    const reply=await response.json() as ServiceReply;
    if(response.status===409&&reply.issues?.[0]?.code==='STALE_CURRENT'){
      hasConflict=true;conflict.hidden=false;q<HTMLDetailsElement>('advanced-details').open=true;
      // Preserve the attempted text until the user explicitly reloads.
      status.textContent='บันทึกไม่ได้ ฉบับที่เปิดอยู่เก่ากว่าฉบับล่าสุด';
      return;
    }
    if(!response.ok||!reply.ok||!reply.value||reply.value.templateId!==templateId)throw Error('Save failed');
    const data=reply.value;
    savedDefinition=data.definition;
    cancelPreview();showDraft(data,item.ref);
    status.textContent='บันทึกแล้ว · Revision '+data.revision;
    if(showingPreview)openPreview();
  }catch{
    status.textContent='ยังยืนยันผลบันทึกไม่ได้ ชื่อที่พิมพ์ยังอยู่';
  }finally{
    isSaving=false;refreshButtons();
  }
});
q('reload').addEventListener('click',()=>void load());
previewTab.addEventListener('click',()=>changeMode('preview'));
defineTab.addEventListener('click',()=>changeMode('define'));
previous.addEventListener('click',()=>void goPage(pageIndex-1));
next.addEventListener('click',()=>void goPage(pageIndex+1));
jump.addEventListener('change',()=>{if(jump.checkValidity()&&jump.value)void goPage(Number(jump.value)-1);});
refreshPreview.addEventListener('click',()=>{cancelPreview();void loadPreview();});
function historyReplaceDraft(id:string){window.history.replaceState(null,'','/phase1-editor.html?id='+encodeURIComponent(id));}
if(sharedPreview){
  q('editor-brand').removeAttribute('href');
  q('editor-badge').textContent='Preview ที่แชร์';
  q('editor-library-link').hidden=true;
  document.querySelector<HTMLElement>('.editor-toolbar')!.hidden=true;
  document.title='Preview ที่แชร์ · FlowDoc';
  void load();
}else if(newMode&&!templateId){
  q('title').textContent='สร้างโครงเอกสาร';q('new-document').hidden=false;
  const newForm=q<HTMLFormElement>('new-document-form');
  function updateNewSheet(){
    const values=new FormData(newForm),size=String(values.get('size')),landscape=values.get('orientation')==='landscape';
    const [short,long]=paperSizes[size]??paperSizes.A4,[width,height]=landscape?[long,short]:[short,long];
    const sheet=q('new-sheet');sheet.style.aspectRatio=width+' / '+height;
    const inner=sheet.firstElementChild as HTMLElement;
    for(const side of paddingSides)inner.style[side]=Math.max(0,Math.min(180,Number(values.get(side))||0))/(side==='left'||side==='right'?width:height)*100+'%';
    q('new-sheet-label').textContent=size+' · '+(landscape?'แนวนอน':'แนวตั้ง');
  }
  newForm.addEventListener('input',updateNewSheet);updateNewSheet();
  newForm.addEventListener('submit',async event=>{
    event.preventDefault();
    const submit=newForm.querySelector<HTMLButtonElement>('button[type=submit],button:not([type])')!;
    if(submit.disabled)return;
    submit.disabled=true;
    try{
      const values=Object.fromEntries(new FormData(newForm)) as Record<string,string>;
      const fonts=await listFonts();
      const sarabun=fonts.filter(f=>f.familyName==='Sarabun'&&f.faces.some(face=>face.weight===400&&face.style==='normal'))
        .sort((a,b)=>b.version-a.version)[0];
      if(!sarabun){
        fontCatalog=undefined;
        throw Error('โหลด Sarabun ตัวปกติจากคลังไม่ได้ กรุณาลองเริ่มวางโครงอีกครั้ง');
      }
      const data=newDefinition(values,sarabun.releaseId);
      q('new-document').hidden=true;showDraft(data);
    }catch(error){q('new-document-error').textContent=error instanceof Error?error.message:'ตั้งกระดาษไม่สำเร็จ';}
    finally{submit.disabled=false;}
  });
}else void load();

