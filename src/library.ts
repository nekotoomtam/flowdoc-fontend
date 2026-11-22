import {confirmPublication} from './confirm-publication';
import './library.css';
import {openDraftReview} from './draft-review';
import {baselineCompare,paperView,type Paper} from './baseline-compare';
import {showPublishedApi} from './published-api';
import covers from './library-covers.json';

type TemplateSummary = {
  templateId: string;
  docKey: string;
  name: string;
  description: string | null;
  revision: number | null;
  updatedAt: string;
  readOnly?: boolean;
  libraryVersions?:{versions:number[];pinned:number|null;canCompare:boolean};
  publishedVersions?:number[];
  issuerVersion?:number|null;
  issuerBaseline?:{pinned:number|null;versions:number[]};
  relatedDrafts?:{id:string;source:number}[];
};

const search = document.querySelector<HTMLInputElement>('#search')!;
const refresh = document.querySelector<HTMLButtonElement>('#refresh')!;
const cards = document.querySelector('#cards')!;
const count = document.querySelector('#count')!;
const status = document.querySelector('#status')!;
const detail = document.querySelector<HTMLDialogElement>('#detail')!;
const date = new Intl.DateTimeFormat('th-TH', {dateStyle: 'medium'});
const paperIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true">
  <path d="M6 3h8l4 4v14H6z M14 3v5h4 M9 12h6m-6 4h6"/>
