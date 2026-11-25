import {DOMSerializer,Schema, type Mark, type Node as PNode} from 'prosemirror-model';
import {EditorState,NodeSelection} from 'prosemirror-state';
import {EditorView} from 'prosemirror-view';
import {history,undo,redo,closeHistory} from 'prosemirror-history';
import {keymap} from 'prosemirror-keymap';
import {baseKeymap} from 'prosemirror-commands';
import type {Inline,InlineStyle} from './editor-structure';

const schema=new Schema({
  nodes:{
    doc:{content:'paragraph'}, paragraph:{content:'inline*',toDOM:()=>['p',0]},
    text:{group:'inline'},
    field:{inline:true,group:'inline',atom:true,attrs:{part:{}},toDOM:n=>['span',{class:'word-field','data-field-id':n.attrs.part.id,contenteditable:'false'},'{{'+n.attrs.part.key+'}}']},
    br:{inline:true,group:'inline',selectable:false,attrs:{id:{default:null}},toDOM:()=>['br']},
  },
  marks:{format:{attrs:{id:{default:null},style:{default:null},originalField:{default:null}},toDOM:mark=>{
    const s:InlineStyle=mark.attrs.style??{};
    return ['span',{style:[
      s.bold===undefined?'':'font-weight:'+(s.bold?'bold':'normal'),
      s.italic===undefined?'':'font-style:'+(s.italic?'italic':'normal'),
      s.fontSizePt?'font-size:calc('+s.fontSizePt+' * var(--inline-pt, 1pt))':'',s.color?'color:#'+s.color:'',
      s.underline===undefined?'':'text-decoration:'+(s.underline?'underline':'none')
    ].join(';')},0];
  }}}
});
const format=schema.marks.format!;
function marks(id?:string,style?:InlineStyle,originalField?:Inline):Mark[]{
  return id||style||originalField?[format.create({id,style,originalField})]:[];
}

function paragraphNode(part:Inline){
  if(part.type==='line-break')return schema.node('br',{id:part.id});
  if(part.type==='field-ref')return schema.node('field',{part},undefined,marks(undefined,part.styleOverride));
  if(part.text)return schema.text(part.text,marks(part.id,part.styleOverride));
}
const serializer=DOMSerializer.fromSchema(schema);
export function displayParagraphPart(part:Inline){
  const node=paragraphNode(part);
  if(!node)return document.createElement('span');
  const dom=serializer.serializeNode(node);
  if(dom instanceof HTMLElement)return dom;
  const span=document.createElement('span');span.append(dom);return span;
}

export function editParagraph(parts:Inline[],fields:{key:string;scope:string}[],baseBold:boolean,baseSize:number,apply:(parts:Inline[])=>void){
  const dialog=document.createElement('dialog');dialog.className='word-editor';
  dialog.innerHTML='<form method="dialog"><h2>แก้ย่อหน้า</h2><div class="tag-tools"><button type="button" aria-label="ตัวหนา"><b>B</b></button><label>ขนาด <input aria-label="ขนาดข้อความ" type="number" min=".5" max="819" step=".5"> pt</label></div><div class="word-input"></div><footer><button value="cancel">ยกเลิก</button><button value="apply">ใช้กับกระดาษ</button></footer></form>';
  document.body.append(dialog);
  const bold=dialog.querySelector<HTMLButtonElement>('[aria-label="ตัวหนา"]')!,size=dialog.querySelector('input')!;
  const editor=dialog.querySelector<HTMLElement>('.word-input')!;
  const mounted=mountWordParagraph(editor,bold,size,parts,fields,baseBold,baseSize);
  dialog.addEventListener('close',()=>{
    if(dialog.returnValue==='apply'&&mounted.changed())apply(mounted.parts());
    mounted.view.destroy();dialog.remove();
  },{once:true});
  dialog.showModal();mounted.view.focus();mounted.sync();
}

