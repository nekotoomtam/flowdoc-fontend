import {Schema} from 'prosemirror-model';
import {EditorState,Plugin,PluginKey,TextSelection} from 'prosemirror-state';
import {EditorView,Decoration,DecorationSet} from 'prosemirror-view';
import {history,undo,redo} from 'prosemirror-history';
import {keymap} from 'prosemirror-keymap';
import {baseKeymap} from 'prosemirror-commands';
import {applyMenuEdit} from './binding.mjs';
import {createLocalLayout} from './local-layout.mjs';
import './style.css';

const request=await fetch('/spike-request.json').then(r=>r.json());
let edited=structuredClone(request);
const members=request.sections[0].data.parts[0].data.groups[0].members;
const owner=(member:number)=>({instanceKey:request.sections[0].instanceKey,entry:0,group:0,member});
let revision=0,paintedRevision=-1,inFlight=false;
let localLayout:Awaited<ReturnType<typeof createLocalLayout>>;
const inputLatencies:number[]=[];let lastInputAt=performance.now();
let layout:any=null,lastResponse:any=null,error='',compositionEvents:string[]=[],discarded=0;
const latencies:number[]=[];
let lastPaperMarkup='';

document.querySelector('#app')!.innerHTML=`<header><h1>FlowDoc / UAT · เซลล์ต่อข้ามหน้า</h1><button id="target">ไปเซลล์ทดสอบ</button><button id="undo">ย้อนกลับ</button><button id="redo">ทำซ้ำ</button><button id="reset">เริ่มใหม่</button></header><aside><div class="warning">ตัวทดลองจัดหน้าบนเครื่อง<br>Core + ฟอนต์ + ตัวตัดคำรุ่นเดียวกับ Engine</div><strong>กำลังแก้ข้อมูลทดลอง</strong>Section: UAT source 1<br>Area: parts<br>Format: summary-dynamic<br>ตัวแปร: item.menu<strong>ลองด้วยตัวเอง</strong>กดไปเซลล์ทดสอบ แล้วพิมพ์ไทยกลางคำจนเซลล์ต่อหน้าที่สอง จากนั้นคลิกข้อความที่ต่อมาแล้วแก้ได้เลย<strong>ขอบเขตตัวอย่าง</strong><div class="small">Format และฟอนต์ UAT · ข้อมูลซ้ำ 34 แถวเพื่อชนขอบหน้า ตัดหัว/ท้ายเอกสารออกเฉพาะชุดนี้<br>ใช้โค้ดจัดหน้าจาก Core คำนวณทุกครั้งที่พิมพ์ ข้อความทั้งสองหน้ายังเป็นเซลล์เดียวกัน<br>ยังไม่ทดสอบ IME จริงและเอกสารขนาดใหญ่</div><strong>ตำแหน่งและสถานะ</strong><div id="status"></div><button id="download">เก็บ JSON ที่แก้</button></aside><main><div id="papers"></div><div id="editor"></div><div id="composition" aria-hidden="true"></div></main>`;
const schema=new Schema({nodes:{doc:{content:'row+'},row:{content:'text*',attrs:{member:{default:0}},toDOM:n=>['div',{'data-member':n.attrs.member},0]},text:{}}});
const layoutKey=new PluginKey('engine-lines');
const projection=new Plugin({key:layoutKey,state:{init:()=>DecorationSet.empty,apply(tr,old){return tr.getMeta(layoutKey)??old.map(tr.mapping,tr.doc)}},props:{decorations(state){return this.getState(state)}}});
const owners=new Plugin({filterTransaction(tr){if(!tr.docChanged)return true;if(tr.doc.childCount!==members.length)return false;let valid=true;tr.doc.forEach((n,_pos,i)=>{if(n.attrs.member!==i)valid=false});return valid}});
const view=new EditorView(document.querySelector('#editor'),{
 state:EditorState.create({schema,doc:schema.node('doc',null,members.map((m:any,i:number)=>schema.node('row',{member:i},schema.text(m.menu)))),plugins:[owners,projection,history(),keymap({'Enter':()=>true,'Mod-z':undo,'Mod-y':redo,'Mod-Shift-z':redo}),keymap(baseKeymap)]}),
 nodeViews:{row(node){const dom=document.createElement('div');dom.className='logical-row';dom.dataset.member=String(node.attrs.member);const contentDOM=document.createElement('div');contentDOM.className='menu';contentDOM.setAttribute('aria-label',`Menu แถว ${node.attrs.member+1}`);dom.append(contentDOM);return{dom,contentDOM,update(next){return next.type===node.type&&next.attrs.member===node.attrs.member}}}},
 dispatchTransaction(tr){view.updateState(view.state.apply(tr));if(tr.docChanged){lastInputAt=performance.now();revision++;view.state.doc.forEach(n=>{edited=applyMenuEdit(edited,owner(n.attrs.member),n.textContent)});schedule()}updateStatus()},
 handleDOMEvents:{compositionstart(){compositionEvents.push('start');document.querySelector('main')!.classList.add('composing');updateCompositionCaret();updateStatus();return false},compositionend(){compositionEvents.push('end');setTimeout(()=>{if(layout&&paintedRevision===revision)paint(layout);else schedule()},0);return false}},
});
function schedule(){queueMicrotask(refresh);updateStatus()}
function updateStatus(){const s=view.state.selection;document.querySelector('#status')!.textContent=`แถว ${(s.$from.parent.attrs.member??0)+1} · อักษร ${s.$from.parentOffset}\n${error|| (view.composing?'กำลังประกอบอักษร':paintedRevision===revision?'จัดหน้าบนเครื่องแล้ว':'กำลังจัดหน้าบนเครื่อง')}\n${lastResponse?`${lastResponse.pageCount} หน้า · รอบล่าสุด ${Math.round(latencies.at(-1)??0)} ms`:''}`}
const escape=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]!));
function paint(next:any){
 let pageTop=0;const offsets:number[]=[];
 const paperMarkup=next.pages.map((p:any,i:number)=>{
   offsets.push(pageTop);const top=pageTop;pageTop+=p.heightPt+18;
   const fills=p.fills.map((f:any)=>`<rect x="${f.xPt}" y="${f.yPt}" width="${f.widthPt}" height="${f.heightPt}" fill="#${f.color}"/>`).join('');
   const borders=p.borders.map((b:any)=>`<line x1="${b.x1Pt}" y1="${b.y1Pt}" x2="${b.x2Pt}" y2="${b.y2Pt}" stroke="#${b.color}" stroke-width="${b.widthPt}"/>`).join('');
   const text=p.staticText.map((l:any)=>`<text x="${l.xPt}" y="${l.yPt+l.baselineOffsetPt}" font-family="UAT" font-size="${l.fontSizePt}" font-weight="${l.weight}" fill="#${l.color}">${escape(l.text)}</text>`).join('');
   return `<div class="paper" data-page="${i+1}" style="top:${top}pt;width:${p.widthPt}pt;height:${p.heightPt}pt"><svg viewBox="0 0 ${p.widthPt} ${p.heightPt}">${fills}${borders}${text}</svg><span class="page-label">${i+1} / ${next.pages.length}</span></div>`;
 }).join('');
 if(paperMarkup!==lastPaperMarkup){document.querySelector('#papers')!.innerHTML=paperMarkup;lastPaperMarkup=paperMarkup}
 const decorations:Decoration[]=[];
 const mirror=document.createDocumentFragment();
 view.state.doc.forEach((node,pos)=>{
   const row=next.rows[node.attrs.member];
   if(node.textContent!==row.text)throw Error('Stale layout cannot be attached to changed text');
   for(const line of row.lines){
     if(line.to===line.from)continue;
     const span=document.createElement('span');span.className='composition-line'+(row.member===21?' target':'');
     span.dataset.member=String(row.member);span.dataset.page=String(line.page);span.dataset.from=String(line.from);span.dataset.to=String(line.to);
     span.style.cssText=`left:${line.xPt}pt;top:${offsets[line.page-1]+line.yPt}pt;font-size:${line.fontSizePt}pt;line-height:${line.lineHeightPt}pt;font-weight:${line.weight};height:${line.lineHeightPt}pt;`;
     span.textContent=row.text.slice(line.from,line.to);mirror.append(span);
     decorations.push(Decoration.inline(pos+1+line.from,pos+1+line.to,{
       class:'engine-line'+(row.member===21?' target':''),'data-page':String(line.page),'data-from':String(line.from),'data-to':String(line.to),
       style:`left:${line.xPt}pt;top:${offsets[line.page-1]+line.yPt}pt;font-size:${line.fontSizePt}pt;line-height:${line.lineHeightPt}pt;font-weight:${line.weight};height:${line.lineHeightPt}pt;min-width:1px;`,
     },{inclusiveStart:true,inclusiveEnd:true}));
   }
 });
 if(!view.composing)view.dispatch(view.state.tr.setMeta(layoutKey,DecorationSet.create(view.state.doc,decorations)).setMeta('addToHistory',false));
 document.querySelector('#composition')!.replaceChildren(mirror);
 document.querySelector('main')!.classList.toggle('composing',view.composing);
 updateCompositionCaret();
 document.querySelector('#editor')!.classList.add('projected');
 (document.querySelector('main') as HTMLElement).style.height=`${pageTop-18}pt`;
 layout=next;
 if(view.hasFocus()){
   const caret=view.composing?document.querySelector('.composition-caret')?.getBoundingClientRect():view.coordsAtPos(view.state.selection.from);
   if(caret){const top=document.querySelector('header')!.getBoundingClientRect().bottom+16,bottom=innerHeight-24;
     if(caret.bottom>bottom)window.scrollBy(0,caret.bottom-bottom);
     else if(caret.top<top)window.scrollBy(0,caret.top-top);
   }
 }
}
function updateCompositionCaret(){
 const layer=document.querySelector('#composition')!;layer.querySelector('.composition-caret')?.remove();
 const {member}=view.state.selection.$from.parent.attrs,offset=view.state.selection.$from.parentOffset;
 const lines=Array.from(layer.querySelectorAll<HTMLElement>(`[data-member="${member}"]`));
 const line=lines.filter(l=>Number(l.dataset.from)<=offset).at(-1);if(!line?.firstChild)return;
 const range=document.createRange();range.setStart(line.firstChild,Math.min(offset-Number(line.dataset.from),line.textContent!.length));range.collapse(true);
 const r=range.getBoundingClientRect(),bounds=line.getBoundingClientRect(),root=document.querySelector('main')!.getBoundingClientRect();
 const caret=document.createElement('i');caret.className='composition-caret';
 caret.style.cssText=`left:${r.left-root.left}px;top:${bounds.top-root.top}px;height:${bounds.height}px;`;layer.append(caret);
}
async function refresh(){
 if(inFlight||!localLayout)return;
 if(paintedRevision===revision)return;
 const version=revision,input=structuredClone(edited);inFlight=true;error='';updateStatus();const started=performance.now();
 try{
   const result=await localLayout(input);
   if(version!==revision){discarded++;return}
   paint(result.layout);paintedRevision=version;lastResponse=result;latencies.push(performance.now()-started);inputLatencies.push(performance.now()-lastInputAt);
 }catch(e){error=`จัดหน้าไม่สำเร็จ: ${String(e)}`}
 finally{inFlight=false;updateStatus();if(!error&&paintedRevision!==revision)schedule()}
}
function select(member:number,offset:number){let pos=0;view.state.doc.forEach((n,p)=>{if(n.attrs.member===member)pos=p+1+Math.min(offset,n.content.size)});view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc,pos)).scrollIntoView());view.focus()}
function download(){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(edited,null,2)],{type:'application/json'}));a.download='edited-request.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}
for(const [id,fn] of Object.entries({target:()=>select(21,9),undo:()=>undo(view.state,view.dispatch),redo:()=>redo(view.state,view.dispatch),reset:()=>location.reload(),download})){document.getElementById(id)!.addEventListener('click',fn)}
await document.fonts.load('300 8.4pt UAT');await document.fonts.load('400 8.1pt UAT');localLayout=await createLocalLayout();schedule();
(window as any).spike={select,view,snapshot:()=>({request:structuredClone(edited),layout,revision,paintedRevision,inFlight,error,discarded,latencies:[...latencies],engineResponse:lastResponse,inputLatencies:[...inputLatencies],selection:{member:view.state.selection.$from.parent.attrs.member,offset:view.state.selection.$from.parentOffset,from:view.state.selection.from},caret:view.coordsAtPos(view.state.selection.from),compositionEvents:[...compositionEvents],composing:view.composing})};
