type Box={xPt:number;yPt:number;widthPt:number;heightPt:number};
type Ink=Box&{sourceId?:string;text:string;color:string;scale:number;glyphUses:[string,number,number][];edit?:{key:string;blank:boolean;contentWidth?:number}};
export type Paper={version:number;pageCount:number;pageIndex:number;editable:string[];omitted?:(string|number)[][];payload?:unknown;page:{
  widthPt:number;heightPt:number;backgroundColor:string;glyphs:Record<string,string>;lines:Ink[];
  fills?:Array<Box&{color:string}>; borders?:Array<{x1Pt:number;y1Pt:number;x2Pt:number;y2Pt:number;widthPt:number;color:string;style?:string}>;
}};
function node<K extends keyof HTMLElementTagNameMap>(tag:K,value=''){
  const el=document.createElement(tag);el.textContent=value;return el;
}
function svg<K extends keyof SVGElementTagNameMap>(tag:K,attrs:Record<string,string|number>){
  const el=document.createElementNS('http://www.w3.org/2000/svg',tag);
  for(const [key,value] of Object.entries(attrs))el.setAttribute(key,String(value));
  return el;
}
const ink=(v:string)=>v?.startsWith('#')?v:'#'+(v||'ffffff');

export type ReviewPoint={kind:string;label:string;ids:string[]};
export function paperView(p:Paper,index:number,select:(key:string)=>void,review?:{heading:string;points:ReviewPoint[];pick:(kind:string)=>void}){
  const section=node('section'),page=p.page;
  section.append(node('h3',(review?review.heading:(index?'กำลังเลือก':'ระบบรับงานใช้')+' · รุ่น '+p.version)+'　หน้า '+(p.pageIndex+1)+'/'+p.pageCount));
  const viewport=node('div');viewport.className='compare-viewport';
  const sheet=svg('svg',{viewBox:'0 0 '+page.widthPt+' '+page.heightPt,role:'group','aria-label':'กระดาษรุ่น '+p.version});
  const defs=svg('defs',{}),prefix='baseline-'+index+'-';
  for(const [id,d] of Object.entries(page.glyphs))defs.append(svg('path',{id:prefix+id,d}));
  sheet.append(defs,svg('rect',{width:page.widthPt,height:page.heightPt,fill:ink(page.backgroundColor)}));
  for(const f of page.fills??[])sheet.append(svg('rect',{x:f.xPt,y:f.yPt,width:f.widthPt,height:f.heightPt,fill:ink(f.color)}));
  for(const b of page.borders??[])sheet.append(svg('line',{x1:b.x1Pt,y1:b.y1Pt,x2:b.x2Pt,y2:b.y2Pt,stroke:ink(b.color),'stroke-width':b.widthPt,'stroke-dasharray':b.style==='dashed'?'4 3':b.style==='dotted'?'1 2':'none'}));
  for(const line of page.lines){
    const point=review?.points.find(change=>line.sourceId&&change.ids.includes(line.sourceId));
    if(point&&review){
      const box=svg('rect',{x:line.xPt-1,y:line.yPt,width:Math.max(20,line.edit?.contentWidth??line.widthPt)+2,height:Math.max(line.heightPt,10),role:'button',tabindex:0,'aria-label':point.label});
      box.dataset.reviewPoint=point.kind;box.setAttribute('class','review-mark');
      box.onclick=()=>review.pick(point.kind);
      box.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();review.pick(point.kind);}};
      sheet.append(box);
    }
    const editable=index===1&&line.edit&&p.editable.includes(line.edit.key);
    if(editable&&line.edit){
      const key=line.edit.key,empty=line.edit.blank;
      const rect=svg('rect',{x:line.xPt,y:line.yPt,width:Math.max(12,line.edit.contentWidth??line.widthPt),height:Math.max(10,line.heightPt),role:'button',tabindex:0,'aria-label':(empty?'ช่องว่าง ':'แก้ค่าทดลอง ')+JSON.parse(key).at(-1)});
      rect.setAttribute('class',empty?'compare-missing':'compare-filled');
      if(empty)rect.dataset.emptyField=key;
      rect.onclick=()=>select(key);
      rect.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();select(key);}};
      sheet.append(rect);
    }
    const run=svg('g',{'aria-label':line.text,fill:ink(line.color),'pointer-events':'none'});
    for(const [id,x,y] of line.glyphUses)run.append(svg('use',{href:'#'+prefix+id,transform:'translate('+x+' '+y+') scale('+line.scale+' -'+line.scale+')'}));
    sheet.append(run);
  }
  viewport.append(sheet);section.append(viewport);return section;
}

