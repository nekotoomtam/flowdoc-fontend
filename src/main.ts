import {Schema} from 'prosemirror-model';
import {EditorState,Plugin,PluginKey,TextSelection} from 'prosemirror-state';
import {EditorView,Decoration,DecorationSet} from 'prosemirror-view';
import {history,undo,redo} from 'prosemirror-history';
import {keymap} from 'prosemirror-keymap';
import {baseKeymap} from 'prosemirror-commands';
import {applyMenuEdit} from './binding.mjs';
import './style.css';
const request=await fetch('/spike-request.json').then(r=>r.json());
let edited=structuredClone(request);
const members=request.sections[0].data.parts[0].data.groups[0].members;
const owner=(member:number)=>({instanceKey:request.sections[0].instanceKey,entry:0,group:0,member});
const headings=['Module','Menu','Test Case','Pass','Fail'];
const header=()=>{const el=document.createElement('div');el.className='head';el.contentEditable='false';for(const label of headings){const c=document.createElement('div');c.textContent=label;el.append(c)}return el};
document.querySelector('#app')!.innerHTML=`<header><h1>FlowDoc / UAT · ทดลองพิมพ์บนกระดาษ</h1><button id="target">ไปเซลล์ทดสอบ</button><button id="undo">ย้อนกลับ</button><button id="redo">ทำซ้ำ</button><button id="reset">เริ่มใหม่</button></header><aside><div class="warning">ตัวทดลองเท่านั้น<br>ยังไม่รับรองการตัดหน้าตรง Engine</div><strong>กำลังแก้ข้อมูลทดลอง</strong>Section: UAT source 1<br>Area: parts<br>Format: summary-dynamic<br>ตัวแปร: item.menu<strong>ลองด้วยตัวเอง</strong>คลิกกลางคำในช่อง Menu สีเหลือง แล้วพิมพ์ไทยให้ข้อความยาวจนข้ามหน้า เลื่อนขึ้นแล้วกลับมาแก้ต่อ<strong>ขอบเขตตัวอย่าง</strong><div class="small">ใช้ Format และฟอนต์ UAT จริง ทำข้อมูลซ้ำ 34 แถวเพื่อชนขอบหน้า ตัดหัว/ท้ายเอกสารออกเฉพาะชุดทดสอบนี้<br>วิธีแบ่งหน้ารุ่นนี้ย้ายทั้งแถว จึงยังไม่รองรับการแบ่งภายในแถวตาม allowBreak</div><strong>ตำแหน่งปัจจุบัน</strong><div id="status"></div><button id="download">เก็บ JSON ที่แก้</button></aside><main><div id="papers"></div><div id="editor"></div></main>`;
const schema=new Schema({nodes:{doc:{content:'row+'},row:{content:'text*',attrs:{member:{default:0}},toDOM:n=>['div',{'data-member':n.attrs.member},0]},text:{}}});
const paginationKey=new PluginKey('pages');
const pagination=new Plugin({key:paginationKey,state:{init:()=>DecorationSet.empty,apply(tr,old){return tr.getMeta(paginationKey)??old.map(tr.mapping,tr.doc)}},props:{decorations(state){return this.getState(state)}}});
const owners=new Plugin({filterTransaction(tr){if(!tr.docChanged)return true;if(tr.doc.childCount!==members.length)return false;let valid=true;tr.doc.forEach((n,_pos,i)=>{if(n.attrs.member!==i)valid=false});return valid}});
let scheduled=0,measurements:any[]=[],breaks:string='',compositionEvents:string[]=[];
const schedule=()=>{cancelAnimationFrame(scheduled);scheduled=requestAnimationFrame(paginate)};
const view=new EditorView(document.querySelector('#editor'),{
 state:EditorState.create({schema,doc:schema.node('doc',null,members.map((m:any,i:number)=>schema.node('row',{member:i},schema.text(m.menu)))),plugins:[owners,pagination,history(),keymap({'Enter':()=>true,'Mod-z':undo,'Mod-y':redo,'Mod-Shift-z':redo}),keymap(baseKeymap)]}),
 nodeViews:{row(node){const dom=document.createElement('div');dom.className='row'+(node.attrs.member===21?' target':'');dom.dataset.member=String(node.attrs.member);const m=members[node.attrs.member];let contentDOM!:HTMLDivElement;for(let i=0;i<5;i++){const cell=document.createElement('div');if(i===1){contentDOM=cell;cell.className='menu';cell.setAttribute('aria-label',`Menu แถว ${node.attrs.member+1}`)}else{cell.contentEditable='false';if(i===0&&node.attrs.member===0){const label=document.createElement('span');label.className='group-label';label.textContent=request.sections[0].data.parts[0].data.groups[0].name;cell.append(label)}else if(i>1)cell.textContent=[m.cases,m.pass,m.fail][i-2]}dom.append(cell)}return {dom,contentDOM,update(next){return next.type===node.type&&next.attrs.member===node.attrs.member},ignoreMutation(m){return m.type!=='selection'&&!contentDOM.contains(m.target)}}}},
 dispatchTransaction(tr){view.updateState(view.state.apply(tr));if(tr.docChanged){view.state.doc.forEach(n=>{edited=applyMenuEdit(edited,owner(n.attrs.member),n.textContent)})}updateStatus();schedule()},
 handleDOMEvents:{compositionstart(){compositionEvents.push('start');return false},compositionend(){compositionEvents.push('end');setTimeout(schedule,0);return false}},
});
function updateStatus(){const s=view.state.selection;const n=s.$from.parent;document.querySelector('#status')!.textContent=`แถว ${(n.attrs.member??0)+1}\nตำแหน่งอักษร ${s.$from.parentOffset}\nหน้าที่แสดง ${measurements.find(m=>m.member===n.attrs.member)?.page??1}\n${view.composing?'กำลังประกอบอักษร':'พร้อมพิมพ์'}`}
function paginate(){if(view.composing){schedule();return}let used=28,page=1;const ds:Decoration[]=[Decoration.widget(0,header,{side:-1,key:'first-header'})];const records:any[]=[];const signatures:string[]=[];
 view.state.doc.forEach((n,pos)=>{const dom=view.nodeDOM(pos) as HTMLElement;const height=dom.getBoundingClientRect().height*.75;if(used+height>769.89&&used>28){const gap=769.89-used+72+18+28;const p=++page;const h=gap;ds.push(Decoration.widget(pos,()=>{const d=document.createElement('div');d.className='break';d.style.height=`${h}pt`;d.contentEditable='false';d.append(header());return d},{side:-1,key:`page-${p}-${h.toFixed(3)}`}));signatures.push(`${pos}:${h}`);used=28}records.push({member:n.attrs.member,page,yPt:36+used,heightPt:height,text:n.textContent});used+=height});measurements=records;
 const sig=signatures.join('|');if(sig!==breaks||paginationKey.getState(view.state)===DecorationSet.empty){breaks=sig;view.dispatch(view.state.tr.setMeta(paginationKey,DecorationSet.create(view.state.doc,ds)).setMeta('addToHistory',false))}
 document.querySelector('#papers')!.innerHTML=Array.from({length:page},(_,i)=>`<div class="paper" style="top:${i*(841.89+18)}pt"><span class="page-label">${i+1} / ${page}</span></div>`).join('');(document.querySelector('main') as HTMLElement).style.minHeight=`${page*(841.89+18)}pt`;updateStatus();
}
function select(member:number,offset:number){let pos=0;view.state.doc.forEach((n,p)=>{if(n.attrs.member===member)pos=p+1+Math.min(offset,n.content.size)});view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc,pos)).scrollIntoView());view.focus()}
document.querySelector('#target')!.addEventListener('click',()=>select(21,9));document.querySelector('#undo')!.addEventListener('click',()=>undo(view.state,view.dispatch));document.querySelector('#redo')!.addEventListener('click',()=>redo(view.state,view.dispatch));document.querySelector('#reset')!.addEventListener('click',()=>location.reload());document.querySelector('#download')!.addEventListener('click',()=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(edited,null,2)],{type:'application/json'}));a.download='edited-request.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)});
await document.fonts.ready;schedule();
(window as any).spike={select,snapshot:()=>({request:structuredClone(edited),rows:measurements,selection:{member:view.state.selection.$from.parent.attrs.member,offset:view.state.selection.$from.parentOffset,from:view.state.selection.from},caret:view.coordsAtPos(view.state.selection.from),compositionEvents:[...compositionEvents],composing:view.composing}),view};
