import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {loadOriginalUat} from './original-uat-preview.mjs';
import {trialImages} from './trial-preview-images.mjs';
import {layoutPreview} from './trial-engine-layout.mjs';
import {markBlankRuns,previewInput,trialBindings} from './trial-preview-bindings.mjs';
import {randomBytes, randomUUID, createHash} from 'node:crypto';
import {readFile, mkdtemp} from 'node:fs/promises';
import {createInterface} from 'node:readline';
import {createPool} from '/candidate/dist/db/connection.js';
import {createServer} from '/candidate/dist/http/server.js';
import {createAuthoring} from '/candidate/dist/authoring/service.js';
import {readReferences} from '/candidate/dist/fonts/retention.js';
import {resolveFontReadiness} from '/candidate/dist/fonts/readiness.js';
import {snapshotResources, rendererIdentity} from '/candidate/dist/fonts/snapshot.js';
import * as core from '/candidate/node_modules/@flowdoc/core/dist/index.js';

const database = 'flowdoc_editor_phase1_20261108';
const docKey = 'stage6-uat-editor-phase1';
const principal = 'phase1-editor';
const token = randomBytes(32).toString('hex');
const take = result => {
  if (!result.ok) throw Error(JSON.stringify(result.issues));
  return result.value;
};
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const pool = createPool('postgresql://stage@localhost/' + database + '?host=%2Fsocket');
const app = createServer({pool, outputs: {}, isReady: () => true, maxOutstanding: 1,
  authoring: {principal, token}});
const service = (method, route, payload) => app.inject({method, url: '/authoring/drafts' + route,
  headers: {authorization: 'Bearer ' + token}, ...(payload ? {payload} : {})});
const request = JSON.parse(await readFile('/phase1/sample.json', 'utf8'));
const bannerId = 'e09c1a18-8143-46a9-9499-b30ea2505858';
const banner = {width:2,height:1};
const tempRoot = await mkdtemp('/tmp/flowdoc-editor-phase1-');
let originalFixture;
let originalPreview;
const trialPreviews=new Map();
const previewOutlines=new Map();
function original(){
  return originalFixture??=(loadOriginalUat(core.PDF_STREAM_CONTRACT).catch(error=>{
    originalFixture=undefined;throw error;
  }));
}
async function glyphPaths(draw,resources){
  const used=new Map();
  for(const page of draw.pages)for(const line of page.commands){
    let glyphs=used.get(line.fontId);
    if(!glyphs){glyphs=new Set();used.set(line.fontId,glyphs);}
    for(const g of line.glyphs)glyphs.add(g.glyphId);
  }
  const faces=resources.fonts.filter(font=>used.has(font.id)).map(font=>{
    const key=font.sha256??font.path;
    const face=previewOutlines.get(key)??{units:0,paths:Object.create(null),seen:new Set()};
    const missing=[...used.get(font.id)].filter(id=>!face.seen.has(id));
    return {font,key,face,missing};
  });
  assert.equal(faces.length,used.size);
  const args=faces.filter(({missing})=>missing.length).map(({font,missing})=>[font.id,font.path,missing]);
  const outlines=args.length?await new Promise((resolve,reject)=>{
    const proc=execFile(resources.pythonExecutable,['/phase1/preview-glyph-paths.py'],
      {encoding:'utf8',maxBuffer:8*1024*1024,timeout:15000},(err,out)=>{
        if(err)return reject(err);
        try{resolve(JSON.parse(out));}catch(error){reject(error);}
      });
    proc.stdin.on('error',reject);
    proc.stdin.end(JSON.stringify(args));
  }):{};
  for(const {font,key,face,missing} of faces){
    if(missing.length){
      const [units,paths]=outlines[font.id];
      face.units=units;
      Object.assign(face.paths,paths);
      for(const id of missing)face.seen.add(id);
    }
    previewOutlines.delete(key);
    if(face.seen.size<=4096)previewOutlines.set(key,face);
  }
  while(previewOutlines.size>8)previewOutlines.delete(previewOutlines.keys().next().value);
  return Object.fromEntries(faces.map(({font,face})=>[font.id,[face.units,face.paths]]));
}
function projectOriginalPage(cache,index){
  const {commands,images,...page}=cache.draw.pages[index];
  const glyphs=Object.create(null);
  const lines=commands.map(command=>{
    const {text,bounds,fontId,fontSizePt,baselineOffsetPt,color,glyphs:run}=command;
    const [units,paths]=cache.paths[fontId];
    const font=cache.fonts.indexOf(fontId), scale=fontSizePt/units;
    let advance=0;
    const glyphUses=[];
    for(const g of run){
      const d=paths[g.glyphId], key='g'+font+'-'+g.glyphId;
      if(d){glyphs[key]=d;glyphUses.push([key,bounds.xPt+advance+g.offsetXPt,bounds.yPt+baselineOffsetPt-g.offsetYPt]);}
      advance+=g.advancePt;
    }
    const owner=cache.bindings?.lines.get(command);
    let edit;
    if(owner){
      let x=0;
      const clusters=run.map(g=>{
        const cluster=[x,owner.blank?0:owner.start+g.clusterStartOffset,owner.blank?0:owner.start+g.clusterEndOffset];
        x+=g.advancePt;return cluster;
      });
      edit={...owner,clusters,...cache.bindings.tab.get(owner.occurrence)};
    }
    return {text,...bounds,fontSizePt,baselineOffsetPt,color,scale,glyphUses,...(edit?{edit}:{})};
  });
  return {...page,sampleImages:images??[],glyphs,lines};
}

