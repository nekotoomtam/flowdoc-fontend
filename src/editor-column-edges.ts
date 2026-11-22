/** Resize a shared boundary in screen pixels, preserving the pair's total layout weight. */
export function mountColumnEdges(frame:HTMLElement,weights:number[],selected:number,commit:(left:number,fraction:number)=>void,
  table?:{columns:HTMLTableColElement[][];linked:boolean}){
  const tableTotal=weights.reduce((sum,value)=>sum+value,0);
  const siblings=Array.from(frame.parentElement!.children) as HTMLElement[];
  const cleanups:(()=>void)[]=[];
  for(const left of [selected-1,selected]){
    if(left<0||left+1>=weights.length)continue;
    const first=siblings[left],second=siblings[left+1],total=weights[left]+weights[left+1];
    const initial=weights[left]/total;
    const edge=document.createElement('button');
    edge.type='button';edge.className='column-resize-edge';
    edge.dataset.edge=left===selected?'right':'left';
    edge.title='ลากเพื่อปรับความกว้างระหว่างคอลัมน์ '+(left+1)+' และ '+(left+2);
    if(table?.linked)edge.title+=' · ขยับหัวตารางพร้อมข้อมูล';
    edge.setAttribute('role','separator');edge.setAttribute('aria-orientation','vertical');edge.setAttribute('aria-label',edge.title);
    let start:{x:number;width:number;id:number}|undefined,fraction=initial;
    const update=()=>edge.setAttribute('aria-valuenow',String(Math.round(fraction*100)));
    const limit=(v:number,width:number)=>{
      const min=Math.min(initial,1-initial,8/width);
      return Math.max(min,Math.min(1-min,v));
    };
    function paint(value:number){
      const a=total*value,b=total-a;
      if(table){
        for(const cols of table.columns){
          cols[left].style.width=(a/tableTotal*100)+'%';
          cols[left+1].style.width=(b/tableTotal*100)+'%';
        }
      }else{
        first.style.flex=String(a);second.style.flex=String(b);
      }
    }
    function reset(){
      start=undefined;fraction=initial;
      paint(initial);
      edge.classList.remove('resizing');update();
    }
    const width=()=>table?(table.columns[0][left].getBoundingClientRect().width+table.columns[0][left+1].getBoundingClientRect().width)
      :first.getBoundingClientRect().width+second.getBoundingClientRect().width;
    edge.onpointerdown=e=>{
      if(e.button!==0||start)return;
      e.preventDefault();edge.focus({preventScroll:true});edge.setPointerCapture(e.pointerId);
      start={x:e.clientX,width:width(),id:e.pointerId};edge.classList.add('resizing');
    };
    edge.onpointermove=e=>{
      if(!start||start.id!==e.pointerId||!start.width)return;
      fraction=limit(initial+(e.clientX-start.x)/start.width,start.width);
      paint(fraction);update();
    };
    edge.onpointerup=e=>{
      if(!start||e.pointerId!==start.id)return;
      const next=fraction;reset();if(next!==initial)commit(left,next);
    };
    edge.onlostpointercapture=edge.onpointercancel=()=>{if(start)reset();};
    edge.onkeydown=e=>{
      if(e.key==='Escape'&&start){e.preventDefault();e.stopPropagation();reset();return;}
      if(start||!['ArrowLeft','ArrowRight'].includes(e.key))return;
      e.preventDefault();e.stopPropagation();
      const next=limit(initial+(e.key==='ArrowLeft'?-.01:.01),width());
      if(next!==initial){
        commit(left,next);
        frame.ownerDocument.querySelector<HTMLElement>('.node-selected-frame>.column-resize-edge[data-edge="'+edge.dataset.edge+'"]')?.focus({preventScroll:true});
      }
    };
    edge.onclick=e=>e.stopPropagation();
    update();frame.append(edge);cleanups.push(()=>{if(start)reset();edge.remove();});
  }
  return ()=>cleanups.forEach(fn=>fn());
}
