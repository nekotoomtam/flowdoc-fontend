import {getDocument,GlobalWorkerOptions} from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?worker&url';
GlobalWorkerOptions.workerSrc=workerUrl;

export async function renderComparison(container:HTMLElement,entries:{version:number;pdf:string}[],register:(dispose:()=>void)=>void){
  const tasks=entries.map(entry=>getDocument({data:Uint8Array.from(atob(entry.pdf),c=>c.charCodeAt(0))}));
  const urls:string[]=[];
  register(()=>{for(const url of urls)URL.revokeObjectURL(url);for(const task of tasks)void task.destroy();});
  const docs=await Promise.all(tasks.map(task=>task.promise));
  if(!container.isConnected)return;
  const count=Math.max(...docs.map(doc=>doc.numPages));
  const nav=document.createElement('nav'),label=document.createElement('span');
  const prev=document.createElement('button'),next=document.createElement('button');
  prev.textContent='หน้าก่อน';next.textContent='หน้าถัดไป';
  nav.className='srs-page-nav';nav.append(prev,label,next);
  const slots=entries.map((entry,i)=>{
    const side=document.createElement('section'),heading=document.createElement('h3'),surface=document.createElement('div'),link=document.createElement('a');
    heading.textContent=(i?'กำลังเลือก':'ระบบรับงานใช้')+' · รุ่น '+entry.version;
    const url=URL.createObjectURL(new Blob([Uint8Array.from(atob(entry.pdf),c=>c.charCodeAt(0))],{type:'application/pdf'}));
    urls.push(url);link.href=url;link.target='_blank';link.rel='noopener';link.textContent='เปิด PDF รุ่น '+entry.version;
    side.append(heading,surface,link);container.append(side);return surface;
  });
  container.prepend(nav);
  async function show(index:number){
    prev.disabled=next.disabled=true;
    await Promise.all(docs.map(async(doc,i)=>{
      if(index>doc.numPages){slots[i].textContent='รุ่นนี้จบที่หน้า '+doc.numPages;return;}
      const page=await doc.getPage(index);
      const viewport=page.getViewport({scale:1.6}),canvas=document.createElement('canvas');
      canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
      canvas.setAttribute('aria-label','รุ่น '+entries[i].version+' หน้า '+index);
      await page.render({canvas,viewport}).promise;
      slots[i].replaceChildren(canvas);
    }));
    label.textContent='หน้า '+index+' / '+count;
    prev.disabled=index===1;next.disabled=index===count;
    const move=(to:number)=>void show(to).catch(()=>{if(container.isConnected)label.textContent='โหลดหน้าไม่สำเร็จ';});
    prev.onclick=()=>move(index-1);next.onclick=()=>move(index+1);
  }
  await show(1);
}


