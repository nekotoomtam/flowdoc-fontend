import './phase1-editor.css';
import {mountWordParagraph} from './editor-word-paragraph';
import type {Definition} from './editor-structure';

const get=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T;
const bar=get('tag-tools'),bold=get<HTMLButtonElement>('tag-bold'),size=get<HTMLInputElement>('tag-size'),save=get<HTMLButtonElement>('save-structure');
const heading=document.createElement('h1');heading.textContent='แก้แม่แบบ';
const section=document.createElement('main'),paper=document.createElement('article'),editor=document.createElement('div'),status=document.createElement('span');
status.setAttribute('role','status');section.className='one-line-trial';paper.className='one-line-paper';editor.className='word-input';
get('word-open').remove();get('insert-at').remove();get('tag-view').remove();
bar.hidden=false;bar.append(status,save);section.append(heading,bar,paper);paper.append(editor);document.body.replaceChildren(section);
const endpoint='/api/editor-phase1/drafts/'+encodeURIComponent(new URLSearchParams(location.search).get('id')??'');
async function start(){
  const response=await fetch(endpoint),reply=await response.json();
  if(!response.ok||!reply.ok)throw Error();
  const draft=reply.value,definition:Definition=draft.definition;
  const first=definition.sections[0],fragment=first?.source.fragment;
  const node=fragment?.nodes[fragment.rootIds[0]];
  if(!first||!node?.children||node.type!=='text-block'||draft.readOnly)throw Error();
  const fields=[...Object.entries(definition.globalSchema.fields).map(([key,f])=>({key,scope:'global',type:f.type})),...Object.entries(first.inputSchema.fields).map(([key,f])=>({key,scope:'section',type:f.type}))].filter(f=>['string','number'].includes(f.type));
  const style=definition.styles[node.props?.textStyleId??''] as {fontSize:{value:number};font:{weight:number}};
  let revision=draft.revision,edits=0,saving=false;
  const warn=(e:BeforeUnloadEvent)=>e.preventDefault();
  bold.disabled=size.disabled=false;
  const line=mountWordParagraph(editor,bold,size,node.children,fields,style.font.weight>=700,style.fontSize.value,()=>{
    edits++;save.disabled=saving;status.textContent='ยังไม่ได้บันทึก';window.addEventListener('beforeunload',warn);
  });
  save.onclick=async()=>{
    if(saving)return;
    const version=edits;
    saving=true;save.disabled=true;node.children=line.parts();
    try{
      const r=await fetch(endpoint+'/structure',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({definition,expectedRevision:revision,idempotencyKey:crypto.randomUUID()})});
      const result=await r.json();
      if(!r.ok||!result.ok)throw Error(r.status===409?'มีการบันทึกจากหน้าอื่น':'บันทึกร่างไม่สำเร็จ');
      revision=result.value.revision;if(edits===version){status.textContent='บันทึกแล้ว';window.removeEventListener('beforeunload',warn);}else save.disabled=false;
    }catch(error){status.textContent=(error as Error).message;save.disabled=false;}finally{saving=false;}
  };
}
void start().catch(()=>{status.textContent='เปิดย่อหน้าในร่างนี้ไม่ได้';});