try {
  assert.equal((await pool.query('SELECT current_database() AS db')).rows[0].db, database);
  const packageInfo = JSON.parse(await readFile('/candidate/package.json','utf8'));
  assert.equal(packageInfo.version, '0.5.5');
  assert.equal(rendererIdentity.version, '0.5.5');
  const contract = await app.inject({method:'GET', url:'/authoring/contract',
    headers:{authorization:'Bearer '+token}});
  assert.deepEqual(take(contract.json()).nodeModelVersions, [20]);

  let identity = (await pool.query(
    'SELECT t.id FROM templates t JOIN authoring_templates a ON a.template_id=t.id WHERE t.doc_key=$1 AND a.principal=$2',
    [docKey,principal])).rows[0]?.id;
  if (!identity) {
    identity = take((await service('POST','',{name:'UAT · ฉบับทดสอบเฟส 1',docKey,
      idempotencyKey:'phase1-create-uat'})).json()).templateId;
  }
  const route = '/' + identity;
  const readDraft = async () => take((await service('GET',route)).json());
  if ((await readDraft()).revision === 0) {
    const sourceId = (await pool.query(
      "SELECT id FROM templates WHERE doc_key='stage6-uat-full'"
    )).rows[0].id;
    const source = createAuthoring(pool,'local-owner',{maxOutstanding:1,imagesEnabled:false});
    const {definition:original} = take(await source.get(sourceId));
    const definition = {...original, templateId: identity, name:'UAT · ฉบับทดสอบเฟส 1',docKey,version:1};
    definition.examples = [];
    take((await service('PUT',route,{definition,expectedRevision:0,idempotencyKey:'phase1-seed-uat'})).json());
  }

  let previewBusy = false;
  async function render(templateId,body) {
    const {expectedRevision,sample:mode,trial}=body??{};
    const custom=trial!==undefined;
    if(!custom&&templateId!==identity)return {status:400,body:{error:'trial_required'}};
    if (previewBusy) return {status:429,body:{error:'preview_busy'}};
    previewBusy = true;
    try {
      const result=await service('GET','/'+templateId);
      if(result.statusCode!==200)return {status:result.statusCode,body:result.json()};
      const draft=take(result.json());
      if (draft.revision !== expectedRevision) return {status:409,body:{error:'STALE_CURRENT'}};
      if(!custom&&mode!=='benchmark'&&originalPreview?.revision===draft.revision&&originalPreview.fingerprint===draft.fingerprint)
        return {status:200,body:originalPreview.header};
      const started = performance.now();
      const validated = take(core.validateTemplate(draft.definition));
      if(custom&&(!trial||typeof trial!=='object'||!Array.isArray(trial.sections)||!Array.isArray(trial.images)))
        return {status:422,body:{error:'invalid_trial'}};
      const fixture=custom||mode==='benchmark'?null:await original();
      const identityFields={docKey:draft.docKey,version:draft.definition.version};
      const sample=custom?{...identityFields,data:trial.data,sections:trial.sections}
        :fixture?{...fixture.request,...identityFields}
        :{...request,...identityFields,data:{...request.data,headerBanner:bannerId,docVersion:'Phase 1'}};
      let previewSample={input:sample,marks:new Set()};
      if(custom){
        try{previewSample=previewInput(sample,trial.blanks);}
        catch{return {status:422,body:{error:'invalid_blank_fields'}};}
      }
      const prepared=core.prepareGeneration(validated,previewSample.input);
      if(!prepared.ok)return {status:422,body:prepared};
      const composed=core.composeDocument(validated,prepared.value);
      if(!composed.ok)return {status:422,body:composed};
      const resolved=composed.value;
      if(custom)markBlankRuns(resolved,previewSample.marks);
      let assets=fixture;
      if(custom){
        try{assets=await trialImages(trial.images);}
        catch{return {status:422,body:{error:'invalid_image'}};}
      }
      const refs=await readReferences(pool,templateId,draft.revision);
      // The Engine shapes the actual trial below. Service actual-input preflight invokes a PDF writer.
      const fontProbe=custom?undefined:{document:resolved,input:sample};
      const {snapshot,readiness} = await resolveFontReadiness(pool,draft.definition,draft.fingerprint,refs,
        fontProbe,undefined,{deferFiles:true});
      if(readiness.status!=='ready')return {status:422,body:{error:'font_not_ready'}};
      const resources = await snapshotResources(snapshot,tempRoot);
      const engineStarted=performance.now();
      const dimensions=assets?.dimensions??(assets
        ?Object.fromEntries(Object.entries(assets.provider.images).map(([id,{width,height}])=>[id,{width,height}]))
        :{[bannerId]:banner});
      const layout=await layoutPreview(resolved,resources,dimensions);
      if(!layout.ok)return {status:422,body:layout};
      const draw=layout.value;
      const engineMs=performance.now()-engineStarted;
      const sections=new Map(resolved.sections.map(section=>[section.sectionId,section.sectionKey]));
      const labels=new Map(draft.definition.sections.map(section=>[section.sectionKey,section.label]));
      const pageSizes=draw.pages.map(({widthPt,heightPt,sectionId})=>[widthPt,heightPt,labels.get(sections.get(sectionId))??'']);
      if(assets){
        const paths=await glyphPaths(draw,resources);
        const cache={revision:draft.revision,fingerprint:draft.fingerprint,draw,paths,fonts:Object.keys(paths)};
        if(custom)cache.bindings=trialBindings(draft.definition,resolved,sample,draw);
        const focus=trial?.focus;
        const candidates=typeof focus?.key==='string'?cache.bindings?.locations.get(focus.key):undefined;
        const matching=candidates?.filter(position=>position.occurrence===focus.occurrence);
        const positions=matching?.length?matching:candidates;
        const requestedPage=focus?.pageIndex??trial?.pageIndex;
        const preferred=Number.isSafeInteger(requestedPage)?Math.min(Math.max(0,requestedPage),draw.pages.length-1):0;
        const caret=Number.isSafeInteger(focus?.offset)?focus.offset:0;
        const position=positions?.find(p=>p.pageIndex===preferred&&p.start<=caret&&caret<=p.end)
          ??positions?.find(p=>p.start<=caret&&caret<=p.end)
          ??positions?.find(p=>p.pageIndex===preferred);
        const pageIndex=position?.pageIndex??preferred;
        const first=projectOriginalPage(cache,pageIndex);
        const layoutHash=hash(draw.pages);
        cache.header={revision:cache.revision,fingerprint:cache.fingerprint,pages:[first],pageIndex,paged:true,
          pageCount:draw.pages.length,pageSizes,layoutHash,renderPath:'engine-layout',engineMs,renderMs:performance.now()-started,
          engineVersion:rendererIdentity.version,
          ...(fixture?{entryCount:fixture.entryCount,imagePlacements:fixture.placements}:{})};
        if(custom){
          const id=randomUUID();
          cache.header.previewId=id;
          trialPreviews.set(id,{...cache,templateId,assets:assets.assets});
          setTimeout(()=>trialPreviews.delete(id),20*60*1000).unref();
          if(trialPreviews.size>2)trialPreviews.delete(trialPreviews.keys().next().value);
        }else originalPreview=cache;
        return {status:200,body:cache.header};
      }
      const expectedFaces = new Map([
        ['d6b2e60fb81aa933aaf61564e41732a5ab2cdcaafffac5242ea72cbc1f9e2722',300],
        ['b8150084e25734e6f31696c57ff009f5564efa09d295848b717d9e2328c0311d',400],
      ]);
      const weights = new Map(resources.fonts.map(f=>[f.id,expectedFaces.get(f.sha256)]));
      const pages = draw.pages.map(({commands,images,...page})=>{
        const sampleImages=(images??[]).map(({resourceId,...geometry})=>{
          assert.equal(resourceId,bannerId);
          return {...geometry,color:'145B4C'};
        });
        return {...page,sampleImages,lines:commands.map(({text,bounds,fontId,fontSizePt,lineHeightPt,baselineOffsetPt,color})=>{
          const weight = weights.get(fontId);
          assert.ok(weight,'Engine font has no matching browser asset');
          return {text,...bounds,fontSizePt,lineHeightPt,baselineOffsetPt,color,weight};
        })};
      });
      return {status:200,body:{revision:draft.revision,fingerprint:draft.fingerprint,pages,
        pageCount:draw.pages.length,pageSizes,layoutHash:hash(pages),renderPath:'engine-layout',engineMs,
        renderMs:performance.now()-started,engineVersion:rendererIdentity.version}};
    } finally { previewBusy = false; }
  }

  async function createDraft(body){
    const {definition,idempotencyKey}=body??{};
    if(!definition||typeof definition.name!=='string'||typeof definition.docKey!=='string'||
      !/^editor-draft-[a-z0-9-]{1,42}$/.test(definition.docKey)||typeof idempotencyKey!=='string'||
      !/^[a-f0-9-]{36}$/i.test(idempotencyKey))return {status:400,body:{error:'invalid_create'}};
    const draftDefinition={...definition,version:1,templateId:'00000000-0000-4000-8000-000000000001'};
    const valid=core.validateTemplate(draftDefinition);
    if(!valid.ok)return {status:422,body:valid};
    const created=await service('POST','',{name:definition.name,docKey:definition.docKey,idempotencyKey});
    const reply=created.json();
    if(!reply.ok)return {status:created.statusCode,body:reply};
    draftDefinition.templateId=reply.value.templateId;
    const saved=await service('PUT','/'+draftDefinition.templateId,{definition:draftDefinition,expectedRevision:0,idempotencyKey});
    return {status:saved.statusCode===200?201:saved.statusCode,body:saved.json()};
  }
  async function dispatch(packet) {
    if(packet.action==='create')return createDraft(packet.body);
    if(packet.action==='fonts'){
      const releases=[];
      let cursor;
      do {
        const result=await app.inject({method:'GET',url:'/authoring/fonts?limit=100'+(cursor?'&cursor='+encodeURIComponent(cursor):''),
          headers:{authorization:'Bearer '+token}});
        if(result.statusCode!==200)return {status:result.statusCode,body:result.json()};
        const value=take(result.json());
        releases.push(...value.releases);
        cursor=value.nextCursor;
      }while(cursor);
      return {status:200,body:{value:{releases}}};
    }
    if (packet.action === 'catalog') {
      const {rows} = await pool.query(
        'SELECT t.id AS "templateId", t.doc_key AS "docKey", t.name, c.revision, c.updated_at AS "updatedAt" ' +
        'FROM authoring_templates a JOIN templates t ON t.id=a.template_id JOIN template_current c ON c.template_id=t.id '+
        'WHERE a.principal=$1 AND (t.id=$2 OR t.doc_key LIKE $3) ORDER BY c.updated_at DESC',
        [principal,identity,'editor-draft-%']);
      return {status:200,body:{items:rows.map(row=>({...row,description:'ฉบับทดสอบแยกจาก UAT ในคลังจริง'}))}};
    }
    const selectedRoute='/'+packet.templateId;
    if(packet.templateId!==identity){
      const owned=await pool.query('SELECT 1 FROM authoring_templates a JOIN templates t ON t.id=a.template_id WHERE a.principal=$1 AND t.id=$2 AND t.doc_key LIKE $3',[principal,packet.templateId,'editor-draft-%']);
      if(!owned.rowCount||!['get','rename','structure','preview','trial-page','trial-asset'].includes(packet.action))return {status:404,body:{error:'not_found'}};
    }
    if (packet.action === 'get') {
      const result = await service('GET',selectedRoute);
      return {status:result.statusCode,body:result.json()};
    }
    if (packet.action === 'rename') {
      const {sectionId,label,expectedRevision,idempotencyKey}=packet.body??{};
      if(typeof label!=='string'||!label.trim()||label.length>128||!Number.isSafeInteger(expectedRevision)
        ||expectedRevision<1||typeof idempotencyKey!=='string'||!/^[a-f0-9-]{36}$/i.test(idempotencyKey))
        return {status:400,body:{error:'invalid_rename'}};
      const current=await service('GET',selectedRoute);
      const draft=take(current.json());
      const section=draft.definition.sections.find(s=>s.id===sectionId);
      if (!section) return {status:404,body:{error:'section_not_found'}};
      section.label=label.trim();
      const result=await service('PUT',selectedRoute,{definition:draft.definition,expectedRevision,idempotencyKey});
      return {status:result.statusCode,body:result.json()};
    }
    if (packet.action === 'structure') {
      const result = await service('PUT',selectedRoute,packet.body);
      return {status:result.statusCode,body:result.json()};
    }
    if (packet.action === 'preview') return render(packet.templateId,packet.body);
    if(packet.action==='trial-page'||packet.action==='trial-asset'){
      const cache=trialPreviews.get(packet.body.run);
      if(!cache||cache.templateId!==packet.templateId)return {status:404,body:{error:'PREVIEW_EXPIRED'}};
      if(packet.action==='trial-asset'){
        const asset=cache.assets.get(packet.body.key);
        return asset?{status:200,mediaType:asset.type,bytes:asset.bytes.toString('base64')}:{status:404,body:{error:'not_found'}};
      }
      const index=packet.body.index;
      if(!Number.isSafeInteger(index)||index<0||index>=cache.draw.pages.length)return {status:404,body:{error:'not_found'}};
      return {status:200,body:{revision:cache.revision,index,page:projectOriginalPage(cache,index)}};
    }
    if (packet.action === 'preview-page') {
      const {revision,index}=packet.body;
      if(originalPreview?.revision!==revision)return {status:409,body:{error:'PREVIEW_EXPIRED'}};
      if(!Number.isSafeInteger(index)||index<0||index>=originalPreview.draw.pages.length)
        return {status:404,body:{error:'not_found'}};
      return {status:200,body:{revision,index,page:projectOriginalPage(originalPreview,index)}};
    }
    if (packet.action === 'preview-asset') {
      const asset=(await original()).assets.get(packet.body.key);
      return asset?{status:200,mediaType:asset.type,bytes:asset.bytes.toString('base64')}:{status:404,body:{error:'not_found'}};
    }
    return {status:404,body:{error:'not_found'}};
  }

  const pending = new Set();
  for await (const line of createInterface({input:process.stdin})) {
    const packet=JSON.parse(line);
    const job=(async()=>{
      try {console.log(JSON.stringify({id:packet.id,...await dispatch(packet)}));}
      catch(error) {
        console.error(error instanceof Error ? error.message : String(error));
        console.log(JSON.stringify({id:packet.id,status:503,body:{error:'phase1_unavailable'}}));
      }
    })();
    pending.add(job);void job.finally(()=>pending.delete(job));
  }
  await Promise.allSettled(pending);
} finally {await app.close();await pool.end();}
