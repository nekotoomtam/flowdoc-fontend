import type {Definition} from './editor-structure';

type Face={releaseId:string;familyName:string;version:number;faces:{weight:number;style:string}[]};
type LibraryFace={kind:'library';releaseId:string;weight:number;style:string}|{kind:'unselected'};
type TextStyle={color?:string;underline?:boolean;fontFamilyKey?:string;fontWeight?:string;fontStyle?:string;font?:LibraryFace;fontSize:{unit:'pt';value:number};lineHeightPt:number};
type Context={definition:()=>Definition;styleId:()=>string|undefined;locked:()=>boolean;
  assign:(key:string)=>void;apply:(styles:Record<string,unknown>)=>void;fonts:()=>Promise<Face[]>};
const titles:Record<string,string>={body:'เนื้อหา',emphasis:'ข้อความเน้น',footer:'ท้ายกระดาษ',gap:'ระยะเว้น'};
const title=(id:string)=>Object.hasOwn(titles,id)?titles[id]:id;
const get=<T extends HTMLElement>(id:string)=>document.getElementById(id)! as T;

export function installTemplateStyles(ctx:Context){
  const pane=get('shared-styles'),panel=pane.parentElement!,list=get('shared-style-list');
  const local=get<HTMLSelectElement>('paragraph-style');
  const form=get<HTMLFormElement>('shared-style-form'),size=get<HTMLInputElement>('style-size'),leading=get<HTMLInputElement>('style-leading');
  const btn=get<HTMLButtonElement>('styles-view'),item=get<HTMLButtonElement>('item-view');
  let active='',rendered:Definition|undefined,optionsFor:unknown,open=false,generation=0;
  const family=get<HTMLSelectElement>('style-family'),weight=get<HTMLSelectElement>('style-weight');
  const bold=get<HTMLButtonElement>('style-bold'),italic=get<HTMLButtonElement>('style-italic');
  type Choice={weight:number;style:string;props:Partial<TextStyle>};
  const families=new Map<string,Choice[]>();
  let picked:Choice;
  function paintFace(){
    const choices=families.get(family.value)??[];
    const weights=choices.filter(c=>c.style===picked.style).sort((a,b)=>a.weight-b.weight);
    const alternative=picked.weight>=700
      ?weights.find(c=>c.weight===400)??weights.filter(c=>c.weight<700).at(-1)
      :weights.find(c=>c.weight>=700);
    const slant=choices.find(c=>c.weight===picked.weight&&c.style!==picked.style);
    bold.hidden=!alternative;italic.hidden=!slant;
    bold.setAttribute('aria-pressed',String(picked.weight>=700));
    italic.setAttribute('aria-pressed',String(picked.style==='italic'));
    bold.onclick=()=>{if(alternative){picked=alternative;paintFace();}};
    italic.onclick=()=>{if(slant){picked=slant;paintFace();}};
    weight.replaceChildren(...weights.map(c=>new Option(String(c.weight),String(c.weight))));
    weight.value=String(picked.weight);
    get('style-weight-label').hidden=weights.length<2||weights.every(c=>c.weight===400||c.weight===700);
    weight.onchange=()=>{picked=weights.find(c=>String(c.weight)===weight.value)!;paintFace();};
  }
  family.onchange=()=>{
    const faces=families.get(family.value)!;
    picked=faces.find(c=>c.weight===picked.weight&&c.style===picked.style)
      ??faces.find(c=>c.weight===400&&c.style==='normal')??faces[0];
    paintFace();
  };
  const ink=get<HTMLInputElement>('style-color'),line=get<HTMLButtonElement>('style-underline');
  line.onclick=()=>line.setAttribute('aria-pressed',String(line.getAttribute('aria-pressed')!=='true'));
  function selectStyle(id:string){
    const style=ctx.definition().styles[id] as TextStyle;
    active=id;optionsFor=style;
    for(const entry of list.querySelectorAll('button'))entry.setAttribute('aria-pressed',String(entry.dataset.styleId===id));
    get('style-title').textContent=title(id);
    size.value=String(style.fontSize.value);leading.value=String(style.lineHeightPt);
    ink.value="#"+(style.color??"000000");ink.dispatchEvent(new Event("ink-sync"));line.setAttribute("aria-pressed",String(!!style.underline));
    family.replaceChildren();families.clear();
    if(style.fontFamilyKey==='sarabun'){
      const choices:Choice[]=[];
      for(const weight of ['normal','bold'])for(const slant of ['normal','italic']){
        choices.push({weight:weight==='bold'?700:400,style:slant,props:{fontFamilyKey:'sarabun',fontWeight:weight,fontStyle:slant}});
      }
      family.add(new Option('Sarabun','legacy'));families.set('legacy',choices);
      picked=choices.find(c=>c.props.fontWeight===style.fontWeight&&c.style===(style.fontStyle??'normal'))!;
    }else{
      const f=style.font;
      const key=f?.kind==='library'?f.releaseId:'unselected';
      picked={weight:f?.kind==='library'?f.weight:400,style:f?.kind==='library'?f.style:'normal',props:{font:f}};
      family.add(new Option(f?.kind==='library'?'ฟอนต์ที่ใช้อยู่':'ยังไม่เลือกฟอนต์',key));
      families.set(key,[picked]);
    }
    paintFace();
    const token=++generation;
    void ctx.fonts().then(fonts=>{
      if(token!==generation)return;
      for(const f of fonts){
        if(!f.faces.length)continue;
        const choices=f.faces.map(v=>({...v,props:{font:{kind:'library' as const,releaseId:f.releaseId,...v}}}));
        const option=[...family.options].find(o=>o.value===f.releaseId)??new Option('',f.releaseId);
        option.text=f.familyName+' · '+f.version;
        if(!option.parentElement)family.add(option);
        families.set(f.releaseId,choices);
      }
      paintFace();
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
        if(style.color)sample.style.color='#'+style.color;
        if(style.underline)sample.style.textDecoration='underline';
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
    Object.assign(updated,picked.props,{fontSize:{value:size.valueAsNumber,unit:'pt'},lineHeightPt:leading.valueAsNumber});
    if(ink.value!=='#000000')updated.color=ink.value.slice(1).toUpperCase();else delete updated.color;
    if(line.getAttribute('aria-pressed')==='true')updated.underline=true;else delete updated.underline;
    ctx.apply({...def.styles,[active]:updated});
  };
  return refresh;
}
