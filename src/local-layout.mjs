import {documentFlow,scriptSpans,decodeShape,cacheTextRuntime} from './vendor/core-layout.mjs';
import {projectLayout} from './engine-layout.mjs';
import init,{TextRuntime} from './vendor/flowdoc_spike_text.js';

export async function createLocalLayout(){
  await init({module_or_path:'/wasm/flowdoc_spike_text_bg.wasm'});
  const [light,regular,base,fixture]=await Promise.all([
    fetch('/font-300.ttf').then(r=>r.arrayBuffer()),fetch('/font-400.ttf').then(r=>r.arrayBuffer()),
    fetch('/spike-resolved.json').then(r=>r.json()),fetch('/spike-fonts.json').then(r=>r.json()),
  ]);
  for(const [i,bytes] of [light,regular].entries()){
    const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
    if(hash!==fixture.faces[i].sha256)throw Error('Font hash differs from native Engine fixture');
  }
  const native=new TextRuntime(new Uint8Array(light),new Uint8Array(regular));
  const fonts=new Map(fixture.faces.map((f,i)=>[f.weight,`library-${fixture.releaseId}-00000000-0000-4000-8000-${String(i+1).padStart(12,'0')}-${f.sha256}`]));
  const runtime=cacheTextRuntime({
    fontId:style=>{const id=fonts.get(style.font.weight);if(!id)throw Error('Unsupported font in fixed UAT fixture');return id},
    breaks:async text=>Array.from(native.breaks(text)),
    async shape(text,fontId,sizePt){
      const spans=scriptSpans(text),shapes=[];
      for(const span of spans){
        const raw=JSON.parse(native.shape(span.text,fontId===fonts.get(300)?300:400));
        if(raw.glyphs.some(g=>g.glyphId===0))throw Error('Font glyph missing');
        shapes.push(decodeShape(raw,span.text,sizePt));
      }
      if(shapes.length===1)return shapes[0];
      const combined={glyphs:[],ascentPt:0,descentPt:0,inkLeftPt:0,inkRightPt:0,glyphInkBoundsPt:[]};
      let cursor=0;
      for(let i=0;i<shapes.length;i++){
        const shape=shapes[i],span=spans[i];
        combined.ascentPt=Math.max(combined.ascentPt,shape.ascentPt);
        combined.descentPt=Math.max(combined.descentPt,shape.descentPt);
        combined.inkLeftPt=Math.min(combined.inkLeftPt,cursor+shape.inkLeftPt);
        combined.inkRightPt=Math.max(combined.inkRightPt,cursor+shape.inkRightPt);
        combined.glyphs.push(...shape.glyphs.map(g=>({...g,clusterStartOffset:g.clusterStartOffset+span.start,clusterEndOffset:g.clusterEndOffset+span.start})));
        combined.glyphInkBoundsPt.push(...shape.glyphInkBoundsPt);
        cursor+=shape.glyphs.reduce((sum,g)=>sum+g.advancePt,0);
      }
      return combined;
    },
  });
  const bindings=Object.entries(base.sourceMap).filter(([,s])=>s.sourceId==='v15'&&s.groupIndex===0&&s.areaEntryIndex===0).map(([id,s])=>({id,member:s.itemIndex}));
  return async request=>{
    const started=performance.now();
    const doc=structuredClone(base);
    for(const {id,member} of bindings){
      const text=request.sections[0].data.parts[0].data.groups[0].members[member].menu;
      doc.nodes[id].children=[{...doc.nodes[id].children[0],text}];
    }
    const draw=await documentFlow(doc,runtime,{});
    return {layout:projectLayout(draw,doc.sourceMap,request),pageCount:draw.pages.length,engineMs:performance.now()-started,source:'Core 0.5.5 layout + rustybuzz 0.20.1 / ICU4X 2.2.0 WASM'};
  };
}
