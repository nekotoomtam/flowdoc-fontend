import {markBlankRuns,previewInput,trialBindings} from '../scripts/trial-preview-bindings.mjs';
import {projectTrialPage,trialFocusPage} from '../scripts/trial-preview-projection.mjs';
import {createPreviewQueue} from './preview-worker-queue.mjs';
import {trialValueChanges} from '../scripts/trial-value-delta.mjs';

const encoder=new TextEncoder();
const digest=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),
  byte=>byte.toString(16).padStart(2,'0')).join('');
const hash=text=>digest(encoder.encode(text));
// Face identities for the two hash-pinned assets in spike-fonts.json.
const faceIds={300:'d7affc93-8c40-4e13-aa83-81028791574e',400:'572b838a-08a1-4e24-85cf-e08b3d319d1b'};
async function fetchAsset(path){
  const response=await fetch(path);
  if(!response.ok)throw Error('Browser Engine asset unavailable');
  return response;
}
let assets;
function loadAssets(){
  return assets??=(async()=>{
    const root=new URL('/worker-engine/',self.location.origin);
    const coreUrl=new URL('core.mjs',root).href,wasmUrl=new URL('flowdoc_text_engine.js',root).href;
    const [core,wasm,fixture,outlines]=await Promise.all([
      import(/* @vite-ignore */ coreUrl),import(/* @vite-ignore */ wasmUrl),
      fetchAsset('/spike-fonts.json').then(r=>r.json()),fetchAsset(new URL('outlines.json',root)).then(r=>r.json()),
    ]);
    await wasm.default({module_or_path:new URL('flowdoc_text_engine_bg.wasm',root)});
    const fonts=await Promise.all([...fixture.faces].sort((a,b)=>b.weight-a.weight).map(async face=>{
      const bytes=await fetchAsset('/font-'+face.weight+'.ttf').then(r=>r.arrayBuffer());
      if(await digest(bytes)!==face.sha256)throw Error('Browser Engine font does not match the pinned fixture');
      return {id:'library-'+fixture.releaseId+'-'+faceIds[face.weight]+'-'+face.sha256,
        sha256:face.sha256,selection:{releaseId:fixture.releaseId,weight:face.weight,style:'normal'},
        bytes:new Uint8Array(bytes),outline:outlines[face.weight]};
    }));
    return {core,wasm,fonts};
  })();
}
function textRuntime({core,wasm,fonts},signal){
  const runtime=new Map(fonts.map(font=>[font.id,new wasm.FontTextRuntime(font.bytes)]));
  return {
    fontId:style=>core.selectFont(style,fonts).id,
    async breaks(text){
      signal.throwIfAborted();
      return Array.from(runtime.get(fonts[0].id).breaks(text));
    },
    async shape(text,fontId,size){
      signal.throwIfAborted();
      const spans=core.scriptSpans(text),native=runtime.get(fontId);
      const shapes=spans.map(({text})=>{
        const raw=JSON.parse(native.shape(text));
        if(raw.glyphs.some(glyph=>glyph.glyphId===0))throw Error('FONT_GLYPH_MISSING');
        return core.decodeShape(raw,text,size);
      });
      if(shapes.length===1)return shapes[0];
      const combined={glyphs:[],ascentPt:0,descentPt:0,inkLeftPt:0,inkRightPt:0,glyphInkBoundsPt:[]};
      let cursor=0;
      for(const [index,shape] of shapes.entries()){
        const start=spans[index].start;
        combined.ascentPt=Math.max(combined.ascentPt,shape.ascentPt);
        combined.descentPt=Math.max(combined.descentPt,shape.descentPt);
        combined.inkLeftPt=Math.min(combined.inkLeftPt,cursor+shape.inkLeftPt);
        combined.inkRightPt=Math.max(combined.inkRightPt,cursor+shape.inkRightPt);
        for(const glyph of shape.glyphs)combined.glyphs.push({...glyph,
          clusterStartOffset:glyph.clusterStartOffset+start,clusterEndOffset:glyph.clusterEndOffset+start});
        combined.glyphInkBoundsPt.push(...shape.glyphInkBoundsPt);
        cursor+=shape.glyphs.reduce((total,glyph)=>total+glyph.advancePt,0);
      }
      return combined;
    },
    async close(){for(const font of runtime.values())font.free();runtime.clear();},
  };
}
const channel=new MessageChannel();
let resume;
channel.port1.onmessage=()=>resume?.();
const yieldTask=()=>new Promise(resolve=>{resume=resolve;channel.port2.postMessage(null);});
const take=result=>{
  if(!result.ok)throw Error(result.issues.map(issue=>issue.code+' '+issue.path).slice(0,4).join(' / '));
  return result.value;
};
let draft,runner,lastComplete;
const runs=new Map();
const knownPages=new Map();
function remember(index){
  knownPages.delete(index);
  knownPages.set(index,true);
  if(knownPages.size>24)knownPages.delete(knownPages.keys().next().value);
}
function pageKey(cache,index,layout=JSON.stringify(cache.draw.pages[index])){
  const page=cache.draw.pages[index],bindings=cache.bindings;
  let source=layout;
  for(const [lineIndex,command] of page.commands.entries()){
    const edit=bindings.lines.get(command);
    if(edit)source+=JSON.stringify([lineIndex,edit,bindings.tab.get(edit.occurrence)]);
  }
  return hash(source);
}
function paperInk(page){
  return JSON.stringify([page.widthPt,page.heightPt,page.backgroundColor,page.borders,page.fills,page.sampleImages,
    page.glyphs,page.lines.map(({edit,...line})=>line)]);
}
function watchEditingPage(revision,trial,definition,document,sample,paths){
  const {focus}=trial,base=lastComplete;
  if(!focus||!base||trialValueChanges(base.trial,trial,{has:key=>key===focus.key})?.length!==1)return;
  // A repeated member's value has a single body owner. A shared field could
  // affect another page or page band before this page has been closed.
  if(!Number.isInteger(document.sourceMap[focus.occurrence]?.itemIndex))return;
  const old=base.bindings.locations.get(focus.key)??[];
  if(!old.length||old.some(hit=>hit.occurrence!==focus.occurrence)||!base.draw.pages[old[0].pageIndex].commands.some(command=>
    base.bindings.lines.get(command)?.occurrence===focus.occurrence&&base.bindings.lines.get(command).contentWidth>0))return;
  const firstOld=old[0].pageIndex,lastOld=old.at(-1).pageIndex;
  if(lastOld-firstOld>2)return;
  let published,caretPage;
  return {
    get published(){return published;},
    closed(draw){
      if(published)return;
      const index=draw.pages.length-1;
      if(index<firstOld-1||index>lastOld+2)return;
      if(caretPage===undefined&&!draw.pages[index].commands.some(line=>line.nodeId===focus.occurrence))return;
      const bindings=trialBindings(definition,document,sample,draw,focus.occurrence);
      const positions=(bindings.locations.get(focus.key)??[]).filter(hit=>hit.occurrence===focus.occurrence);
      const match=positions.find(hit=>hit.pageIndex===focus.pageIndex&&hit.start<=focus.offset&&focus.offset<=hit.end)
        ??positions.find(hit=>hit.start<=focus.offset&&focus.offset<=hit.end);
      if(!match)return;
      caretPage=match.pageIndex;
      const first=Math.min(firstOld,positions[0].pageIndex),last=Math.max(lastOld,caretPage);
      if(last>index||last-first>2)return;
      const pages=[];
      for(let pageIndex=first;pageIndex<=last;pageIndex++){
        const page=draw.pages[pageIndex],previous=base.draw.pages[pageIndex];
        if(!previous||page.pageRole!==previous.pageRole||page.sectionId!==previous.sectionId||page.sectionPageIndex!==previous.sectionPageIndex||
          page.widthPt!==previous.widthPt||page.heightPt!==previous.heightPt||
          draw.contentsSlots?.some(slot=>slot.pageIndex===pageIndex))return;
        const slots=[...(draw.pageFieldSlots??[]),...(draw.pageTexts??[])].filter(slot=>slot.pageIndex===pageIndex);
        const footer=previous.commands.filter(command=>command.id.startsWith('system-page-'));
        const visible=previous.pageNumbering?.visibility!=='hide';
        if(visible&&(slots.length!==footer.length||slots.some((slot,i)=>(slot.nodeId??slot.node.id)!==footer[i].nodeId)))return;
        // Page totals need the whole document. Hold the committed system fields
        // while showing the newly closed body from this same Engine.
        const snapshot={...page,commands:[...page.commands,...footer],pageNumbering:previous.pageNumbering,
          countedPageNumber:previous.countedPageNumber};
        pages.push([pageIndex,projectTrialPage({draw:{pages:[snapshot]},bindings,paths,fonts:Object.keys(paths)},0)]);
      }
      published=new Map(pages.map(([pageIndex,page])=>[pageIndex,paperInk(page)]));
      self.postMessage({kind:'editing-pages',revision,focusPage:caretPage,pages});
    },
  };
}
async function layout({revision,trial}){
  const started=performance.now(),asset=await loadAssets();
  const {definition,fingerprint}=draft,{core,fonts}=asset;
  runner??=new core.LatestLayoutJobs(signal=>textRuntime(asset,signal),{reuseRuntime:true,reuseFlow:true,lineCacheScope:fingerprint});
  const sample={docKey:definition.docKey,version:definition.version,data:trial.data,sections:trial.sections};
  const template={definition,fingerprint};
  const {input,marks}=previewInput(sample,trial.blanks);
  const document=take(core.composeDocument(template,take(core.prepareGeneration(template,input))));
  markBlankRuns(document,marks);
  const paths=Object.fromEntries(fonts.map(font=>[font.id,font.outline]));
  const editing=watchEditingPage(revision,trial,definition,document,sample,paths);
  const engineStart=performance.now();
  runner.submit(revision,document,{},editing?.closed);
  let step,slices=0;
  do{
    step=await runner.advance(8);
    if(step.status==='paused'){slices++;await yieldTask();}
  }while(step.status==='paused');
  if(step.status!=='complete')throw step.error??Error('Browser layout did not complete');
  const engineMs=performance.now()-engineStart,draw=step.draw;
  if(draw.pages.length>2000)throw Error('Preview page limit exceeded');
  const bindings=trialBindings(definition,document,sample,draw);
  const cache={draw,bindings,paths,fonts:Object.keys(paths),keys:new Map(),trial};
  const pageIndex=trialFocusPage(trial,draw,bindings);
  remember(pageIndex);
  const pageKeys=Array(draw.pages.length).fill(null);
  await Promise.all([...knownPages.keys()].filter(index=>index<draw.pages.length).map(async index=>{
    const key=await pageKey(cache,index);
    cache.keys.set(index,key);pageKeys[index]=key;
  }));
  const labels=new Map(definition.sections.map(section=>[section.sectionKey,section.label]));
  const sections=new Map(document.sections.map(section=>[section.sectionId,section.sectionKey]));
  const pageSizes=draw.pages.map(({widthPt,heightPt,sectionId})=>[widthPt,heightPt,labels.get(sections.get(sectionId))??'']);
  const previewId='worker-'+revision;
  const initial=projectTrialPage(cache,pageIndex);
  const priorityPages=editing?.published?[...editing.published.keys()].filter(index=>index!==pageIndex&&index<draw.pages.length)
    .map(index=>[index,projectTrialPage(cache,index)]):undefined;
  const confirmedPages=editing?.published?[[pageIndex,initial],...(priorityPages??[])]
    .filter(([index,page])=>editing.published.get(index)===paperInk(page)).map(([index])=>index):undefined;
  const header={revision:draft.revision,fingerprint,pages:[initial],priorityPages,confirmedPages,pageIndex,paged:true,
    pageCount:draw.pages.length,pageSizes,pageKeys,previewId,renderPath:'browser-wasm',
    engineVersion:'0.5.5 / WASM',engineMs,renderMs:performance.now()-started,slices};
  runs.set(previewId,cache);
  lastComplete=cache;
  while(runs.size>2)runs.delete(runs.keys().next().value);
  return header;
}
const queue=createPreviewQueue(layout,({revision},preview,error)=>{
  self.postMessage({kind:'layout',revision,preview,error:error?.message??(error?JSON.stringify(error):undefined)});
},({revision})=>self.postMessage({kind:'superseded',revision}));
self.onmessage=async ({data:message})=>{
  if(message.kind==='open'){
    draft=message.draft;
    void loadAssets().catch(()=>{});
  }else if(message.kind==='layout'){
    void queue.submit(message);
  }else if(message.kind==='page'){
    const {id,run,index}=message,cache=runs.get(run);
    try{
      if(!cache?.draw.pages[index])throw Error('Browser Engine page no longer available');
      remember(index);
      const key=cache.keys.get(index)??await pageKey(cache,index);
      cache.keys.set(index,key);
      self.postMessage({kind:'page',id,key,page:projectTrialPage(cache,index)});
    }catch(error){self.postMessage({kind:'page',id,error:error.message});}
  }else if(message.kind==='proof'){
    const {id,run}=message,cache=runs.get(run);
    if(!cache)return self.postMessage({kind:'proof',id,error:'Browser Engine revision is no longer retained'});
    const layouts=cache.draw.pages.map(page=>JSON.stringify(page));
    const layoutHash=await hash('['+layouts.join(',')+']');
    self.postMessage({kind:'proof',id,layoutHash});
  }
};