export function baselineCompare(container:HTMLElement,url:string,state:{pinned:number|null;versions:number[]},version:number,
 signal:AbortSignal,onReady:(ready:boolean)=>void){
  const edits:Record<string,string>={};
  let request=0,pageIndex=0;
  const status=node('p');status.setAttribute('role','status');
  const papers=node('div');papers.className='compare-papers';
  const form=node('form');form.hidden=true;
  const label=node('label'),input=node('input'),send=node('button','ลองบนกระดาษ');
  input.id='compare-value';input.maxLength=2000;label.htmlFor=input.id;send.id='compare-submit';
  form.append(label,input,send);
  const warning=node('aside');warning.className='compare-warning';warning.hidden=true;
  const details=node('details'),payload=node('pre');
  details.append(node('summary','ดูข้อมูลที่จะส่งให้รุ่น '+version),payload);details.hidden=true;
  const nav=node('div');let selected='';
  function select(key:string){
    selected=key;label.textContent='ค่าทดลอง · '+JSON.parse(key).at(-1);input.value=edits[key]??'';
    form.hidden=false;input.focus();
  }
  async function render(){
    const seq=++request;
    onReady(false);send.disabled=true;status.textContent='กำลังจัดหน้าจากรุ่นที่เผยแพร่…';
    try{
      const response=await fetch(url+'/compare-baseline',{method:'POST',signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({version,pinned:state.pinned,latest:state.versions[0],pageIndex,edits})});
      if(!response.ok)throw Error(response.status===409?'รุ่นที่ใช้งานเปลี่ยนแล้ว กรุณาเปิดรายละเอียดใหม่':'จัดหน้าข้อมูลตัวอย่างไม่ได้');
      const result=await response.json() as {papers:Paper[]};
      if(signal.aborted||seq!==request)return;
      papers.replaceChildren(...result.papers.map((p,i)=>paperView(p,i,select)));
      const target=result.papers[1];
      const omitted=target.omitted??[];
      warning.hidden=!omitted.length;
      if(omitted.length){
        const fields=[...new Set(omitted.map(p=>p.filter(k=>typeof k==='string').slice(2).join('.')||p.at(-1)))];
        warning.replaceChildren(node('strong','ข้อมูลเดิมมีช่องที่รุ่น '+version+' ไม่รับ'),node('div',fields.join(' · ')),
          node('small','กระดาษฝั่งขวาทดลองด้วยข้อมูลที่ตัดช่องเหล่านี้ออก ผู้เรียก API ต้องปรับข้อมูลก่อนใช้รุ่นนี้'));
      }
      details.hidden=!target.payload;payload.textContent=JSON.stringify(target.payload,null,2);
      const blanks=target.page.lines.filter(l=>l.edit?.blank&&target.editable.includes(l.edit.key));
      status.textContent=blanks.length?'ข้อมูลเดิมขาด '+[...new Set(blanks.map(l=>JSON.parse(l.edit!.key).at(-1)))].join(', ')+' · กดช่องสีส้มบนกระดาษเพื่อทดลองเติมค่า':Object.keys(edits).length?'แสดงค่าทดลองบนกระดาษแล้ว':'หน้านี้ไม่มีช่องรายการว่างที่ต้องเติม';
      nav.replaceChildren();const count=Math.max(...result.papers.map(p=>p.pageCount));
      if(count>1)for(const step of [-1,1]){
        const button=node('button',step<0?'หน้าก่อน':'หน้าถัดไป');button.disabled=pageIndex+step<0||pageIndex+step>=count;
        button.onclick=()=>{pageIndex+=step;form.hidden=true;void render();};nav.append(button);
      }
      input.disabled=false;send.disabled=false;onReady(true);
    }catch(error){if(!signal.aborted&&seq===request){status.textContent=error instanceof Error?error.message:'ลองข้อมูลไม่สำเร็จ';input.disabled=false;send.disabled=false;}}
  }
  input.oninput=()=>onReady(false);
  form.onsubmit=e=>{e.preventDefault();edits[selected]=input.value;input.disabled=true;void render();};
  nav.className='srs-page-nav';container.replaceChildren(warning,status,nav,papers,form,details);void render();
}
