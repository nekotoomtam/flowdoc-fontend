import './phase1-editor.css';
import {addBand,addVariable,applyPart,changePage,newDefinition,partValue,settings} from './editor-creation';
import type {Part} from './editor-creation';
import {openVisualAuthoring} from './editor-visual-authoring';
import {mountTrial} from './editor-trial';
import {paperCaretStops,paperOffsetMap} from './paper-selection.mjs';
import {trialValueChanges} from '../scripts/trial-value-delta.mjs';
import type {Trial} from './editor-trial';

import {applyStructureChange, canAddPlainRows, defaultCellPadding, groupSources, lengthInPoints, paddingSides, refKey, structureOrder} from './editor-structure';
import type {Band, Change, Definition, DocNode, Format, Fragment, Host, Inline, Length, Ref, Schema, Section} from './editor-structure';

type Draft = {templateId:string;docKey?:string;name:string;revision:number;fingerprint:string;definition:Definition};
type Outline = {id:string;ref:Ref;label:string;type:string;section:Section;format?:Format;children:Outline[];parent?:Outline;node?:DocNode;band?:Band;inline?:Inline;detail?:string};
type DrawPage = {
  widthPt: number; heightPt: number; backgroundColor: string;
  sampleImages?: {xPt:number; yPt:number; widthPt:number; heightPt:number; color?:string; resourceId?:string}[];
  glyphs?:Record<string,string>;
  fills?: {xPt: number; yPt: number; widthPt: number; heightPt: number; color: string}[];
  borders?: {x1Pt: number; y1Pt: number; x2Pt: number; y2Pt: number; widthPt: number; color: string; style?:string}[];
  lines: {text: string; xPt: number; yPt: number; widthPt:number; heightPt:number; fontSizePt: number; baselineOffsetPt: number; color: string; weight?: number; scale?:number; glyphUses?:[string,number,number][]; edit?:PreviewEdit}[];
};
type TrialTab = {occurrence:string;pageIndex:number};
type PreviewEdit = {previous?:TrialTab;next?:TrialTab;key:string;occurrence:string;start:number;end:number;blank?:boolean;contentWidth?:number;align?:string;clusters:[number,number,number][]};
type Preview = {trialPatchBase?:boolean;pageKeys?:(string|null)[];pageSizes?:[number,number,string][];pageIndex?:number;previewId?:string;revision: number; fingerprint: string; engineVersion: string; engineMs: number; renderMs: number; layoutHash?: string; renderPath?:string; pageCount: number; pages: DrawPage[]; priorityPages?:[number,DrawPage][]; confirmedPages?:number[]; paged?:boolean; entryCount?:number; imagePlacements?:number};
type ServiceReply = {ok: boolean; value?: Draft; issues?: {code: string; path?:string}[]};
const q = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id)! as T;
const title = q('title'), status = q('status'), editor = q('editor'), tree = q('tree'), paper = q('paper'), variables = q('variables');
const form = q<HTMLFormElement>('rename'), input = q<HTMLInputElement>('section-name'), save = q<HTMLButtonElement>('save');
const defineTab = q<HTMLButtonElement>('define-tab'), previewTab = q<HTMLButtonElement>('preview-tab');
const conflict = q('conflict'), previewPanel = q('preview'), previewStatus = q('preview-status'), previewPaper = q('preview-paper');
const previous = q<HTMLButtonElement>('previous-page'), next = q<HTMLButtonElement>('next-page'), refreshPreview = q<HTMLButtonElement>('refresh-preview');
const jump=q<HTMLInputElement>('jump-page');
const benchmark=sessionStorage.getItem('flowdoc:benchmark-preview')==='1';
const canvasPreview=new URLSearchParams(location.search).get('previewRenderer')==='canvas';
const resumablePreview=new URLSearchParams(location.search).get('previewEngine')==='resume';
const browserPreview=new URLSearchParams(location.search).get('previewEngine')==='worker';
const fullTrialTransport=new URLSearchParams(location.search).get('previewTransport')==='full'||
  sessionStorage.getItem('flowdoc:full-trial-transport')==='1';