</svg>`;

const phase1 = new URLSearchParams(location.search).get('phase1') === '1';
if (phase1) {
  document.querySelector<HTMLAnchorElement>('.brand')!.href='/library.html?phase1=1';
  document.querySelector('.badge')!.textContent = 'Oracle Lab';
  document.querySelector('.hero p')!.textContent = 'เลือกแม่แบบเพื่อดูกระดาษและรุ่นที่เผยแพร่';
  const create = document.querySelector<HTMLButtonElement>('#create-draft')!;
  create.disabled=false;
  create.onclick=()=>location.assign('/phase1-editor.html?new=1');
}

let items: TemplateSummary[] = [];
let available = false;
let loading = false;

function text<K extends keyof HTMLElementTagNameMap>(tag: K, value: string, className = '') {
  const element = document.createElement(tag);
  element.textContent = value;
  element.className = className;
  return element;
}

function updatedAt(item: TemplateSummary) {
  const parsed = new Date(item.updatedAt);
  return Number.isNaN(parsed.getTime()) ? '' : date.format(parsed);
}

function accessLabel(item: TemplateSummary) {
  if (item.readOnly) return 'อ่านอย่างเดียว';
  return item.revision === null ? 'ยังไม่มีนิยามโครง' : 'ฉบับร่าง';
}

type Versions=NonNullable<TemplateSummary['libraryVersions']>;
const paperCache=new Map<string,Promise<Paper>>();
function firstPage(url:string,state:Versions,version:number){
  const key=[url,state.pinned,state.versions[0],version].join('/');
  let pending=paperCache.get(key);
  if(!pending){
    pending=fetch(url+'/compare-baseline',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({version,latest:state.versions[0],pinned:state.pinned,pageIndex:0,edits:{}})})
      .then(async response=>{if(!response.ok)throw Error();return (await response.json()).papers[1] as Paper;})
      .catch(error=>{paperCache.delete(key);throw error;});
    paperCache.set(key,pending);
  }
  return pending;
}
function button(label:string,onClick:()=>void){
  const action=text('button',label);action.type='button';action.onclick=onClick;return action;
}
function versionStatus(active:number,latest:number){
  return 'ระบบรับงานใช้รุ่น '+active+' · เผยแพร่ล่าสุด '+latest;
}
function versionChoice(version:number,active:number|null|undefined,latest:number,select:()=>void){
  const choice=button('รุ่น '+version,select);
  const flags=[version===active?'ระบบรับงานใช้อยู่':'',version===latest?'เผยแพร่ล่าสุด':''].filter(Boolean);
  if(flags.length)choice.append(text('small',flags.join(' · '),version===active?'active-version':''));
  return choice;
}
function paperHeader(title:string,...commands:HTMLButtonElement[]){
  const header=text('div','','paper-heading'),tools=text('div','','paper-commands');
  tools.append(...commands);header.append(text('h3',title),tools);return header;
}
function publishedHeader(version:number,openApi:()=>void,commands:HTMLButtonElement[]){
  const title='รุ่น '+version;
  const api=button('เชื่อมต่อ API รุ่น '+version,openApi);
  api.classList.add('primary');
  const zoom=button('ขยายกระดาษ',()=>{
    const stage=zoom.closest<HTMLElement>('.template-stage');
    if(!stage)return;
    const expanded=stage.classList.toggle('paper-expanded');
    zoom.textContent=expanded?'เห็นเต็มหน้า':'ขยายกระดาษ';
    zoom.setAttribute('aria-pressed',String(expanded));
    const frame=stage.querySelector<HTMLIFrameElement>('.library-paper-frame');
    if(frame){const url=new URL(frame.src);url.searchParams.set('fit',expanded?'width':'page');frame.src=url.href;}
  });
  zoom.setAttribute('aria-pressed','false');
  const choose=button('เลือกรุ่น '+version,()=>{
    header.replaceWith(paperHeader('เลือก'+title+' แล้ว',zoom,api,...commands));
    api.focus();
  });
  choose.classList.add('primary');
  const header=paperHeader('กระดาษ'+title,zoom,choose);
  return header;
}
function comparisonLayout(title:string,back:()=>void,content:HTMLElement,apply?:HTMLButtonElement){
  const shell=text('section','','comparison-screen');
  const heading=paperHeader(title,button('กลับรายละเอียดแม่แบบ',back));
  shell.append(heading,content);
  if(apply){
    const footer=text('div','','version-actions');apply.classList.add('primary');
    footer.append(apply);shell.append(footer);
  }
  heading.querySelector('button')?.setAttribute('autofocus','');
  return shell;
}
let baselineRequest:AbortController|undefined;
async function showBaseline(item:TemplateSummary){
  baselineRequest?.abort();
  const controller=new AbortController();
  baselineRequest=controller;
  const panel=document.querySelector<HTMLElement>('#baseline-controls')!;
  panel.replaceChildren();
  if(!phase1||item.readOnly)return;
  const url='/api/editor-phase1/drafts/'+encodeURIComponent(item.templateId);
  try{
    const reply=await fetch(url+'/baseline',{signal:controller.signal});
    if(reply.status===404)return;
    if(!reply.ok)throw Error();
    const state=await reply.json() as {pinned:number|null;versions:number[];revision:number;fingerprint:string;canCompare:boolean};
    if(controller.signal.aborted)return;
    const latest=state.versions[0]??0;
    const status=text('p',latest?versionStatus(state.pinned??latest,latest):'ยังไม่มีรุ่นที่เผยแพร่');
    status.id='baseline-status';status.setAttribute('role','status');
    const picker=text('select','');picker.id='baseline-version';
    for(const version of state.versions)picker.add(new Option('รุ่น '+version, String(version)));
    picker.value=String(latest);
    const label=text('label','รุ่นสำหรับระบบรับงาน　');label.append(picker);
    const apply=text('button','ยืนยันใช้รุ่นที่เลือก');apply.id='baseline-apply';
    const publish=text('button',latest?'เผยแพร่ร่างปัจจุบันเป็นรุ่น '+(latest+1):'เผยแพร่เป็นรุ่น 1');publish.id='baseline-publish';
    async function change(path:string,method:string,body:object){
      apply.disabled=publish.disabled=true;
      try{
        const result=await fetch(url+path,{method,signal:controller.signal,headers:{'Content-Type':'application/json'},
          body:JSON.stringify({pinned:state.pinned,latest,...body})});
        if(controller.signal.aborted)return;
        if(!result.ok){
          status.textContent=result.status===409?'รุ่นหรือร่างเปลี่ยนแล้ว กรุณาเปิดรายละเอียดใหม่':'บันทึกไม่สำเร็จ กรุณาเปิดรายละเอียดใหม่';
          return;
        }
        await load();
        if(path==='/publish-baseline'&&latest===0){
          returnToLibrary();
          const published=items.find(row=>row.templateId===item.templateId)?.publishedVersions;
          if(published?.includes(1))document.querySelector('#status')!.textContent=item.name+' · เผยแพร่รุ่น 1 แล้ว';
          return;
        }
        await showBaseline(items.find(row=>row.templateId===item.templateId)??item);
      }catch{if(!controller.signal.aborted)status.textContent='เชื่อมต่อไม่ได้ กรุณาเปิดรายละเอียดใหม่';}
    }
    const compare=text('button','ทาบบนกระดาษด้วยข้อมูลเดิม');compare.id='baseline-compare';
    const comparison=text('div','');let comparisonRun:AbortController|undefined;
    const needsPaper=()=>state.canCompare&&Number(picker.value)!==(state.pinned??latest);
    function resetComparison(){
      comparisonRun?.abort();comparison.replaceChildren();detail.classList.remove('with-compare');
      apply.disabled=!latest||Number(picker.value)===state.pinned||needsPaper();
      compare.hidden=!needsPaper();compare.disabled=false;
    }
    const board=text('div','','template-board'),rail=text('aside','','template-rail'),stage=text('div','','template-stage');
    const draftChoices=new Map<TemplateSummary,HTMLButtonElement>();
    const choices=new Map<number,HTMLButtonElement>();
    function selectDraft(copy:TemplateSummary){
      picker.selectedIndex=-1;resetComparison();
      for(const [draft,choice] of draftChoices)choice.setAttribute('aria-pressed',String(draft===copy));
      for(const choice of choices.values())choice.setAttribute('aria-pressed','false');
      const edit=button('แก้ร่าง',()=>openEditor(copy));edit.classList.add('primary');
      const commands=[edit];if(latest)commands.push(button(copy!==item&&state.pinned?'ทาบร่างก่อนเผยแพร่':'ทาบกับรุ่นที่ใช้อยู่',()=>compareSavedDraft(item,copy,state.pinned??latest)));if(copy===item){
        const review=button('ตรวจร่างก่อนเผยแพร่',()=>{
          const frame=definitionPaper(item);
          const note=text('p','กำลังเปิดกระดาษฉบับร่าง…');note.setAttribute('role','status');
          const content=text('div','');content.append(note,frame);
          publish.disabled=true;
          const screen=comparisonLayout('ตรวจร่างก่อนเผยแพร่เป็นรุ่น 1',()=>showBaseline(item),content,publish);
          const ready=(event:MessageEvent)=>{
            if(event.origin!==location.origin||event.source!==frame.contentWindow||event.data?.type!=='flowdoc-paper-ready')return;
            window.removeEventListener('message',ready);
            const same=event.data.revision===state.revision&&event.data.fingerprint===state.fingerprint;
            note.textContent=same?'ฉบับร่างที่บันทึกครั้งที่ '+state.revision:'ร่างเปลี่ยนแล้ว กรุณากลับไปเปิดใหม่';
            publish.disabled=!same;
          };
          window.addEventListener('message',ready,{signal:controller.signal});
          panel.replaceChildren(status,screen);screen.querySelector('button')?.focus();
        });
        commands.push(latest?publish:review);
      }

      stage.replaceChildren(paperHeader(copy===item?'ฉบับร่างปัจจุบัน':copy.name,...commands),definitionPaper(copy));
    }
    function draftChoice(copy:TemplateSummary,title:string){
      const choice=button(title,()=>selectDraft(copy));draftChoices.set(copy,choice);rail.append(choice);
    }
    rail.append(text('h3','รุ่นที่เผยแพร่แล้ว'));
    function selectVersion(){
      stage.classList.remove('paper-expanded');
      resetComparison();
      const version=Number(picker.value);
      for(const choice of draftChoices.values())choice.setAttribute('aria-pressed','false');
      for(const [v,choice] of choices)choice.setAttribute('aria-pressed',String(v===version));
      const page=text('div',state.canCompare?'กำลังเปิดกระดาษ…':'ยังไม่มีข้อมูลตัวอย่างสำหรับรุ่นนี้');
      compare.textContent='ทาบก่อนใช้รุ่น '+version;compare.classList.add('primary');
      apply.textContent='ยืนยันใช้รุ่น '+version;
      stage.replaceChildren(publishedHeader(version,()=>showPublishedApi(stage,item,version,state.pinned,selectVersion),[clone,compare]),page);
      compare.disabled=state.canCompare;
      if(!state.canCompare&&version)page.replaceChildren(definitionPaper(item,version));
      if(state.canCompare&&version)void firstPage(url,state,version).then(p=>{
        if(controller.signal.aborted||!page.isConnected)return;
        compare.disabled=false;
        const sheet=paperView(p,2,()=>{},{heading:'รุ่น '+version,points:[],pick:()=>{}});
        sheet.querySelector('h3')!.textContent='หน้า '+(p.pageIndex+1)+' / '+p.pageCount;
        page.replaceChildren(sheet);
      }).catch(()=>{if(!controller.signal.aborted&&page.isConnected)page.textContent='โหลดกระดาษไม่สำเร็จ';});
    }
    for(const version of state.versions){
      const choice=versionChoice(version,state.pinned??latest,latest,()=>{picker.value=String(version);selectVersion();});
      choices.set(version,choice);rail.append(choice);
    }
    rail.append(text('h3','ฉบับร่าง'));draftChoice(item,'ฉบับร่างปัจจุบัน');
    for(const linked of item.relatedDrafts??[]){
      const copy=items.find(row=>row.templateId===linked.id);
      if(copy)rail.append(button('แก้ร่างต่อ · ร่างจากรุ่น '+linked.source,()=>openEditor(copy)));
      if(copy)draftChoice(copy,'ดูร่างจากรุ่น '+linked.source);
    }
    board.append(rail,stage);
    picker.onchange=selectVersion;
    apply.disabled=!latest||Number(picker.value)===state.pinned;
    apply.onclick=()=>void change('/baseline','PUT',{version:Number(picker.value)});
    publish.onclick=async()=>{
      if(await confirmPublication(item.name,latest+1,state.pinned)&&publish.isConnected&&!controller.signal.aborted)
        await change('/publish-baseline','POST',{revision:state.revision,fingerprint:state.fingerprint});
    };
    const clone=text('button','คัดลอกรุ่นที่เลือกเป็นร่าง');clone.id='clone-review';clone.disabled=!latest;
    clone.onclick=()=>{
      comparisonRun?.abort();detail.classList.add('with-compare');
      const view=text('div','');panel.replaceChildren(view);
      void openDraftReview(view,url,item.name,state,Number(picker.value),controller.signal,()=>showBaseline(item));
    };
    label.hidden=true;
    compare.onclick=()=>{
      comparisonRun?.abort();comparisonRun=new AbortController();apply.disabled=true;
      const version=Number(picker.value);
      const screen=comparisonLayout('ทาบรุ่น '+(state.pinned??latest)+' กับรุ่น '+version,()=>{
        comparisonRun?.abort();panel.replaceChildren(status,label,board);selectVersion();
      },comparison,apply);
      panel.replaceChildren(status,screen);screen.querySelector('button')?.focus();
      baselineCompare(comparison,url,state,version,AbortSignal.any([controller.signal,comparisonRun.signal]),ready=>{apply.disabled=!ready;});
    };
    panel.replaceChildren(status,label,board);
    if(latest)selectVersion();else selectDraft(item);

  }catch{if(!controller.signal.aborted)panel.textContent='โหลดรุ่นที่ใช้งานไม่ได้';}
}
function definitionPaper(item:TemplateSummary,version?:number){
  const frame=document.createElement('iframe');
  frame.title=version?'กระดาษรุ่น '+version:'กระดาษฉบับร่าง';
  frame.className='library-paper-frame';
  const params=new URLSearchParams({id:item.templateId,view:'paper'});
  if(version){params.set('version',String(version));params.set('fit','page');}
  frame.src='/phase1-editor.html?'+params;
  return frame;
}
function issuerLabel(item:TemplateSummary){
  if(item.issuerVersion===undefined)return undefined;
  const active=item.issuerVersion===null?'ตรวจรุ่นที่ระบบรับงานใช้ไม่ได้':'ระบบรับงานใช้รุ่น '+item.issuerVersion;
  return active+' · เผยแพร่ล่าสุด '+(item.publishedVersions?.[0]??'—');
}
let releaseIssuerPapers:(()=>void)|undefined;
function clearIssuerPapers(){
  releaseIssuerPapers?.();releaseIssuerPapers=undefined;
}
function compareIssuer(stage:HTMLElement,item:TemplateSummary,version:number,back:()=>void){
  const state=item.issuerBaseline!;
  const body={version,pinned:state.pinned,latest:state.versions[0]};
  const api='/api/editor-phase1/drafts/'+encodeURIComponent(item.templateId);
  const note=text('p','กำลังจัดกระดาษทั้งสองรุ่นด้วยข้อมูล SRS ชุดเดียวกัน…');
  const view=text('div','','compare-papers');
  const content=text('div','');
  const apply=button('ยืนยันใช้รุ่น '+version,async()=>{
    apply.disabled=true;
    try{
      const reply=await fetch(api+'/baseline',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
      if(!reply.ok)throw Error();
      await load();
      const fresh=items.find(row=>row.templateId===item.templateId);
      if(fresh&&note.isConnected)openDetails(fresh);
    }catch{note.textContent='ยืนยันผลไม่ได้ กรุณาเปิดคลังใหม่เพื่อตรวจรุ่นที่ใช้อยู่';}

  });
  apply.disabled=true;content.append(note,view);
  const screen=comparisonLayout('ทาบรุ่น '+item.issuerVersion+' กับรุ่น '+version,back,content,apply);
  stage.replaceChildren(screen);screen.querySelector('button')?.focus();
  void (async()=>{
    try{
      const reply=await fetch(api+'/compare-baseline',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
      if(!reply.ok)throw Error();
      const result=await reply.json() as {papers:{version:number;pdf:string}[]};
      if(!view.isConnected)return;
      const {renderComparison}=await import('./issuer-compare');
      if(!view.isConnected)return;
      await renderComparison(view,result.papers,dispose=>{releaseIssuerPapers=dispose;});
      if(!view.isConnected)return;
      note.textContent='ตัวอย่างเอกสารจาก API · ข้อมูลชุดเดียวกัน';apply.disabled=false;
    }catch{if(view.isConnected)note.textContent='เปิดกระดาษไม่ได้ กรุณากลับไปลองอีกครั้ง';}
  })();
}
function showTemplate(item:TemplateSummary){
  const panel=document.querySelector<HTMLElement>('#baseline-controls')!;
  const board=text('div','','template-board'),rail=text('aside','','template-rail'),stage=text('section','','template-stage');
  const versions=item.publishedVersions??[];
  const summary=text('p',issuerLabel(item)??(versions.length?'เผยแพร่ล่าสุด · รุ่น '+versions[0]+'　·　ไม่มีข้อมูลรุ่นที่ระบบรับงานใช้':
    item.publishedVersions?'ยังไม่มีรุ่นที่เผยแพร่':'ไม่มีข้อมูลรุ่นสำหรับมุมมองนี้'));
  summary.id='baseline-status';

  const picks=new Map<number,HTMLButtonElement>();
  function select(version?:number){
    stage.classList.remove('paper-expanded');
    clearIssuerPapers();
    for(const [key,choice] of picks)choice.setAttribute('aria-pressed',String(key===(version??0)));
    const commands:HTMLButtonElement[]=[];
    const restore=()=>{panel.replaceChildren(summary,board);select(version);};
    if(!version&&phase1&&!item.readOnly)commands.push(button('แก้ร่าง',()=>openEditor(item)));
    if(!version&&item.issuerVersion)commands.push(button('ทาบกับรุ่นที่ใช้อยู่',()=>compareSavedDraft(item,item,item.issuerVersion!)));
    if(version&&item.issuerBaseline&&version!==item.issuerVersion){
      commands.push(button('ทาบก่อนใช้รุ่น '+version,()=>{const area=text('div','');panel.replaceChildren(summary,area);compareIssuer(area,item,version,restore);}));
    }
    if(version&&item.revision!==null)commands.push(button('ทาบกับฉบับร่าง',()=>{
      const papers=text('div','','compare-papers');
      for(const tag of [version,undefined]){
        const side=text('section','');
        side.append(text('h3',tag?'รุ่น '+tag:'ฉบับร่างปัจจุบัน'),definitionPaper(item,tag));
        papers.append(side);
      }
      const screen=comparisonLayout('ทาบรุ่น '+version+' กับฉบับร่าง',restore,papers);panel.replaceChildren(summary,screen);screen.querySelector('button')?.focus();
    }));
    commands[0]?.classList.add('primary');
    stage.replaceChildren(version&&phase1?publishedHeader(version,()=>showPublishedApi(stage,item,version,item.issuerVersion,restore),commands):paperHeader(version?'รุ่น '+version+' · อ่านอย่างเดียว':item.readOnly?'ต้นฉบับ':'ฉบับร่างปัจจุบัน',...commands));
    if(phase1&&item.revision!==null)stage.append(definitionPaper(item,version));
    else stage.append(text('p',phase1?'ยังไม่มีโครงบนกระดาษ':'มุมมองนี้แสดงข้อมูลคลังเท่านั้น'));
  }
  function addChoice(label:string,version?:number){
    const choice=version?versionChoice(version,item.issuerVersion,versions[0],()=>select(version)):button(label,()=>select());picks.set(version??0,choice);rail.append(choice);
  }

  rail.append(text('h3','รุ่นที่เผยแพร่แล้ว'));
  for(const version of versions)addChoice('รุ่น '+version,version);
  if(!versions.length)rail.append(text('small',item.publishedVersions?'ยังไม่มีรุ่นเผยแพร่':'ไม่มีข้อมูล'));
  rail.append(text('h3',item.readOnly?'โครงเอกสาร':'ฉบับร่าง'));addChoice(item.readOnly?'ต้นฉบับ':'ฉบับร่างปัจจุบัน');
  board.append(rail,stage);panel.replaceChildren(summary,board);select(versions[0]);
}
function activeVersion(item:TemplateSummary){
  return item.issuerVersion??item.libraryVersions?.pinned??item.libraryVersions?.versions[0];
}
function compareSavedDraft(parent:TemplateSummary,copy:TemplateSummary,version:number){
  baselineRequest?.abort();clearIssuerPapers();
  const panels=text('div','','compare-papers');
  for(const [label,paper] of [
    ['ระบบรับงานใช้ · รุ่น '+version,definitionPaper(parent,version)],
    [copy.name+' · ร่างที่บันทึกครั้งที่ '+copy.revision,definitionPaper(copy)]
  ] as const){
    const side=text('section','');side.append(text('h3',label),paper);panels.append(side);
  }
  const url=new URL(location.href);url.searchParams.delete('compareDraft');
  const back=()=>{history.replaceState(null,'',url);openDetails(parent);};
  const link=parent.relatedDrafts?.find(row=>row.id===copy.templateId);
  const latest=parent.libraryVersions?.versions[0];
  const endpoint='/api/editor-phase1/drafts/';
  const notice=text('p','','meta');notice.setAttribute('role','status');
  const content=text('div','');content.append(notice,panels);
  let confirm:HTMLButtonElement|undefined;
  if(link&&latest&&parent.libraryVersions?.pinned===version){
    notice.textContent='ร่างจากรุ่น '+link.source+' · บันทึกครั้งที่ '+copy.revision+' · หลังเผยแพร่ API ยังใช้รุ่น '+version;
    confirm=button('เผยแพร่เป็นรุ่น '+(latest+1),async()=>{
      if(!await confirmPublication(parent.name,latest+1,version)||!confirm!.isConnected)return;
      confirm!.disabled=true;
      try{
        const draftResponse=await fetch(endpoint+copy.templateId);
        if(!draftResponse.ok)throw Error();
        const {value}=await draftResponse.json();
        if(value.revision!==copy.revision){notice.textContent='ร่างเปลี่ยนแล้ว กลับคลังเพื่อเปิดทาบอีกครั้ง';return;}
        const response=await fetch(endpoint+parent.templateId+'/publish-review',{method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({id:copy.templateId,source:link.source,revision:value.revision,fingerprint:value.fingerprint,
            latest,pinned:version,comparedVersion:version})});
        if(!response.ok){notice.textContent=response.status===409?'ร่างหรือรุ่นเปลี่ยนแล้ว หรือร่างนี้เผยแพร่แล้ว กรุณากลับคลังเพื่อตรวจรุ่น':'เผยแพร่ไม่สำเร็จ กรุณากลับคลังเพื่อตรวจสถานะ';return;}
        const published=(await response.json()).value.version;
        await load();returnToLibrary();
        const current=items.find(row=>row.templateId===parent.templateId)?.libraryVersions;
        if(current?.versions.includes(published))status.textContent='เผยแพร่รุ่น '+published+' แล้ว · ระบบรับงาน API ใช้รุ่น '+current.pinned;
      }catch{notice.textContent='ตรวจผลเผยแพร่ไม่ได้ กรุณากลับคลังแล้วรีเฟรช';}
    });
  }
  const screen=comparisonLayout(confirm?'ตรวจร่างก่อนเผยแพร่':'ทาบโครงฉบับร่างกับรุ่นที่ใช้อยู่',back,content,confirm);
  const edit=button('กลับไปแก้ร่าง',()=>openEditor(copy));screen.querySelector('.paper-commands')!.append(edit);
  document.querySelector('#baseline-controls')!.replaceChildren(screen);
  screen.querySelector('button')?.focus();
}
function openDetails(item: TemplateSummary) {
  clearIssuerPapers();
  if(location.hash.slice(1)!==item.templateId)history.pushState(null,'','#'+item.templateId);
  document.querySelector('#detail-name')!.textContent = item.name;
  document.querySelector('#detail-key')!.textContent = item.docKey;
  document.querySelector('#detail-info')!.textContent =
    [accessLabel(item), item.revision === null ? '' : 'Revision ' + item.revision, updatedAt(item)].filter(Boolean).join(' · ');
  baselineRequest?.abort();
  detail.classList.add('template-detail');
  detail.classList.remove('with-compare');
  if(!detail.open)detail.show();
  document.querySelector<HTMLButtonElement>('#return-library')!.focus();
  window.scrollTo(0,0);
  const requested=new URLSearchParams(location.search).get('compareDraft');
  const copy=items.find(row=>row.templateId===requested);
  const active=activeVersion(item);
  if(copy&&active&&(item===copy||item.relatedDrafts?.some(link=>link.id===copy.templateId))){
    compareSavedDraft(item,copy,active);return;
  }
  if(item.libraryVersions)void showBaseline(item);else showTemplate(item);
}

function closeMenus(except?: HTMLDetailsElement) {
  for (const menu of cards.querySelectorAll<HTMLDetailsElement>('details[open]')) {
    if (menu !== except) menu.open = false;
  }
}

function openEditor(item: TemplateSummary) {
  sessionStorage.setItem('flowdoc:open:'+item.templateId, String(performance.timeOrigin + performance.now()));
  const params=new URLSearchParams({id:item.templateId,from:location.hash.slice(1)||item.templateId});
  location.assign('/phase1-editor.html?'+params);
}

function card(item: TemplateSummary) {
  const element = document.createElement('article');
  element.className = 'card';
  element.dataset.docKey=item.docKey;

  const open = document.createElement('button');
  open.type = 'button';
  open.className = 'card-open';
  open.setAttribute('aria-label','เปิดรายละเอียด '+item.name);
  open.onclick=()=>openDetails(item);

  const thumbnail = document.createElement('span');
  thumbnail.className = 'thumbnail';
  const paper = document.createElement('span');
  paper.className = 'paper';
  paper.innerHTML = paperIcon; // Constant icon. Database fields are rendered as text.
  paper.append(text('span', 'ยังไม่มีภาพตัวอย่าง'));
  const cover=phase1&&covers.find(c=>c.templateId===item.templateId&&c.revision===item.revision);
  if(cover){
    const image=new Image();
    image.alt='หน้าแรกของ '+item.name;
    image.loading='lazy';image.decoding='async';image.className='cover-image';
    image.onerror=()=>thumbnail.replaceChildren(paper);
    image.src='/library-covers/'+cover.artifact;
    thumbnail.append(image);
  }else thumbnail.append(paper);

  const caption = document.createElement('span');
  caption.className = 'caption';
  caption.append(text('span', item.name, 'card-title'));
  const latest=item.publishedVersions?.[0];
  caption.append(text('span',issuerLabel(item)??(latest?'เผยแพร่ล่าสุด · รุ่น '+latest:accessLabel(item)),'meta'));
  const versions=item.libraryVersions;
  if(versions?.versions.length){
    const latest=versions.versions[0],active=versions.pinned??latest;
    caption.replaceChildren(text('span',item.name,'card-title'),text('span',versionStatus(active,latest),'meta'));
    if(versions.canCompare){
      void firstPage('/api/editor-phase1/drafts/'+encodeURIComponent(item.templateId),versions,active).then(p=>{
        const sheet=paperView(p,3,()=>{}).querySelector('svg')!;
        // Each thumbnail and detail sheet has its own glyph definitions.
        sheet.setAttribute('aria-hidden','true');thumbnail.replaceChildren(sheet);
      }).catch(()=>{});
    }
  }
  caption.prepend(text('span',latest?'แม่แบบที่เผยแพร่':accessLabel(item),'card-kind'));
  caption.append(text('span','เปิดแม่แบบ →','card-link'));
  open.append(thumbnail, caption);

  const menu = document.createElement('details');
  menu.className = 'menu';
  const toggle = text('summary', '⋯');
  toggle.setAttribute('aria-label', 'ตัวเลือก ' + item.name);
  toggle.onclick = () => closeMenus(menu);
  const actions = document.createElement('div');
  actions.className = 'menu-actions';
  const view = text('button', phase1&&!item.readOnly?'รายละเอียดและรุ่นที่ใช้งาน':'เปิดดู');
  view.type = 'button';
  view.onclick = () => { openDetails(item); menu.open = false; };
  actions.append(view);
  for (const label of (phase1&&!item.readOnly?['แก้ไข']:[])) {
    const action = text('button', label);
    action.type = 'button';
    action.disabled = !phase1 || item.readOnly === true || label !== 'แก้ไข';
    if (!action.disabled) action.onclick = () => openEditor(item);
    actions.append(action);
  }
  menu.append(toggle, actions);
  menu.onkeydown = event => {
    if (event.key === 'Escape' && menu.open) {
      menu.open = false;
      toggle.focus();
    }
  };
  element.append(open, menu);
  return element;
}

function render() {
  const query = search.value.trim().toLowerCase();
  const shown = items.filter(item => [item.name, item.docKey].some(value => value.toLowerCase().includes(query)));
  count.textContent = available ? shown.length + ' รายการ' : '';
  const ordered=[...shown].sort((a,b)=>Number(Boolean(b.publishedVersions?.length))-Number(Boolean(a.publishedVersions?.length))||a.name.localeCompare(b.name,'th'));
  cards.replaceChildren(...ordered.map(card));
  if (!loading && available && !shown.length) {
    cards.append(text('p', query ? 'ไม่พบโครงเอกสารที่ตรงกับคำค้น' : 'ยังไม่มีโครงเอกสารในคลัง', 'empty'));
  }
}

function isSummary(value: unknown): value is TemplateSummary {
  if (!value || typeof value !== 'object') return false;
  const row = value as Partial<TemplateSummary>;
  return typeof row.templateId === 'string' && typeof row.name === 'string' &&
    typeof row.docKey === 'string' && typeof row.updatedAt === 'string' &&
    (row.readOnly === undefined || typeof row.readOnly === 'boolean') &&
    (row.description === null || typeof row.description === 'string') &&
    (row.revision === null || (typeof row.revision === 'number' && Number.isSafeInteger(row.revision)));
}

async function load() {
  if (loading) return;
  loading = true;
  refresh.disabled = true;
  status.textContent = 'กำลังโหลดโครงเอกสาร…';
  try {
    const response = await fetch(phase1 ? '/api/editor-phase1/catalog' : '/api/library', {signal: AbortSignal.timeout(12000)});
    const body: {items?: unknown; error?: string} = await response.json();
    if (body.error === 'phase1_disabled') {
      status.textContent = 'ยังไม่ได้เปิดคลังทดสอบเฟส 1';
      return;
    }
    if (body.error === 'source_disabled') {
      status.textContent = 'ยังไม่ได้เปิดแหล่งข้อมูล Oracle สำหรับหน้าคลังนี้';
      return;
    }
    if (!response.ok || !Array.isArray(body.items) || !body.items.every(isSummary)) throw Error('Catalog unavailable');
    items = body.items;
    available = true;
    status.textContent = '';
  } catch {
    status.textContent = 'อ่านรายการจากฐานข้อมูลไม่ได้ ลองกดรีเฟรชอีกครั้ง';
  } finally {
    loading = false;
    refresh.disabled = false;
    render();
  }
}

document.addEventListener('click', event => {
  if (event.target instanceof Element && !event.target.closest('.menu')) closeMenus();
});
search.addEventListener('input', render);
refresh.addEventListener('click', () => void load());
function routeLibrary(){
  const item=items.find(row=>row.templateId===location.hash.slice(1));
  if(item)openDetails(item);else if(detail.open)detail.close();
}
function returnToLibrary(){
  const id=location.hash.slice(1);
  const url=new URL(location.href);url.hash='';url.searchParams.delete('compareDraft');history.replaceState(null,'',url);
  if(detail.open)detail.close();
  const item=items.find(row=>row.templateId===id);
  if(item)cards.querySelector<HTMLButtonElement>('[data-doc-key="'+CSS.escape(item.docKey)+'"] .card-open')?.focus();
}
window.addEventListener('hashchange',routeLibrary);
document.querySelector<HTMLButtonElement>('#return-library')!.onclick=returnToLibrary;
detail.addEventListener('keydown',event=>{if(event.key==='Escape'&&detail.classList.contains('template-detail'))returnToLibrary();});
detail.addEventListener('close',()=>{if(!detail.open){clearIssuerPapers();baselineRequest?.abort();document.querySelector('#baseline-controls')!.replaceChildren();}});
void load().then(routeLibrary);
