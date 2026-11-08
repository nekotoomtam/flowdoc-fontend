import './phase1-editor.css';
import {addBand,addVariable,applyPart,changePage,newDefinition,partValue,settings} from './editor-creation';
import type {Part} from './editor-creation';
import {openVisualAuthoring} from './editor-visual-authoring';

import {applyStructureChange, canAddPlainRows, groupSources, refKey, structureOrder} from './editor-structure';
import type {Band, Change, Definition, DocNode, Format, Fragment, Host, Inline, Length, Ref, Schema, Section} from './editor-structure';

type Draft = {templateId:string;docKey?:string;name:string;revision:number;fingerprint:string;definition:Definition};
type Outline = {id:string;ref:Ref;label:string;type:string;section:Section;format?:Format;children:Outline[];parent?:Outline;node?:DocNode;band?:Band;inline?:Inline;detail?:string};
type DrawPage = {
  widthPt: number; heightPt: number; backgroundColor: string;
  sampleImages?: {xPt:number; yPt:number; widthPt:number; heightPt:number; color?:string; resourceId?:string}[];
  glyphs?:Record<string,string>;
  fills?: {xPt: number; yPt: number; widthPt: number; heightPt: number; color: string}[];
  borders?: {x1Pt: number; y1Pt: number; x2Pt: number; y2Pt: number; widthPt: number; color: string; style?:string}[];
  lines: {text: string; xPt: number; yPt: number; fontSizePt: number; baselineOffsetPt: number; color: string; weight?: number; scale?:number; glyphUses?:[string,number,number][]}[];
};
type Preview = {revision: number; fingerprint: string; engineVersion: string; engineMs: number; renderMs: number; layoutHash: string; pdfHash: string; pageCount: number; pages: DrawPage[]; paged?:boolean; entryCount?:number; imagePlacements?:number};
type ServiceReply = {ok: boolean; value?: Draft; issues?: {code: string; path?:string}[]};
const q = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id)! as T;
const title = q('title'), status = q('status'), editor = q('editor'), tree = q('tree'), paper = q('paper'), variables = q('variables');
const form = q<HTMLFormElement>('rename'), input = q<HTMLInputElement>('section-name'), save = q<HTMLButtonElement>('save');
const defineTab = q<HTMLButtonElement>('define-tab'), previewTab = q<HTMLButtonElement>('preview-tab');
const conflict = q('conflict'), previewPanel = q('preview'), previewStatus = q('preview-status'), previewPaper = q('preview-paper');
const previous = q<HTMLButtonElement>('previous-page'), next = q<HTMLButtonElement>('next-page'), refreshPreview = q<HTMLButtonElement>('refresh-preview');
const jump=q<HTMLInputElement>('jump-page');
const benchmark=sessionStorage.getItem('flowdoc:benchmark-preview')==='1';
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
let draft: Draft, selection: Outline | undefined, paperSection: Section | undefined;
let paperFormat:Format|undefined;
const activeFormats=new Map<string,Format>();
let roots:Outline[] = [], outlines=new Map<string,Outline>();
const expanded=new Map<string,boolean>();
const history:{definition:Definition;selection:Ref}[]=[];
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
function drawPaper(root: Outline, preferred?: Format) {
  paperNodes.clear();
  const switcher=q('format-switcher');switcher.replaceChildren();
  const layout=draft.definition.pageLayouts?.[root.section.pageLayoutId??draft.definition.book.defaultPageLayoutId]?.page;
  const sizes:Record<string,[number,number]>={A4:[595.276,841.89],A3:[841.89,1190.551],Letter:[612,792],Legal:[612,1008]};
  const [short,long]=sizes[layout?.size??'A4']??sizes.A4;
  const [width,height]=layout?.orientation==='landscape'?[long,short]:[short,long];
  const points=(value?:Length)=>value?(value.unit==='mm'?value.value*72/25.4:value.value):0;
  const unit=(n:number)=>'calc('+n+' * var(--sheet-pt))';
  const length=(value?:Length)=>value?unit(points(value)):'';
  const hex=(value?:string)=>value&&/^[0-9a-f]{6}$/i.test(value)?'#'+value:'';
  const choose=(item:Outline,label=item.label,className='definition-control')=>{
    const control=button(label,()=>select(item,false));control.className=className;
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
      block.append(choose(item),...item.children.map(contents));
    }else if(item.type==='table'){
      const table=element('table'), body=element('tbody'), columns=element('colgroup');
      const widths=(item.node?.columns??[]).map(column=>points(column.width));
      const total=widths.reduce((sum,width)=>sum+width,0);
      for(const width of widths){
        const col=element('col');if(total)col.style.width=(width/total*100)+'%';columns.append(col);
      }
      if(total)table.style.width='min(100%, '+unit(total)+')';
      block.append(choose(item,'ตาราง'),table);table.append(columns,body);
      const metadata=item.children.filter(child=>child.type!=='table-row');
      if(metadata.length){const controls=element('div');controls.className='definition-meta';
        controls.append(...metadata.map(item=>choose(item,item.label,'definition-marker')));block.append(controls);}
      for(const [index,row] of item.children.filter(child=>child.type==='table-row').entries()){
        const tr=element('tr');
        const rowButton=choose(row,row.label,'definition-marker definition-row');
        // Merged rows can have no authored cells of their own.
        if(!row.children.length)block.append(rowButton);
        for(const [cellIndex,cell] of row.children.entries()){
          const td=element('td'),cellProps=cell.node?.props;
          td.colSpan=cellProps?.colSpan??1;td.rowSpan=cellProps?.rowSpan??1;
          td.style.backgroundColor=hex(cellProps?.fillColor??(index<(props?.headerRowCount??0)?props?.headerFillColor:undefined));
          td.style.borderColor=hex(props?.borderColor);
          if(props?.borderWidth)td.style.borderWidth=length(props.borderWidth);
          for(const side of ['top','right','bottom','left'] as const){
            const padding=cellProps?.padding?.[side];
            if(padding)td.style.setProperty('padding-'+side,length(padding));
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
      rule.style.marginTop=length(props?.spaceBefore);rule.style.marginBottom=length(props?.spaceAfter);
      if(props?.align==='center')rule.style.marginInline='auto';
      if(props?.align==='right')rule.style.marginLeft='auto';
      block.append(rule);
    }else if(item.type==='columns'){
      const columns=element('div');columns.className='definition-columns';
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
  const sheet=element('div');sheet.className='definition-sheet';
  paper.style.setProperty('--sheet-pt','calc(100cqw / '+width+')');
  sheet.style.height=unit(height);
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
      view.style.left=length(layout?.left??margin.left)||'0';
      view.style.right=length(layout?.right??margin.right)||'0';
      view.style.setProperty(header?'top':'bottom',unit(offset));
      if(band.sizing?.height)view.style.minHeight=length(band.sizing.height);
      const reserve=offset+points(band.sizing?.height)+points(band.gap);
      if(header)top=Math.max(top,reserve);
      else bottom=Math.max(bottom,reserve);
      sheet.append(view);
    }else body.append(contents(item));
  }
  body.style.inset=unit(top)+' '+unit(points(margin.right))+' '+unit(bottom)+' '+unit(points(margin.left));
  sheet.prepend(body);
  const control=choose(root,root.label+' · '+sheet.dataset.pageSize,'definition-section-control');
  switcher.prepend(control);
  sheet.addEventListener('click',event=>{if(event.target===sheet||event.target===body)select(root,false);});
  paper.replaceChildren(sheet);
  paperSection=root.section;paperFormat=preferred;
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
function drawVariables(item:Outline){
  const scopes=variableScopes(item);
  const selectedRef=item.inline?.type==='field-ref'&&item.inline.scope&&item.inline.key
    ? {scope:item.inline.scope,key:item.inline.key}:item.node?.type==='image'?item.node.props?.source:undefined;
  const value=q('variable-detail');
  value.textContent='';
  const selectField=(control:HTMLButtonElement,label:string,key:string,type:string)=>{
    variables.querySelector('[aria-current=true]')?.removeAttribute('aria-current');
    control.setAttribute('aria-current','true');
    value.textContent=label+' › '+key+' · '+type;
  };
  function fieldList(schema:Schema,scope:string,label:string,base=''):HTMLUListElement {
    const list=element('ul');
    for(const [key,f] of Object.entries(schema.fields)){
      const path=base+key;
      const li=element('li'), field=button(key+' · '+f.type,()=>selectField(field,label,path,f.type));
      field.className='variable-field';
      field.dataset.variableScope=scope;field.dataset.variablePath=path;
      if(!base&&scope===selectedRef?.scope&&key===selectedRef.key){
        field.setAttribute('aria-current','true');
        value.textContent=label+' › '+path+' · '+f.type;
      }
      li.append(field);
      if(f.items)li.append(fieldList(f.items,scope,label,path+'[].'));
      list.append(li);
    }
    return list;
  }
  variables.replaceChildren(...scopes.map(({label,schema,scope})=>{
    const container=element('details');
    container.className='scope';
    container.open=true;
    container.append(element('summary',label));
    container.append(Object.keys(schema.fields).length?fieldList(schema,scope,label):element('p','ยังไม่มีตัวแปร'));
    if(creationMode()&&['global','section','local','header','footer'].includes(scope)){
      const add=button('+ ประกาศตัวแปร',()=>askVariable(item.ref,scope as 'global'|'section'|'local'|'header'|'footer',label));
      add.disabled=isSaving||hasConflict;container.append(add);
      const part:Part=scope==='global'?'globalSchema':scope==='section'?'section-schema':scope==='local'?'format-schema':'band-schema';
      const edit=button('แก้ไข / ลบตัวแปร',()=>editPart(item.ref,part,'ตัวแปร · '+label));
      edit.disabled=isSaving||hasConflict;container.append(edit);
    }
    return container;
  }));
}


function select(item: Outline, measure: boolean) {
  const started=performance.now();
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
  const preferred=item.format??(paperSection===item.section?paperFormat:undefined);
  const onCurrentPaper=paperSection===item.section&&paper.contains(paperNodes.get(item)??null);
  if(!onCurrentPaper&&(paperSection!==item.section||paperFormat!==preferred))drawPaper(root,preferred);
  else if(onCurrentPaper&&item.format)paperFormat=item.format;
  const treeTarget=treeNodes.get(item);
  treeTarget?.setAttribute('aria-current','true');
  if(!measure&&treeTarget)scrollWithin(tree,treeTarget);
  paperNodes.get(item)?.setAttribute('aria-current','true');
  q('selection').textContent=item.label;
  q('selection-detail').textContent=item.detail??(item.inline?.type==='text'?'แก้ข้อความนี้ได้บนกระดาษ':kinds[item.type]??item.type);
  const target=paperNodes.get(item);
  if(measure&&target&&paper.contains(target)){
    const body=target.closest<HTMLElement>('.definition-body');
    if(body)scrollWithin(body,target);
    scrollWithin(paper.parentElement!,target);
  }
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
  q<HTMLButtonElement>('save-structure').disabled=!dirty||isSaving||hasConflict;
  q<HTMLButtonElement>('undo-structure').disabled=isSaving||hasConflict||!history.length;
  q<HTMLButtonElement>('discard-structure').disabled=isSaving||hasConflict||!savedDefinition;
  q<HTMLButtonElement>('add-section').disabled=isSaving||hasConflict;
  previewTab.disabled=dirty||creationMode();
  save.disabled=dirty||isSaving||hasConflict||!templateId;
  input.readOnly=dirty||isSaving;
  if(selection)showActions(selection);
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
  select(selected,false);
  refreshButtons();
  editor.hidden=showingPreview;
  document.body.dataset.revision=String(data.revision);
}
const dialog=q<HTMLDialogElement>('structure-dialog'), actionForm=q<HTMLFormElement>('structure-form');
type FormField={key:string;label:string;options?:[string,string][];value?:string};
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
    add:element('details'),edit:element('details'),move:element('details'),
  };
  const labels={add:'+ เพิ่ม',edit:'แก้ไข',move:'ย้ายไปส่วนอื่น'};
  for(const key of ['add','edit','move'] as const){
    const menu=groups[key];
    const label=element('summary',labels[key]);
    const commands=element('div');commands.className='paper-command-list';
    menu.append(label,commands);paperActions.append(menu);
    menu.addEventListener('toggle',()=>{
      if(menu.open)for(const other of Object.values(groups))if(other!==menu)other.open=false;
    });
  }
  if(item.parent){
    const parent=item.parent;
    const up=button('เลือก '+itemType(parent),()=>select(parent,true));
    up.title='เลือกส่วนที่ครอบรายการนี้';paperActions.append(up);
  }
  if(creationMode()){
    const part:Part=item.ref.formatId?'format-schema':item.ref.band?'band-schema':'section-schema';
    const owner=item.format?.label??item.format?.key??(item.ref.band?(item.ref.band==='header'?'หัวกระดาษ':'ท้ายกระดาษ'):item.section.label);
    const control=button('นิยามตัวแปร',()=>editPart(item.ref,part,'ตัวแปร · '+owner));
    control.disabled=isSaving||hasConflict;paperActions.append(control);
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
    const empty={add:'เพิ่มรายการใหม่ในส่วนที่ครอบรายการนี้',edit:'เลือกรายการที่มีรายละเอียดให้แก้',move:''};
    for(const key of ['add','edit','move'] as const){
      const menu=groups[key],commands=menu.lastElementChild!;
      if(!commands.childElementCount){
        if(key==='move'){menu.hidden=true;continue;}
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
    },'move');
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
    for(const target of [paperActions,actions]){
      const control=button(target===actions?'ลบรายการนี้':label,remove);
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
q('show-handles').addEventListener('click',()=>{
  const control=q('show-handles'),show=control.getAttribute('aria-pressed')!=='true';
  control.setAttribute('aria-pressed',String(show));control.textContent=show?'ซ่อนจุดเลือก':'แสดงจุดเลือก';paper.classList.toggle('show-handles',show);
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
      hasConflict=true;conflict.hidden=false;status.textContent='มีฉบับใหม่กว่า · การแก้โครงในหน้านี้ยังอยู่';return;
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
  pendingPreview?.abort();pendingPreview=undefined;
  pendingPage?.abort();pendingPage=undefined;jump.disabled=true;
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
const assetUrl=(id:string)=>endpoint+'/preview-assets/'+encodeURIComponent(id);
async function readyImages(page:DrawPage){
  const urls=[...new Set((page.sampleImages??[]).flatMap(image=>image.resourceId?[assetUrl(image.resourceId)]:[]))];
  for(let i=0;i<urls.length;i+=4)await Promise.all(urls.slice(i,i+4).map(url=>{
    const asset=new Image();asset.src=url;return asset.decode();
  }));
}
function paintBorders(sheet:SVGElement,page:DrawPage){
  for(const b of page.borders??[]){
    const w=b.widthPt,style=b.style??'single';
    const dx=b.x2Pt-b.x1Pt,dy=b.y2Pt-b.y1Pt,length=Math.hypot(dx,dy);
    if(!length)continue;
    const paint=(weight:number,offset=0,dash?:string,cap?:string)=>{
      const x=-dy/length*offset,y=dx/length*offset;
      sheet.append(svg('line',{x1:b.x1Pt+x,y1:b.y1Pt+y,x2:b.x2Pt+x,y2:b.y2Pt+y,
        stroke:color(b.color),'stroke-width':weight,...(dash?{'stroke-dasharray':dash}:{}),...(cap?{'stroke-linecap':cap}:{})}));
    };
    const dash=(a:number,b:number)=>a*w+' '+b*w;
    if(style==='double'){paint(w,-w);paint(w,w);}
    else if(style==='thickThinWideGap'){paint(.6*w,-.2*w,dash(4,12));paint(.2*w,.4*w,dash(4,12));}
    else if(style==='dashed')paint(w,0,dash(3,2));
    else if(style==='dotted')paint(w,0,dash(0,2),'round');
    else if(style==='dashSmallGap')paint(.96*w,0,dash(3.2,1.6));
    else paint(w);
  }
}
function showPage(page:DrawPage) {
  if(!preview)return;
  const sheet=svg('svg',{viewBox:'0 0 '+page.widthPt+' '+page.heightPt,role:'img','aria-label':'กระดาษ Engine หน้า '+(pageIndex+1)});
  sheet.append(svg('rect',{width:page.widthPt,height:page.heightPt,fill:color(page.backgroundColor)}));
  for(const f of page.fills??[])sheet.append(svg('rect',{x:f.xPt,y:f.yPt,width:f.widthPt,height:f.heightPt,fill:color(f.color)}));
  paintBorders(sheet,page);
  for(const line of page.lines){
    if(line.glyphUses){
      const run=svg('g',{fill:color(line.color),'aria-label':line.text});
      for(const [glyph,x,y] of line.glyphUses)
        run.append(svg('use',{href:'#'+glyph,transform:'translate('+x+' '+y+') scale('+line.scale+' -'+line.scale+')'}));
      sheet.append(run);
    }else{
      const text=svg('text',{x:line.xPt,y:line.yPt+line.baselineOffsetPt,fill:color(line.color),
        'font-size':line.fontSizePt,'font-weight':line.weight??400,'xml:space':'preserve'});
      text.textContent=line.text;sheet.append(text);
    }
  }
  if(page.glyphs){
    const defs=svg('defs',{});
    for(const [id,path] of Object.entries(page.glyphs))defs.append(svg('path',{id,d:path}));
    sheet.prepend(defs);
  }
  for(const image of page.sampleImages??[]){
    const bounds={x:image.xPt,y:image.yPt,width:image.widthPt,height:image.heightPt};
    if(image.resourceId)sheet.append(svg('image',{...bounds,href:assetUrl(image.resourceId),preserveAspectRatio:'none'}));
    else if(image.color)sheet.append(svg('rect',{...bounds,fill:color(image.color)}));
  }
  previewPaper.replaceChildren(sheet);
  previewPaper.dataset.revision=String(preview.revision);
  q('page-number').textContent=(pageIndex+1)+' / '+preview.pageCount;
  jump.value=String(pageIndex+1);jump.max=String(preview.pageCount);jump.disabled=false;
  previous.disabled=pageIndex===0;next.disabled=pageIndex===preview.pageCount-1;
}
async function goPage(index:number){
  if(!preview||index<0||index>=preview.pageCount||index===pageIndex)return;
  const current=preview, revision=current.revision;
  pendingPage?.abort();
  const controller=new AbortController();pendingPage=controller;
  try{
    let page=current.pages[index];
    if(current.paged&&!page){
      const response=await fetch(endpoint+'/preview-pages/'+revision+'/'+index,
        {signal:AbortSignal.any([controller.signal,AbortSignal.timeout(15000)])});
      const data=await response.json();
      if(!response.ok||data.revision!==revision||data.index!==index||!data.page)throw Error('Page unavailable');
      page=data.page;
    }
    await readyImages(page);
    if(pendingPage!==controller||preview!==current||!showingPreview)return;
    pageIndex=index;showPage(page);
    previewStatus.textContent='Core '+current.engineVersion+' · Revision '+revision+' · '+current.pageCount+' หน้า';
  }catch{
    if(!controller.signal.aborted)previewStatus.textContent='เปิดหน้านี้ไม่ได้ ลองจัดหน้าใหม่';
  }finally{if(pendingPage===controller)pendingPage=undefined;}
}

async function loadPreview() {
  if(!draft||pendingPreview)return;
  const started=performance.now(), revision=draft.revision, fingerprint=draft.fingerprint;
  const request=new AbortController();pendingPreview=request;
  refreshPreview.disabled=true;
  previewStatus.textContent='กำลังจัดหน้า Revision '+revision+'…';
  try{
    const response=await fetch(endpoint+'/preview',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({expectedRevision:revision,...(benchmark?{sample:'benchmark'}:{})}),signal:AbortSignal.any([request.signal,AbortSignal.timeout(120000)])});
    if(response.status===409){previewStatus.textContent='ฉบับนี้มี revision ใหม่กว่าในระบบ กรุณาโหลดฉบับล่าสุด';return;}
    const data=await response.json() as Preview;
    if(!response.ok||!data.pages?.length||data.revision!==revision||data.fingerprint!==fingerprint)throw Error('Preview unavailable');
    if(benchmark)await Promise.all([document.fonts.load('300 12px FlowDocLab'),document.fonts.load('400 12px FlowDocLab')]);
    await readyImages(data.pages[0]);
    if(pendingPreview!==request||draft.revision!==revision||!showingPreview)return;
    preview=data;pageIndex=0;showPage(data.pages[0]);
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
  if(!toPreview){pendingPage?.abort();pendingPage=undefined;}
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
previous.addEventListener('click',()=>void goPage(pageIndex-1));
next.addEventListener('click',()=>void goPage(pageIndex+1));
jump.addEventListener('change',()=>{if(jump.checkValidity()&&jump.value)void goPage(Number(jump.value)-1);});
refreshPreview.addEventListener('click',()=>{cancelPreview();void loadPreview();});
function historyReplaceDraft(id:string){window.history.replaceState(null,'','/phase1-editor.html?id='+encodeURIComponent(id));}
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