let pendingPage:AbortController|undefined;
const editorApi='/api/editor-phase1/drafts';
const newMode=new URLSearchParams(location.search).get('new')==='1';
let templateId = new URLSearchParams(location.search).get('id');
let endpoint=editorApi+'/'+encodeURIComponent(templateId??'');
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
let continuousStructure=new URLSearchParams(location.search).get('structureView')==='continuous';
let roots:Outline[] = [], outlines=new Map<string,Outline>();
const expanded=new Map<string,boolean>();
const history:{definition:Definition;selection:Ref}[]=[];
let isSaving = false, isLoading = false, hasConflict = false, showingPreview = false;
let trialBase:{previewId:string;trial:Trial;structure:number}|undefined;
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
      const label = areaField ?? (inline || (['table-row','table-cell'].includes(node.type) ? kinds[node.type]+' '+(position+1) : kinds[node.type]??node.type));
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
    const itemButton=button(item.label,()=>select(item,true));
    itemButton.dataset.kind=item.type;
    itemButton.dataset.nodeId=item.id;
    itemButton.dataset.ref=refKey(item.ref);
    treeNodes.set(item,itemButton);
    const type=element('small',kinds[item.type]??item.type);
    type.className='type';
    if(item.type==='area')type.textContent='Area · '+item.children.length+' รูปแบบ';
    if(item.label===type.textContent||item.label.startsWith(type.textContent+' '))type.hidden=true;
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
const paperSizes:Record<string,[number,number]>={A4:[595.276,841.89],A3:[841.89,1190.551],Letter:[612,792],Legal:[612,1008]};
function drawSectionPaper(root: Outline, preferred?: Format) {
  const sheet=element('div');sheet.className='definition-sheet';sheet.dataset.sectionId=root.id;
  sheet.classList.toggle('sequence-sheet',continuousStructure);
  const switcher=element('div');switcher.className='definition-section-tools structure-tools';
  const layout=draft.definition.pageLayouts?.[root.section.pageLayoutId??draft.definition.book.defaultPageLayoutId]?.page;
  const [short,long]=paperSizes[layout?.size??'A4']??paperSizes.A4;
  const [width,height]=layout?.orientation==='landscape'?[long,short]:[short,long];
  const points=(value?:Length)=>value?(value.unit==='mm'?value.value*72/25.4:value.value):0;
  const unit=(n:number)=>'calc('+n+' * var(--sheet-pt))';
  const length=(value?:Length)=>value?unit(points(value)):'';
  const hex=(value?:string)=>value&&/^[0-9a-f]{6}$/i.test(value)?'#'+value:'';
  const choose=(item:Outline,label=item.label,className='definition-control',activate=()=>select(item,false))=>{
    const control=button(label,activate);control.className=className;
    control.dataset.paperRef=refKey(item.ref);
    control.dataset.kind=item.type;
    if(item.inline?.type==='text')control.addEventListener('dblclick',()=>openInlineEditor(item));
    paperNodes.set(item,control);return control;
  };
  function contents(item: Outline): HTMLElement {
    const block=element('div');block.className='definition-block';block.dataset.kind=item.type;
    const props=item.node?.props;
    if(item.type==='area'){
      block.classList.add('definition-area');
      if(continuousStructure){
        block.append(choose(item,'Area · '+item.label,'sequence-area-label'),...item.children.map(contents));
        return block;
      }
      block.append(choose(item));
      const group=element('details');group.className='format-picker';
      const areaKey=refKey(item.ref);
      const active=item.children.find(child=>child.format===preferred)
        ??item.children.find(child=>child.format===activeFormats.get(areaKey))??item.children[0];
      group.append(element('summary',item.label+' › '+(active?.label??'เลือก Format')));
      const options=element('div');options.className='format-choices';
      if(active?.format)activeFormats.set(areaKey,active.format);
      for(const format of item.children){
        if(format===active)continue;
        options.append(choose(format,format.label,'definition-format-choice'));
      }
      group.append(options);switcher.append(group);
      if(active)block.append(contents(active));
    }else if(item.type==='format'){
      block.classList.add('definition-format');
      if(continuousStructure){
        const header=element('div');header.className='sequence-format-heading';
        const order=(item.parent?.children.indexOf(item)??0)+1;
        const label=choose(item,order+' · '+item.label,'sequence-format-label',()=>{
          select(item,false);
          if(creationMode())void editPart(item.ref,'format','แก้ Format · '+item.label);
        });
        label.dataset.sequenceFormat=item.format?.key??'';
        if(creationMode())label.setAttribute('aria-label','แก้ Format '+item.label);
        header.append(element('span','Area '+item.parent?.label+' · Format'),label);
        const sources=item.format?.rowGroups?.map(group=>[group.source.key,group.memberRepeat?.source.key]
          .filter(Boolean).map(key=>key+'[]').join(' › '))??[];
        if(sources.length)header.append(element('small','แถววนตาม '+sources.join(' · ')));
        block.append(header);
      }else block.append(choose(item));
      block.append(...item.children.map(contents));
    }else if(continuousStructure&&item.type==='page-break'){
      block.classList.add('sequence-page-break');
      const label='ขึ้นหน้าใหม่หลังจุดนี้'+(item.format?' · '+item.format.key:'');
      block.append(choose(item,label,'sequence-break-label'));
    }else if(continuousStructure&&item.type==='table-of-contents'){
      block.classList.add('sequence-contents');
      block.append(choose(item,'สารบัญอัตโนมัติ','sequence-contents-label'),
        element('small','ดึงจากหัวข้อที่ตั้งให้เข้าสารบัญ'));
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
          td.addEventListener('click',event=>{if(!(event.target as HTMLElement).closest('button'))select(cell,false);});
          if(cellIndex===0)td.append(rowButton);
          td.append(choose(cell,cell.label,'definition-cell-control'),...cell.children.map(contents));tr.append(td);
        }
        body.append(tr);
      }
    }else if(item.type==='text-block'){
      block.classList.add('definition-text');
      block.append(choose(item,'ข้อความ','definition-marker'));
      const style=draft.definition.styles[props?.textStyleId??''] as {fontSize?:Length;lineHeightPt?:number;font?:{weight?:number}}|undefined;
      if(style?.fontSize)block.style.fontSize=length(style.fontSize);
      if(style?.lineHeightPt)block.style.lineHeight=unit(style.lineHeightPt);
      if(style?.font?.weight)block.style.fontWeight=String(style.font.weight);
      if(props?.textAlign)block.style.textAlign=props.textAlign;
      for(const part of item.children){
        if(part.type==='line-break')block.append(choose(part,'↵','definition-inline'),element('br'));
        else block.append(choose(part,part.label,'definition-inline'+(part.type==='field-ref'?' definition-token':'')));
      }
    }else if(item.type==='image'){
      const image=choose(item,props?.source?'ภาพ · {{'+props.source.key+'}}':'ภาพ','definition-image');
      if(props?.width)image.style.width=length(props.width);
      if(props?.height)image.style.minHeight=length(props.height);
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
      block.append(choose(item),...item.children.map(contents));
    }
    return block;
  }
  sheet.style.setProperty('--sheet-pt','calc(100cqw / '+width+')');
  sheet.style.minHeight=unit(height);
  sheet.dataset.pageSize=layout?.size??'A4';
  const body=element('div');body.className='definition-body';
  if(root.section.source.kind==='blank'){
    const empty=element('div');empty.className='empty-authoring-paper';
    empty.append(element('strong','กระดาษเปล่า'),element('p','เลือกองค์ประกอบแรกของ Section นี้'),
      button('+ เพิ่มพื้นที่ (Area)',()=>askArea(root.ref)),button('+ เพิ่มข้อความ',()=>tryStage({kind:'node',at:root.ref,type:'text-block'})));
    body.append(empty);
  }
  const margin=layout?.margin??{};
  let top=points(margin.top),bottom=points(margin.bottom);
  for(const item of root.children){
    if(item.ref.band&&item.band){
      const band=item.band, layout=band.placement, header=item.ref.band==='header';
      const offset=points(layout?.offset??(header?margin.top:margin.bottom));
      const view=contents(item);view.classList.add('definition-band');
      if(band.sizing?.height)view.style.minHeight=length(band.sizing.height);
      const reserve=offset+points(band.sizing?.height)+points(band.gap);
      const left=length(layout?.left??margin.left)||'0',right=length(layout?.right??margin.right)||'0';
      if(continuousStructure){
        view.style.marginLeft=left;view.style.marginRight=right;
        view.style.marginTop=header?unit(offset):length(band.gap);
        view.style.marginBottom=header?length(band.gap):unit(offset);
        if(header)top=Math.max(0,top-reserve);
        else bottom=Math.max(0,bottom-reserve);
      }else{
        view.style.left=left;view.style.right=right;
        view.style.setProperty(header?'top':'bottom',unit(offset));
        if(header)top=Math.max(top,reserve);
        else bottom=Math.max(bottom,reserve);
      }
      sheet.append(view);
    }else body.append(contents(item));
  }
  body.style.padding=unit(top)+' '+unit(points(margin.right))+' '+unit(bottom)+' '+unit(points(margin.left));
  function placeBody(page:HTMLElement,content:HTMLElement){
    if(continuousStructure)page.insertBefore(content,page.querySelector(':scope > .definition-band[data-kind="footer"]'));
    else page.prepend(content);
  }
  placeBody(sheet,body);
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
  const bands=[...sheet.querySelectorAll(':scope > .definition-band')];
  for(const [index,blocks] of authored.entries()){
    const page=index===0?sheet:sheet.cloneNode(false) as HTMLElement;
    const content=index===0?body:body.cloneNode(false) as HTMLElement;
    content.replaceChildren(...blocks);
    if(index>0){
      for(const band of bands){
        const copy=band.cloneNode(true) as HTMLElement;
        copy.inert=true;
        for(const control of copy.querySelectorAll('[data-paper-ref]'))control.removeAttribute('data-paper-ref');
        page.append(copy);
      }
      placeBody(page,content);
    }
    page.dataset.authoringPage=String(index+1);
    page.setAttribute('aria-label',root.label+' · หน้า '+(index+1));
    page.addEventListener('click',event=>{if(event.target===page||event.target===content)select(root,false);});
    if(continuousStructure){
      const caption=element('div');caption.className='sequence-sheet-caption';
      caption.append(element('strong','แผ่นตัวอย่าง '+(index+1)));
      if(index>0)caption.append(element('span','เริ่มหลังคำสั่งขึ้นหน้าใหม่'));
      unitPanel.append(caption);
    }
    unitPanel.append(page);
  }
  return unitPanel;
}