export function mountWordParagraph(editor:HTMLElement,bold:HTMLButtonElement,size:HTMLInputElement,parts:Inline[],fields:{key:string;scope:string}[],baseBold:boolean,baseSize:number,onChange?:()=>void){
  const content=parts.flatMap(part=>paragraphNode(part)??[]);
  editor.style.fontSize=baseSize+'pt';editor.style.fontWeight=baseBold?'bold':'normal';
  const state=EditorState.create({schema,doc:schema.node('doc',null,[schema.node('paragraph',null,content)]),plugins:[
    history(),keymap({'Mod-z':undo,'Mod-y':redo,'Mod-Shift-z':redo,Enter:(s,dispatch)=>{dispatch?.(s.tr.replaceSelectionWith(schema.node('br')));return true;}}),keymap(baseKeymap)
  ]});
  const view=new EditorView(editor,{state,attributes:{'aria-label':'ข้อความในย่อหน้า',role:'textbox'},handleTextInput(v,from,to,text){
    if(v.composing||!text.endsWith('}'))return false;
    const before=v.state.doc.resolve(from).parent.textBetween(0,v.state.doc.resolve(from).parentOffset,'\n','\uFFFC');
    const hit=(before+text).match(/\{\{([^{}\s]+)\}\}$/u);
    if(!hit)return false;
    const start=from+text.length-hit[0].length;
    if(start<1)return false;
    const m=v.state.doc.resolve(from).marks(),attrs=format.isInSet(m)?.attrs;
    const original=attrs?.originalField as Inline|undefined;
    const matches=fields.filter(f=>f.key===hit[1]);
    const field=original?.key===hit[1]&&matches.some(f=>f.scope===original?.scope)?original:matches.length===1?matches[0]:undefined;
    if(!field)return false;
    const part=field===original ? {...original,type:'field-ref'} : {id:crypto.randomUUID(),type:'field-ref',scope:field.scope,key:field.key};
    const atom=schema.node('field',{part},undefined,marks(undefined,attrs?.style));
    const tr=closeHistory(v.state.tr).insertText(text,from,to);
    v.dispatch(tr.replaceWith(start,from+text.length,atom));return true;
  },handleKeyDown(v,event){
    if(event.key!=='Backspace'||event.isComposing||!v.state.selection.empty)return false;
    const pos=v.state.selection.from,previous=v.state.selection.$from.nodeBefore;
    if(previous?.type!==schema.nodes.field)return false;
    const p=previous.attrs.part,style=format.isInSet(previous.marks)?.attrs.style;
    const raw=schema.text('{{'+p.key+'}',marks(undefined,style,p));
    event.preventDefault();v.dispatch(closeHistory(v.state.tr).replaceWith(pos-1,pos,raw));return true;
  },dispatchTransaction(tr){view.updateState(view.state.apply(tr));sync();if(tr.docChanged)onChange?.();}});
  function sync(){
    const sel=view.state.selection;
    const sample=sel instanceof NodeSelection?sel.node:sel.$from.nodeAfter??sel.$from.nodeBefore;
    const style=format.isInSet(sample?.marks??[])?.attrs.style;
    bold.setAttribute('aria-pressed',String(style?.bold??baseBold));
    if(document.activeElement!==size)size.value=String(style?.fontSizePt??baseSize);
  }
  function setStyle(patch:InlineStyle){
    const {from,to,empty}=view.state.selection;
    if(empty)return;
    const tr=closeHistory(view.state.tr);
    view.state.doc.nodesBetween(from,to,(node,pos)=>{
      if(!node.isInline||node.type===schema.nodes.br)return;
      let a=Math.max(pos,from),b=Math.min(pos+node.nodeSize,to);
      if(node.isText){
        const ends=[...new Intl.Segmenter('th',{granularity:'grapheme'}).segment(node.text!)].map(g=>pos+g.index).concat(pos+node.nodeSize);
        a=ends.filter(x=>x<=a).at(-1)??a;b=ends.find(x=>x>=b)??b;
      }
      const old=format.isInSet(node.marks)?.attrs;
      tr.addMark(a,b,format.create({...old,style:{...old?.style,...patch}}));
    });
    view.dispatch(tr);view.focus();
  }
  bold.onmousedown=e=>e.preventDefault();bold.onclick=()=>setStyle({bold:bold.getAttribute('aria-pressed')!=='true'});
  size.onchange=()=>{if(size.value&&size.reportValidity())setStyle({fontSizePt:size.valueAsNumber});};
  size.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();size.blur();view.focus();}};
  sync();
  function selectField(id:string){
    let found=false;
    view.state.doc.firstChild!.forEach((node,offset)=>{
      if(node.type===schema.nodes.field&&node.attrs.part.id===id){
        view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc,offset+1)));
        found=true;
      }
    });
    if(found)view.focus();
    return found;
  }
  return {view,sync,selectField,changed:()=>!view.state.doc.eq(state.doc),parts:()=>{
      const seen=new Set<string>(),result:Inline[]=[];
      view.state.doc.firstChild!.forEach(n=>{
        const a=format.isInSet(n.marks)?.attrs;
        const part:Inline=n.type===schema.nodes.field?{...n.attrs.part}:n.type===schema.nodes.br?{id:n.attrs.id,type:'line-break'}:{id:a?.id,type:'text',text:n.text!};
        if(!part.id||seen.has(part.id))part.id=crypto.randomUUID();seen.add(part.id);
        if(a?.style)part.styleOverride=a.style;else delete part.styleOverride;
        result.push(part);
      });
      return result;
  }};
}
