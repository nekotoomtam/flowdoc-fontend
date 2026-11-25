import type {Definition} from './editor-structure';

type Face={releaseId:string;familyName:string;version:number;faces:{weight:number;style:string}[]};
type LibraryFace={kind:'library';releaseId:string;weight:number;style:string}|{kind:'unselected'};
type TextStyle={fontFamilyKey?:string;fontWeight?:string;fontStyle?:string;font?:LibraryFace;fontSize:{unit:'pt';value:number};lineHeightPt:number};
type Context={definition:()=>Definition;styleId:()=>string|undefined;locked:()=>boolean;
  assign:(key:string)=>void;apply:(styles:Record<string,unknown>)=>void;fonts:()=>Promise<Face[]>};
const titles:Record<string,string>={body:'เนื้อหา',emphasis:'ข้อความเน้น',footer:'ท้ายกระดาษ',gap:'ระยะเว้น'};
const title=(id:string)=>Object.hasOwn(titles,id)?titles[id]:id;
const get=<T extends HTMLElement>(id:string)=>document.getElementById(id)! as T;

export function installTemplateStyles(ctx:Context){
  const pane=get('shared-styles'),panel=pane.parentElement!,list=get('shared-style-list');
  const local=get<HTMLSelectElement>('paragraph-style'),face=get<HTMLSelectElement>('style-face');
  const form=get<HTMLFormElement>('shared-style-form'),size=get<HTMLInputElement>('style-size'),leading=get<HTMLInputElement>('style-leading');
  const btn=get<HTMLButtonElement>('styles-view'),item=get<HTMLButtonElement>('item-view');
  let active='',rendered:Definition|undefined,optionsFor:unknown,open=false,generation=0;
  function selectStyle(id:string){
    const style=ctx.definition().styles[id] as TextStyle;
    active=id;optionsFor=style;
    for(const entry of list.querySelectorAll('button'))entry.setAttribute('aria-pressed',String(entry.dataset.styleId===id));
    get('style-title').textContent=title(id);
    size.value=String(style.fontSize.value);leading.value=String(style.lineHeightPt);
    face.replaceChildren();
    const add=(label:string,value:Partial<TextStyle>)=>{
      const option=new Option(label,JSON.stringify(value));face.add(option);return option;
    };
    if(style.fontFamilyKey==='sarabun'){
      for(const weight of ['normal','bold'])for(const slant of ['normal','italic']){
        const op=add('Sarabun · '+(weight==='bold'?'หนา':'ปกติ')+(slant==='italic'?' เอียง':''),{fontFamilyKey:'sarabun',fontWeight:weight,fontStyle:slant});
        op.selected=weight===style.fontWeight&&slant===(style.fontStyle??'normal');
      }
    }else add(style.font?.kind==='library'?'ฟอนต์ที่ใช้อยู่ · '+style.font.weight:'ยังไม่เลือกฟอนต์',{font:style.font});
    const token=++generation;
    void ctx.fonts().then(fonts=>{
      if(token!==generation)return;
      for(const f of fonts)for(const v of f.faces){
        const op=add(f.familyName+' · '+v.weight+(v.style==='italic'?' เอียง':''),{font:{kind:'library',releaseId:f.releaseId,...v}});
        if(style.font?.kind==='library'&&style.font.releaseId===f.releaseId&&style.font.weight===v.weight&&style.font.style===v.style)op.selected=true;
      }
    });
  }
  function refresh(){
    const def=ctx.definition(),id=ctx.styleId(),locked=ctx.locked();
    get('paragraph-style-choice').hidden=!id;local.disabled=locked;
    form.querySelector('fieldset')!.disabled=locked;
    if(def!==rendered){
      rendered=def;local.replaceChildren();list.replaceChildren();
      const counts=new Map<string,number>();
      const hosts=[...def.sections.flatMap(s=>[s.source,s.header,s.footer]),...Object.values(def.areaFormats??{})];
      for(const host of hosts)for(const node of Object.values(host?.fragment?.nodes??{})){
        if(node.type!=='text-block')continue;
        const uses=new Set([node.props?.textStyleId,...(node.children??[]).map(c=>c.textStyleId)]);
        for(const key of uses)if(key)counts.set(key,(counts.get(key)??0)+1);
      }
      for(const [key,value] of Object.entries(def.styles)){
        const style=value as TextStyle,entry=document.createElement('button'),sample=document.createElement('span'),count=document.createElement('small');
        entry.type='button';entry.dataset.styleId=key;entry.title=key;
        sample.textContent=title(key);sample.style.fontSize=style.fontSize.value+'pt';
        sample.style.fontWeight=style.font?.kind==='library'?String(style.font.weight):style.fontWeight??'normal';
        sample.style.fontStyle=style.font?.kind==='library'?style.font.style:style.fontStyle??'normal';
        count.textContent=(counts.get(key)??0)+' กล่อง';
        entry.setAttribute('aria-label',title(key)+' · '+count.textContent);
        entry.append(sample,count);entry.onclick=()=>selectStyle(key);list.append(entry);
        local.add(new Option(title(key),key));
      }
      optionsFor=undefined;
    }
    if(id)local.value=id;
    if(open){
      const key=Object.hasOwn(def.styles,active)?active:id??Object.keys(def.styles)[0];
      if(key&&optionsFor!==def.styles[key])selectStyle(key);
    }
  }
  function switchView(on:boolean,key?:string){
    open=on;
    if(key&&key!==active){active=key;optionsFor=undefined;}
    panel.classList.toggle('show-template-styles',on);pane.hidden=!on;
    item.setAttribute('aria-pressed',String(!on));btn.setAttribute('aria-pressed',String(on));
    refresh();
  }
  btn.onclick=()=>switchView(true);item.onclick=()=>switchView(false);
  local.onchange=()=>{if(!ctx.locked())ctx.assign(local.value);};
  get('edit-used-style').onclick=()=>switchView(true,ctx.styleId());
  form.onsubmit=e=>{
    e.preventDefault();if(ctx.locked()||!form.reportValidity()||!active)return;
    const def=ctx.definition();
    const updated={...def.styles[active] as TextStyle};
    delete updated.font;delete updated.fontFamilyKey;delete updated.fontWeight;delete updated.fontStyle;
    Object.assign(updated,JSON.parse(face.value),{fontSize:{value:size.valueAsNumber,unit:'pt'},lineHeightPt:leading.valueAsNumber});
    ctx.apply({...def.styles,[active]:updated});
  };
  return refresh;
}