function scrollWithin(viewport:HTMLElement,target:HTMLElement){
  const box=viewport.getBoundingClientRect(), selected=target.getBoundingClientRect();
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
  if(at&&creationMode()){
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
function drawVariables(item:Outline){
  const selected=item.inline?.type==='field-ref'&&item.inline.scope&&item.inline.key
    ?{scope:item.inline.scope,key:item.inline.key}:item.node?.type==='image'?item.node.props?.source:undefined;
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
    paperNodes.get(selection)?.removeAttribute('aria-current');
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
  if(!continuousStructure&&preferred&&(!currentSheet?.contains(control??null)||control?.classList.contains('definition-format-choice'))){
    for(const [candidate] of paperNodes)if(candidate.section===root.section)paperNodes.delete(candidate);
    const nextSheet=drawSectionPaper(root,preferred);
    currentSheet?.replaceWith(nextSheet);sectionSheets.set(root,nextSheet);
    if(!measure){const target=paperNodes.get(item);if(target)scrollWithin(paper.parentElement!,target);}
  }
  const treeTarget=treeNodes.get(item);
  treeTarget?.setAttribute('aria-current','true');
  if(!measure&&treeTarget)scrollWithin(tree,treeTarget);
  paperNodes.get(item)?.setAttribute('aria-current','true');
  q('selection').textContent=item.label;
  q('selection-detail').textContent=item.detail??(item.inline?.type==='text'?'แก้ข้อความนี้ได้บนกระดาษ':kinds[item.type]??item.type);
  const target=paperNodes.get(item);
  if(measure&&target&&paper.contains(target)){
    scrollWithin(paper.parentElement!,target);
  }
  q('path').textContent=path.join(' › ');
  form.hidden=item.type!=='section';
  if(item.type==='section'&&!hasConflict) input.value=item.label;
  if(!hasConflict)status.textContent='';
  drawVariables(item);
  showActions(item);
  showLayoutFacts(item,spacing);
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
  q<HTMLButtonElement>('save-structure').disabled=!dirty||isSaving||hasConflict;
  q<HTMLButtonElement>('undo-structure').disabled=isSaving||hasConflict||!history.length;
  q<HTMLButtonElement>('discard-structure').disabled=isSaving||hasConflict||!savedDefinition;
  q<HTMLButtonElement>('add-section').disabled=isSaving||hasConflict;
  previewTab.disabled=dirty||!templateId||isSaving||hasConflict;
  previewTab.title=previewTab.disabled?'บันทึกโครงก่อนลองข้อมูล':'ลองค่าตัวแปรบนกระดาษเสมือน';
  save.disabled=dirty||isSaving||hasConflict||!templateId;
  input.readOnly=dirty||isSaving;
  if(selection)showActions(selection);
  for(const control of variables.querySelectorAll<HTMLButtonElement>('[data-schema-action]'))control.disabled=isSaving||hasConflict;
}
function showDraft(data: Draft, keep?: Ref) {
  draft=data;
  title.textContent=data.name;
  q('revision').textContent=data.revision?'Model 20 · Revision '+data.revision:'Model 20 · ฉบับร่างใหม่';
  q('creation-steps').hidden=Boolean(templateId)||!creationMode();
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
    try{run(Object.fromEntries([...controls].map(([key,el])=>[key,el.value.trim()])));dialog.close();}
    catch(e){error.textContent=e instanceof Error?e.message:'แก้โครงไม่สำเร็จ';}
  };
  setup?.(controls);
  dialog.showModal();
}
function stage(change:Change){
  if(isSaving||hasConflict)return;
  const result=applyStructureChange(draft.definition,change);
  stageDefinition(result.definition,result.selection,change.kind);
}
function stageDefinition(definition:Definition,keep:Ref,action:string){
  if(isSaving||hasConflict)return;
  const started=performance.now();
  history.push({definition:draft.definition,selection:selection!.ref});
  if(history.length>20)history.shift();
  cancelPreview();
  showDraft({...draft,definition},keep);
  status.textContent='ปรับในฉบับร่างแล้ว · กดตรวจและบันทึกโครงเมื่อพร้อม';
  afterPaint('flowdoc:structure-edit',started,{action});
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
  openVisualAuthoring(q<HTMLDialogElement>('visual-definition-dialog'),part,label,partValue(draft.definition,at,part),{
    options:{
      font:fonts.map(font=>({value:font.releaseId,label:font.familyName+' · '+font.version+' · '+font.faces.map(face=>face.weight+' '+face.style).join(', ')})),
      style:Object.keys(draft.definition.styles).map(key=>({value:key,label:key})),
    },
    schemas:{global:draft.definition.globalSchema,section:section.inputSchema,
      ...(at.band?{[at.band]:section[at.band]?.inputSchema}:{}),
      local:draft.definition.areaFormats?.[at.formatId??'']?.inputSchema},
    localScope:part==='format'?'local':part==='band'?at.band:undefined,
  },value=>stageDefinition(applyPart(draft.definition,at,part,value),focusNodeId?selection!.ref:at,'part'),focusNodeId);
}
function paperSettings(item:Outline){
  const at=item.ref;
  const layout=draft.definition.pageLayouts?.[item.section.pageLayoutId??draft.definition.book.defaultPageLayoutId]?.page;
  const edges=['top','right','bottom','left'] as const;
  const labels=['บน','ขวา','ล่าง','ซ้าย'];
  ask('ขนาดกระดาษและระยะขอบ',[{key:'size',label:'ขนาด',value:layout?.size??'A4',options:[['A4','A4'],['Letter','Letter']]},
    {key:'orientation',label:'แนว',value:layout?.orientation??'portrait',options:[['portrait','แนวตั้ง'],['landscape','แนวนอน']]},
    ...edges.map((key,i)=>{const length=layout?.margin?.[key];return {key,label:'ขอบ'+labels[i]+' (pt)',value:String(length?length.value*(length.unit==='mm'?72/25.4:1):36)};})],
    v=>stageDefinition(changePage(draft.definition,at,settings(v)),at,'page'));
}
function bandSettings(item:Outline){
  const at=item.ref,band=item.band!;
  const get=(length?:Length)=>String(length?length.value*(length.unit==='mm'?72/25.4:1):0);
  ask('ตำแหน่งหัว–ท้ายกระดาษ',[{key:'left',label:'จากซ้าย (pt)',value:get(band.placement?.left)},
    {key:'right',label:'จากขวา (pt)',value:get(band.placement?.right)},{key:'offset',label:'จากขอบกระดาษ (pt)',value:get(band.placement?.offset)},
    {key:'height',label:'ความสูง (pt)',value:band.sizing?.height?get(band.sizing.height):'40'},{key:'gap',label:'ระยะถึงเนื้อหา (pt)',value:get(band.gap)}],
    values=>{
      const pt=(key:string)=>{const value=Number(values[key]);if(!Number.isFinite(value)||value<0||value>420)throw Error('ตรวจระยะ 0–420 pt');return {value,unit:'pt'};};
      stageDefinition(applyPart(draft.definition,at,'band',{...band,
        placement:{mode:'page',left:pt('left'),right:pt('right'),offset:pt('offset')},
        sizing:{mode:'fixed',height:pt('height')},gap:pt('gap')}),at,'band-settings');
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
  if(isSaving||hasConflict)return;
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
function showLayoutFacts(item:Outline,spacing?:'before'|'after'){
  const panel=q('layout-facts'),summary=q('paper-layout-summary'),actions=q('paper-layout-actions');
  actions.replaceChildren();
  panel.replaceChildren();summary.textContent='';summary.hidden=true;
  const note=(label:string,value:string)=>{
    const block=element('div');block.className='layout-fact';
    block.append(element('strong',label),element('p',value));panel.append(block);
    if(summary.hidden&&item.type!=='section'){summary.textContent=label+' · '+value;summary.hidden=false;}
  };
  const navigate=(label:string,target:Outline)=>panel.append(button(label,()=>select(target,true)));
  const edit=(label:string,run:()=>void)=>{
    const control=button(label,run);control.disabled=isSaving||hasConflict;actions.append(control);return control;
  };
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
  path.hidden=!ancestors.length;path.scrollLeft=path.scrollWidth;
  const selected=q('paper-selection');
  const type=itemType(item);
  selected.replaceChildren(element('span',type));
  if(item.label!==type)selected.append(document.createTextNode(item.label));
  selected.title=outlinePath(item);

  const ordered=item.inline&&item.parent?item.parent:item;
  const state=structureOrder(draft.definition,ordered.ref);
  if(state?.ids.length===1&&state.up==='ถึงขอบเขตที่ย้ายได้แล้ว')return;
  if(!state){
    if(item.type==='format')order.append(element('p','Format เป็นรูปแบบที่เลือกใช้ใน Area จัดลำดับองค์ประกอบภายใน Format ได้'));
    return;
  }
  const peers=ordered.parent?.children??roots;
  const label=(index:number)=>{
    const peer=peers.find(candidate=>candidate.id===state.ids[index]);
    return peer?(index+1)+'. '+peer.label:undefined;
  };
  const previous=label(state.index-1),next=label(state.index+1);
  const position=(ordered===item?'ลำดับ':('ลำดับ'+itemType(ordered)))+' '+(state.index+1)+' จาก '+state.ids.length;
  order.append(element('strong',position));
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
  order.append(controls);
  if(state.up&&state.down){
    const reason=state.ids.length===1&&state.up==='ถึงขอบเขตที่ย้ายได้แล้ว'?'มีรายการเดียวในตำแหน่งนี้':state.up;
    order.append(element('p',reason));
  }
}
function showActions(item:Outline){
  const actions=q('actions'),paperActions=q('paper-actions');
  actions.replaceChildren();paperActions.replaceChildren();
  showPaperLocation(item);
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
  };
  function finish(){
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
    add('ตำแหน่งและระยะ',()=>bandSettings(item));
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
  if(creationMode()){
    const part=(key:Part,label:string)=>add(label,()=>editPart(at,key,label));
    if(item.type==='section'){part('globalSchema','ตัวแปรทั้งเอกสาร');part('section-schema','ตัวแปรของ Section');part('styles','สไตล์เอกสาร');part('section-settings','กฎของ Section');}
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
  if(item.inline?.type!=='text'||isSaving||hasConflict)return;
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
let paperZoom=100;
function zoomPaper(delta:number){
  paperZoom=Math.max(100,Math.min(175,paperZoom+delta));
  paper.style.setProperty('--paper-zoom',String(paperZoom/100));
  q('paper-zoom').textContent=paperZoom+'%';
  q<HTMLButtonElement>('zoom-out').disabled=paperZoom===100;
  q<HTMLButtonElement>('zoom-in').disabled=paperZoom===175;
  closeInlineEditor();
}
q('zoom-in').addEventListener('click',()=>zoomPaper(25));
q('zoom-out').addEventListener('click',()=>zoomPaper(-25));
function updateStructureSequenceControl(){
  q('show-structure-sequence').setAttribute('aria-pressed',String(continuousStructure));
  q('structure-sequence-note').hidden=!continuousStructure;
}
function toggleStructureSequence(){
  if(!draft)return;
  continuousStructure=!continuousStructure;
  updateStructureSequenceControl();
  const url=new URL(location.href);
  if(continuousStructure)url.searchParams.set('structureView','continuous');
  else url.searchParams.delete('structureView');
  window.history.replaceState(null,'',url);
  closeInlineEditor();
  sectionSheets.clear();paperNodes.clear();
  paper.replaceChildren(...roots.map(root=>{
    const sheet=drawSectionPaper(root,root.section===selection?.section?selection.format:undefined);
    sectionSheets.set(root,sheet);return sheet;
  }));
  select(selection??roots[0],true);
}
updateStructureSequenceControl();
q('show-structure-sequence').addEventListener('click',toggleStructureSequence);
q('exit-structure-sequence').addEventListener('click',toggleStructureSequence);
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
  if(!isDirty()||isSaving||hasConflict)return;
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
  disposePreviewWorker();
  pendingPreview?.abort();pendingPreview=undefined;
  clearEditingPages();renderedTrial=undefined;closePaperEdit();
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
    showDraft(data);
    const fromCard=Number(sessionStorage.getItem('flowdoc:open:'+templateId));
    sessionStorage.removeItem('flowdoc:open:'+templateId);
    afterPaint('flowdoc:open-definition',started,{revision:data.revision});
    const offset=fromCard-performance.timeOrigin;
    if(fromCard&&offset<=started&&started-offset<20000)afterPaint('flowdoc:open-from-library',offset<0?0:offset,{revision:data.revision,navigationMs:offset<0?-offset:0});
    if(showingPreview)openPreview();
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
const assetUrl=(id:string,run?:string)=>endpoint+(run?'/preview-runs/'+encodeURIComponent(run)+'/assets/':'/preview-assets/')+encodeURIComponent(id);
async function readyImages(page:DrawPage,run?:string){
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
  return surface;
}
const trialPaperValue=q<HTMLTextAreaElement>('trial-paper-value');
const paperMarkers=q('trial-paper-markers');
let trialForm:ReturnType<typeof mountTrial>|undefined;
let paperInteractionBlocked=false;
let renderedTrial:Trial|undefined;
let editingPages:{revision:number;trial:Trial;indexes:Set<number>}|undefined;
function clearEditingPages(){
  editingPages=undefined;
  delete previewPaper.dataset.editingRun;
}
type PaperEdit={key:string;occurrence:string;pageIndex:number;lineStart?:number;composing:boolean;previous?:TrialTab;next?:TrialTab};
type PaperHit={element:SVGElement;edit:PreviewEdit;pageIndex:number;width:number;left:number;stops:[number,number][]};
let paperEdit:PaperEdit|undefined,paperPositionFrame=0;
let paperDrag:{pointer:number;owner:PaperEdit;anchor:number}|undefined;
const trialHits=new WeakMap<Element,PaperHit>();
function paperOffsets(key:string,input:string,index=paperEdit?.pageIndex){
  let value:unknown=index!==undefined&&editingPages?.indexes.has(index)?editingPages.trial:renderedTrial;
  for(const part of JSON.parse(key) as (string|number)[]){
    value=value&&typeof value==='object'&&Object.hasOwn(value,part)?(value as Record<string|number,unknown>)[part]:undefined;
  }
  return paperOffsetMap(typeof value==='string'?value.replace(/\r\n?/g,'\n'):input,input);
}
function editingLines(occurrence:string){
  const selector='[data-trial-occurrence='+CSS.escape(occurrence)+']';
  return [...mountedPages].sort((a,b)=>a-b).flatMap(index=>
    [...pageSlots[index].querySelectorAll(selector)].map(hit=>trialHits.get(hit)!));
}
function caretLine(lines:PaperHit[],offset:number,index:number,lineStart?:number){
  const contains=(hit:PaperHit)=>hit.edit.start<=offset&&offset<=hit.edit.end;
  return lines.find(hit=>hit.pageIndex===index&&hit.edit.start===lineStart&&contains(hit))
    ??lines.find(hit=>hit.pageIndex===index&&contains(hit))??lines.find(contains)??lines.find(hit=>hit.edit.start>offset)??lines.at(-1);
}
function caretX(hit:PaperHit,offset:number){
  let point=hit.stops[0][0];
  for(const [x,start] of hit.stops){
    if(start>offset)break;
    point=x;
  }
  return Math.max(0,Math.min(hit.width,hit.left+point));
}
function pointOffset(hit:PaperHit,x:number){
  for(const [index,[left,offset]] of hit.stops.entries()){
    const right=hit.stops[index+1]?.[0];
    if(right===undefined||x<hit.left+(left+right)/2)return offset;
  }
  return hit.edit.end;
}
function hitOffset(hit:PaperHit,clientX:number){
  const bounds=hit.element.getBoundingClientRect();
  return pointOffset(hit,(clientX-bounds.left)*hit.width/bounds.width);
}
function positionPaperEditor(){
  delete paperMarkers.dataset.pageIndex;
  if(!showingPreview||!paperEdit){paperMarkers.replaceChildren();return;}
  const lines=editingLines(paperEdit.occurrence),offsets=paperOffsets(paperEdit.key,trialPaperValue.value);
  const start=offsets.toPaper(trialPaperValue.selectionStart),end=offsets.toPaper(trialPaperValue.selectionEnd);
  const cursor=trialPaperValue.selectionDirection==='backward'?start:end;
  const caret=caretLine(lines,cursor,paperEdit.pageIndex,paperEdit.lineStart);
  if(!caret){paperMarkers.replaceChildren();return;}
  paperMarkers.dataset.pageIndex=String(caret.pageIndex);
  paperEdit.pageIndex=caret.pageIndex;paperEdit.lineStart=caret.edit.start;
  paperEdit.previous=caret.edit.previous;paperEdit.next=caret.edit.next;
  const marks=document.createDocumentFragment();
  function mark(hit:PaperHit,from:number,to?:number){
    const bounds=hit.element.getBoundingClientRect();
    const scale=bounds.width/hit.width;
    const x=caretX(hit,from),left=bounds.left+x*scale;
    if(to===undefined){
      trialPaperValue.style.left=left+'px';
      trialPaperValue.style.top=Math.max(0,Math.min(innerHeight-1,bounds.top))+'px';
    }
    if(bounds.bottom<=0||bounds.top>=innerHeight)return;
    const span=element('span');
    Object.assign(span.style,{left:left+'px',top:bounds.top+'px',height:bounds.height+'px'});
    if(to===undefined)span.className='paper-caret';
    else span.style.width=(caretX(hit,to)-x)*scale+'px';
    marks.append(span);
  }
  if(start!==end)for(const hit of lines){
    if(hit.edit.end>start&&hit.edit.start<end)mark(hit,Math.max(start,hit.edit.start),Math.min(end,hit.edit.end));
  }
  mark(caret,cursor);
  paperMarkers.replaceChildren(marks);
}
function schedulePaperPosition(){
  if(!paperEdit||paperPositionFrame)return;
  paperPositionFrame=requestAnimationFrame(()=>{paperPositionFrame=0;positionPaperEditor();});
}
function beginPaperEdit(edit:PreviewEdit,offset:number,index:number){
  if(paperInteractionBlocked)return;
  const value=trialForm?.read(edit.key);
  if(value===undefined)return;
  paperEdit={key:edit.key,occurrence:edit.occurrence,pageIndex:index,lineStart:edit.start,composing:false,previous:edit.previous,next:edit.next};
  if(trialPaperValue.value!==value)trialPaperValue.value=value;
  trialForm?.reveal(edit.key);
  trialPaperValue.hidden=false;
  offset=paperOffsets(edit.key,value,index).toInput(offset);
  trialPaperValue.setSelectionRange(offset,offset);
  positionPaperEditor();
  trialPaperValue.focus({preventScroll:true});
}
function closePaperEdit(){
  paperEdit=undefined;paperDrag=undefined;trialPaperValue.hidden=true;positionPaperEditor();
}
function syncPaperEdit(composing:boolean){
  if(!paperEdit)return;
  const active=paperEdit,{key,occurrence}=active,value=trialPaperValue.value;
  const fallback={key,occurrence,pageIndex:active.pageIndex,offset:trialPaperValue.selectionStart};
  const readFocus=()=>paperEdit===active?{...fallback,pageIndex:active.pageIndex,offset:trialPaperValue.selectionStart}:fallback;
  trialForm?.write(key,value,readFocus,composing);
  schedulePaperPosition();
  if(!previewStatus.textContent?.startsWith('กำลังจัดหน้า'))previewStatus.textContent='กำลังจัดหน้าตามข้อความที่พิมพ์…';
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
  const edit=hit&&trialHits.get(hit)?.edit;
  if(edit){
    hit.scrollIntoView({block:'nearest',inline:'nearest'});
    beginPaperEdit(edit,edit.start,stop.pageIndex);
    reportPage(stop.pageIndex);
  }
}
function selectPaperRange(anchor:number,offset:number){
  trialPaperValue.setSelectionRange(Math.min(anchor,offset),Math.max(anchor,offset),offset<anchor?'backward':'forward');
  positionPaperEditor();
}
trialPaperValue.addEventListener('keydown',event=>{
  if(!paperEdit||paperEdit.composing||event.isComposing)return;
  if(event.key==='Escape'){event.preventDefault();closePaperEdit();return;}
  if(event.key==='Tab'){
    const stop=event.shiftKey?paperEdit.previous:paperEdit.next;
    if(stop){event.preventDefault();void tabOnPaper(stop);}
  }
  if(event.ctrlKey||event.metaKey||event.altKey||!['ArrowUp','ArrowDown','Home','End'].includes(event.key))return;
  event.preventDefault();
  const lines=editingLines(paperEdit.occurrence),offsets=paperOffsets(paperEdit.key,trialPaperValue.value);
  const {selectionStart:start,selectionEnd:end,selectionDirection:direction}=trialPaperValue;
  const offset=offsets.toPaper(direction==='backward'?start:end),line=caretLine(lines,offset,paperEdit.pageIndex,paperEdit.lineStart);
  if(!line)return;
  const adjacent=lines[lines.indexOf(line)+(event.key==='ArrowUp'?-1:1)];
  const next=event.key==='Home'?line.edit.start:event.key==='End'?line.edit.end:
    adjacent?pointOffset(adjacent,caretX(line,offset)):offset;
  if(adjacent&&(event.key==='ArrowUp'||event.key==='ArrowDown')){
    paperEdit.pageIndex=adjacent.pageIndex;paperEdit.lineStart=adjacent.edit.start;
  }
  const input=offsets.toInput(next);
  selectPaperRange(event.shiftKey?(direction==='backward'?end:start):input,input);
});
trialPaperValue.addEventListener('blur',closePaperEdit);
trialPaperValue.addEventListener('select',schedulePaperPosition);
document.addEventListener('selectionchange',schedulePaperPosition);
window.addEventListener('resize',schedulePaperPosition);
window.addEventListener('scroll',schedulePaperPosition,true);
window.addEventListener('pointermove',event=>{
  if(!paperDrag||event.pointerId!==paperDrag.pointer||paperEdit!==paperDrag.owner)return;
  const element=document.elementFromPoint(event.clientX,event.clientY),hit=element&&trialHits.get(element);
  if(hit?.edit.occurrence!==paperEdit.occurrence)return;
  paperEdit.pageIndex=hit.pageIndex;paperEdit.lineStart=hit.edit.start;
  const offset=paperOffsets(paperEdit.key,trialPaperValue.value).toInput(hitOffset(hit,event.clientX));
  selectPaperRange(paperDrag.anchor,offset);
});
function endPaperDrag(event:PointerEvent){
  if(paperDrag?.pointer===event.pointerId)paperDrag=undefined;
}
window.addEventListener('pointerup',endPaperDrag);
window.addEventListener('pointercancel',endPaperDrag);
function showPage(page:DrawPage,index:number) {
  if(!preview)return;
  const sheet=svg('svg',{viewBox:'0 0 '+page.widthPt+' '+page.heightPt,role:preview.previewId?'group':'img','aria-label':'กระดาษ Engine หน้า '+(index+1)});
  const surface=canvasPreview&&preview.previewId?canvasSurface(page,pageSlots[index].clientWidth||previewPaper.clientWidth,sheet):undefined;
  if(surface){
    for(const line of page.lines)sheet.append(svg('g',{role:'img','aria-label':line.text}));
  }else{
    sheet.append(svg('rect',{width:page.widthPt,height:page.heightPt,fill:color(page.backgroundColor)}));
    for(const f of page.fills??[])sheet.append(svg('rect',{x:f.xPt,y:f.yPt,width:f.widthPt,height:f.heightPt,fill:color(f.color)}));
    paintBorders(sheet,page);
    for(const line of page.lines){
      if(line.glyphUses){
        const run=svg('g',{fill:color(line.color),'aria-label':line.text});
        for(const [glyph,x,y] of line.glyphUses)
          run.append(svg('use',{href:'#p'+index+'-'+glyph,transform:'translate('+x+' '+y+') scale('+line.scale+' -'+line.scale+')'}));
        sheet.append(run);
      }else{
        const text=svg('text',{x:line.xPt,y:line.yPt+line.baselineOffsetPt,fill:color(line.color),
          'font-size':line.fontSizePt,'font-weight':line.weight??400,'xml:space':'preserve'});
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
      if(image.resourceId)sheet.append(svg('image',{...bounds,href:assetUrl(image.resourceId,preview.previewId),preserveAspectRatio:'none'}));
      else if(image.color)sheet.append(svg('rect',{...bounds,fill:color(image.color)}));
    }
  }
  mountTrialHits(sheet,page,index);
  pageSlots[index]?.replaceChildren(surface??sheet);
  mountedPages.add(index);
  schedulePaperPosition();
}
function mountTrialHits(sheet:SVGElement,page:DrawPage,index:number){
  sheet.querySelector('.trial-hit-layer')?.remove();
  const hits=svg('g',{class:'trial-hit-layer'});
  for(const line of page.lines){
    const edit=line.edit;
    if(!edit||trialForm?.read(edit.key)===undefined)continue;
    const width=Math.max(edit.contentWidth??(edit.blank?80:line.widthPt),1);
    const left=edit.align==='right'?width-line.widthPt:edit.align==='center'?(width-line.widthPt)/2:0;
    const hit=svg('rect',{x:line.xPt-left,y:line.yPt,width,
      height:line.heightPt,fill:'transparent',tabindex:0,role:'button','aria-label':edit.blank?'พิมพ์ค่า '+JSON.parse(edit.key).at(-1):'แก้ค่า '+line.text});
    if(edit.blank)hit.classList.add('trial-field-blank');
    const record:PaperHit={element:hit,edit,pageIndex:index,width,left,stops:paperCaretStops(edit,line.widthPt) as [number,number][]};
    hit.classList.add('trial-field-hit');trialHits.set(hit,record);
    hit.dataset.trialKey=edit.key;hit.dataset.trialOccurrence=edit.occurrence;hit.dataset.start=String(edit.start);hit.dataset.end=String(edit.end);
    hit.addEventListener('pointerdown',event=>{
      if(event.pointerType!=='mouse'||event.button!==0||paperInteractionBlocked)return;
      event.preventDefault();
      beginPaperEdit(edit,hitOffset(record,event.clientX),index);
      if(paperEdit?.occurrence===edit.occurrence)paperDrag={pointer:event.pointerId,owner:paperEdit,anchor:trialPaperValue.selectionStart};
    });
    hit.addEventListener('click',event=>{
      const pointer=event as PointerEvent;
      if(pointer.pointerType!=='mouse')beginPaperEdit(edit,hitOffset(record,pointer.clientX),index);
    });
    hit.addEventListener('keydown',event=>{
      const key=(event as KeyboardEvent).key;
      if(key==='Enter'||key===' '){event.preventDefault();beginPaperEdit(edit,edit.start,index);}
    });
    hits.append(hit);
  }
  sheet.append(hits);
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
  schedulePaperPosition();
  return true;
}
function retainPage(index:number){
  if(editingPages?.indexes.has(index))return;
  const sheet=pageSlots[index].firstElementChild;
  if(!sheet)return;
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
    try{
      let page=result.paged?(index===(result.pageIndex??0)?result.pages[0]:undefined):result.pages[index];
      if(!page){
        if(result.renderPath==='browser-wasm'){
          const local=await workerPage(result.previewId!,index);
          page=local.page;
          if(result.pageKeys)result.pageKeys[index]=local.key;
        }
        else{
          const route=result.previewId?'/preview-runs/'+encodeURIComponent(result.previewId)+'/pages/'+index:'/preview-pages/'+result.revision+'/'+index;
          const response=await fetch(endpoint+route,{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(15000)])});
          const data=await response.json();
          if(!response.ok||data.revision!==result.revision||data.index!==index||!data.page)throw Error('Page unavailable');
          page=data.page as DrawPage;
        }
      }
      await readyImages(page,result.previewId);
      if(preview!==result||controller.signal.aborted||!showingPreview)return false;
      if(editingPages?.indexes.has(index))return true;
      showPage(page,index);
      return true;
    }catch{
      if(!controller.signal.aborted&&preview===result&&!editingPages?.indexes.has(index)){
        nearbyPages.delete(index);
        const retry=button('ลองเปิดหน้า '+(index+1)+' อีกครั้ง',()=>{slot.replaceChildren();void ensurePage(index);});
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
  const edited=editingPages?.indexes;
  clearEditingPages();
  stopPageLoads();
  pendingPage=new AbortController();
  preview=result;paperInteractionBlocked=false;
  const start=result.pageIndex??0,selected=focusPage??start;
  const initial=result.pages[0];
  const ready=new Map([[start,initial],...(result.priorityPages??[])]);
  const confirmed=new Set(result.confirmedPages);
  const reusable=(index:number)=>{
    const key=result.pageKeys?.[index];
    return edited?.has(index)?confirmed.has(index):
      Boolean(key&&key===prior?.pageKeys?.[index]&&prior?.fingerprint===result.fingerprint);
  };
  for(const index of retainedPages.keys())if(edited?.has(index)||!reusable(index))removeRetainedPage(index);
  for(const index of mountedPages){
    if(reusable(index)){
      if(edited?.has(index))mountTrialHits(pageSlots[index].querySelector('svg')!,ready.get(index)!,index);
      continue;
    }
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
  for(const [index,page] of result.priorityPages??[])
    if((edited?.has(index)||index===selected)&&!mountedPages.has(index))showPage(page,index);
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
      prunePages();pumpPages();
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
window.addEventListener('scroll',()=>{
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
},{passive:true});

let previewWorker:Worker|undefined,workerSequence=0,paintedWorkerRevision=0;
const workerLayouts=new Map<number,{trial:Trial;current:()=>boolean;usable:()=>boolean;started:number}>();
type WorkerPage={page:DrawPage;key:string};
const workerPages=new Map<number,{resolve:(result:WorkerPage)=>void;reject:(error:Error)=>void}>();
function disposePreviewWorker(){
  previewWorker?.terminate();previewWorker=undefined;
  workerLayouts.clear();
  for(const {reject} of workerPages.values())reject(Error('Preview closed'));
  workerPages.clear();
}
function getPreviewWorker(){
  if(previewWorker)return previewWorker;
  const worker=new Worker(new URL('./preview-layout-worker.mjs',import.meta.url),{type:'module'});
  previewWorker=worker;
  worker.onerror=()=>{
    if(previewWorker!==worker)return;
    disposePreviewWorker();
    previewStatus.textContent='เปิด Engine บนเบราว์เซอร์ไม่สำเร็จ';
  };
  worker.onmessage=({data})=>{
    if(previewWorker!==worker)return;
    if(data.kind==='page'){
      const task=workerPages.get(data.id);
      workerPages.delete(data.id);
      if(data.error)task?.reject(Error(data.error));
      else task?.resolve({page:data.page,key:data.key});
      return;
    }
    const task=workerLayouts.get(data.revision);
    if(data.kind==='editing-pages'){
      const focus=task?.trial.focus;
      if(!preview||!showingPreview||paperInteractionBlocked||!task?.usable()||!paperEdit||!focus||
        focus.occurrence!==paperEdit.occurrence||data.revision<=paintedWorkerRevision||
        data.revision<=(editingPages?.revision??0))return;
      const pages=data.pages as [number,DrawPage][];
      if(!pages.length||!pages.every(([index])=>pageSlots[index]))return;
      const before=paperEdit.pageIndex;
      paperEdit.pageIndex=data.focusPage;
      if(before!==paperEdit.pageIndex)pageSlots[paperEdit.pageIndex]?.parentElement?.scrollIntoView({block:'start'});
      const visible=pages.filter(([index])=>{
        if(index===data.focusPage)return true;
        const bounds=pageSlots[index].getBoundingClientRect();
        return bounds.bottom>0&&bounds.top<innerHeight;
      });
      editingPages={revision:data.revision,trial:task.trial,indexes:new Set(visible.map(([index])=>index))};
      for(const [index,page] of visible)showPage(page,index);
      reportPage(paperEdit.pageIndex);
      positionPaperEditor();
      previewPaper.dataset.editingRun='worker-'+data.revision;
      return;
    }
    workerLayouts.delete(data.revision);
    if(data.kind!=='layout'||!task?.usable()||!showingPreview||data.revision<=paintedWorkerRevision)return;
    if(data.error){
      if(editingPages&&editingPages.revision===data.revision){
        const {indexes}=editingPages;
        clearEditingPages();
        for(const index of indexes){
          pageSlots[index]?.replaceChildren();mountedPages.delete(index);
          void ensurePage(index);
        }
      }
      if(task.current())previewStatus.textContent='จัดหน้าในเบราว์เซอร์ไม่สำเร็จ · '+data.error;
      return;
    }
    const result=data.preview as Preview;
    if(result.revision!==draft.revision||result.fingerprint!==draft.fingerprint)return;
    paintedWorkerRevision=data.revision;
    const desired=task.trial.focus?.occurrence!==paperEdit?.occurrence?Math.min(pageIndex,result.pageCount-1):undefined;
    renderedTrial=task.trial;
    mountPreview(result,desired);
    previewStatus.textContent=task.current()?'Core WASM · '+result.pageCount+' หน้า':
      'แสดงผลจัดหน้าล่าสุดในเบราว์เซอร์ · กำลังจัดหน้าต่อ…';
    afterPaint('flowdoc:engine-preview',task.started,{revision:result.revision,inputRevision:data.revision,
      pageCount:result.pageCount,engineMs:result.engineMs,renderMs:result.renderMs,renderPath:result.renderPath});
  };
  worker.postMessage({kind:'open',draft});
  return worker;
}
function workerPage(run:string,index:number){
  if(!previewWorker)return Promise.reject(Error('Browser Engine unavailable'));
  const id=++workerSequence;
  return new Promise<WorkerPage>((resolve,reject)=>{
    workerPages.set(id,{resolve,reject});
    previewWorker!.postMessage({kind:'page',id,run,index});
  });
}
function queueWorkerPreview(trial:Trial,current:()=>boolean,usable:()=>boolean){
  const worker=getPreviewWorker(),revision=++workerSequence;
  workerLayouts.set(revision,{trial,current,usable,started:performance.now()});
  worker.postMessage({kind:'layout',revision,trial});
}
async function loadPreview(trial?:Trial,current=()=>true,usable=current,structure=0,fields?:ReadonlyMap<string,HTMLTextAreaElement>) {
  if(!draft||pendingPreview||!showingPreview||isDirty())return;
  const started=performance.now(), revision=draft.revision, fingerprint=draft.fingerprint;
  const request=new AbortController();pendingPreview=request;
  refreshPreview.disabled=true;
  previewStatus.textContent='กำลังจัดหน้า Revision '+revision+'…';
  try{
    const signal=AbortSignal.any([request.signal,AbortSignal.timeout(120000)]);
    const post=(input:object)=>fetch(endpoint+'/preview',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({expectedRevision:revision,...(trial&&resumablePreview?{layoutMode:'resume'}:{}),...input}),signal});
    const full=trial?{trial}:benchmark?{sample:'benchmark'}:{};
    const base=trialBase;
    const changes=!fullTrialTransport&&trial&&base&&fields&&base.structure===structure
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
      if(pendingPreview===request&&current())previewStatus.textContent=response.status===429?'Engine กำลังจัดหน้าอีกชุด ลองใหม่เมื่อพร้อม':
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
    renderedTrial=trial;
    trialBase=trial&&data.trialPatchBase&&data.previewId?{previewId:data.previewId,trial,structure}:undefined;
    mountPreview(data,desired);
    if(pendingPreview!==request)return;
    previewStatus.textContent=current()?'Core '+data.engineVersion+' · Revision '+revision+' · '+data.pageCount+' หน้า':
      'แสดงผลจัดหน้าล่าสุดระหว่างพิมพ์ · กำลังจัดหน้าต่อ…';
    afterPaint('flowdoc:engine-preview',started,{revision,pageCount:data.pageCount,engineMs:data.engineMs,renderMs:data.renderMs,layoutHash:data.layoutHash,renderPath:data.renderPath});
  }catch{
    if(!request.signal.aborted&&current())previewStatus.textContent='จัดหน้าทดลองไม่สำเร็จ ลองจัดหน้าใหม่อีกครั้ง';
  }finally{
    if(pendingPreview===request){pendingPreview=undefined;refreshPreview.disabled=false;}
  }
}
let trialVersion='';
function openPreview(){
  const custom=!benchmark;
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
  if(trialVersion===version){if(!preview&&!pendingPreview)trialForm?.refresh();return;}
  trialVersion=version;trialBase=undefined;
  trialForm?.dispose();renderedTrial=undefined;closePaperEdit();
  previewStatus.textContent='กำลังเปิดกระดาษจากโครง · Revision '+draft.revision;
  const starter=new Map([...activeFormats.values()].map(format=>[format.ownerAreaId,format.key]));
  trialForm=mountTrial(q<HTMLFormElement>('trial-form'),draft.definition,starter,structural=>{
    if(structural){
      disposePreviewWorker();
      paperInteractionBlocked=true;closePaperEdit();
    }
    previewStatus.textContent='กำลังอัปเดตข้อมูลทดลอง…';
  },(trial,current,usable,structure,fields)=>{
    if(trialVersion!==version||!showingPreview||isDirty())return Promise.resolve();
    if(browserPreview&&!trial.images.length){
      queueWorkerPreview({...trial,pageIndex},current,usable);
      return Promise.resolve();
    }
    disposePreviewWorker();
    return loadPreview({...trial,pageIndex},current,usable,structure,fields);
  });
}
function changeMode(toPreview: boolean) {
  showingPreview=toPreview;previewPanel.hidden=!toPreview;editor.hidden=toPreview;
  defineTab.setAttribute('aria-pressed',String(!toPreview));previewTab.setAttribute('aria-pressed',String(toPreview));
  if(toPreview){openPreview();positionPaperEditor();pumpPages();}
  if(!toPreview)closePaperEdit();
  if(!toPreview&&(pendingPreview||previewWorker)){
    cancelPreview();refreshPreview.disabled=false;
    if(!benchmark)previewStatus.textContent='กำลังรอเปิดกระดาษทดลอง';
  }
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
previewTab.addEventListener('click',()=>changeMode(true));
defineTab.addEventListener('click',()=>changeMode(false));
previous.addEventListener('click',()=>void goPage(pageIndex-1));
next.addEventListener('click',()=>void goPage(pageIndex+1));
jump.addEventListener('change',()=>{if(jump.checkValidity()&&jump.value)void goPage(Number(jump.value)-1);});
refreshPreview.addEventListener('click',()=>{cancelPreview();void loadPreview();});
function historyReplaceDraft(id:string){
  const url=new URL('/phase1-editor.html',location.href);
  url.searchParams.set('id',id);
  if(continuousStructure)url.searchParams.set('structureView','continuous');
  window.history.replaceState(null,'',url);
}
if(newMode&&!templateId){
  q('title').textContent='สร้างโครงเอกสาร';q('new-document').hidden=false;
  q<HTMLFormElement>('new-document-form').addEventListener('submit',event=>{
    event.preventDefault();
    try{
      const values=Object.fromEntries(new FormData(event.currentTarget as HTMLFormElement)) as Record<string,string>;
      const data=newDefinition(values);
      q('new-document').hidden=true;showDraft(data);
    }catch(error){q('new-document-error').textContent=error instanceof Error?error.message:'ตั้งกระดาษไม่สำเร็จ';}
  });
}else void load();
