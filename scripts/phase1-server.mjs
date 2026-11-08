import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {loadOriginalUat} from './original-uat-preview.mjs';
import {randomBytes, createHash} from 'node:crypto';
import {readFile, mkdtemp} from 'node:fs/promises';
import {createInterface} from 'node:readline';
import {createPool} from '/candidate/dist/db/connection.js';
import {createServer} from '/candidate/dist/http/server.js';
import {createAuthoring} from '/candidate/dist/authoring/service.js';
import {readReferences} from '/candidate/dist/fonts/retention.js';
import {resolveFontReadiness} from '/candidate/dist/fonts/readiness.js';
import {snapshotResources, rendererIdentity} from '/candidate/dist/fonts/snapshot.js';
import * as core from '/candidate/node_modules/@flowdoc/core/dist/index.js';
import {createEngine} from '/candidate/node_modules/@flowdoc/core/dist/pdf/createPdfEngine.js';
import {createTextRuntime} from '/candidate/node_modules/@flowdoc/core/dist/runtime/textRuntime.js';
import {subsetFonts} from '/candidate/node_modules/@flowdoc/core/dist/runtime/subsetFonts.js';
import {writePdf} from '/candidate/node_modules/@flowdoc/core/dist/pdf/writePdf.js';

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
const banner = {kind:'rgb',width:2,height:1,bytes:Uint8Array.of(20,91,76,20,91,76)};
const tempRoot = await mkdtemp('/tmp/flowdoc-editor-phase1-');
let originalFixture;
let originalPreview;
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
  const args=resources.fonts.filter(f=>used.has(f.id)).map(f=>[f.id,f.path,[...used.get(f.id)]]);
  assert.equal(args.length,used.size);
  return new Promise((resolve,reject)=>{
    const proc=execFile(resources.pythonExecutable,['/phase1/preview-glyph-paths.py'],
      {encoding:'utf8',maxBuffer:8*1024*1024,timeout:15000},(err,out)=>{
        if(err)return reject(err);
        try{resolve(JSON.parse(out));}catch(error){reject(error);}
      });
    proc.stdin.on('error',reject);
    proc.stdin.end(JSON.stringify(args));
  });
}
function projectOriginalPage(cache,index){
  const {commands,images,...page}=cache.draw.pages[index];
  const glyphs=Object.create(null);
  const lines=commands.map(({text,bounds,fontId,fontSizePt,baselineOffsetPt,color,glyphs:run})=>{
    const [units,paths]=cache.paths[fontId];
    const font=cache.fonts.indexOf(fontId), scale=fontSizePt/units;
    let advance=0;
    const glyphUses=[];
    for(const g of run){
      const d=paths[g.glyphId], key='g'+font+'-'+g.glyphId;
      if(d){glyphs[key]=d;glyphUses.push([key,bounds.xPt+advance+g.offsetXPt,bounds.yPt+baselineOffsetPt-g.offsetYPt]);}
      advance+=g.advancePt;
    }
    return {text,...bounds,fontSizePt,baselineOffsetPt,color,scale,glyphUses};
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
  async function render(expectedRevision,mode) {
    if (previewBusy) return {status:429,body:{error:'preview_busy'}};
    previewBusy = true;
    try {
      const draft = await readDraft();
      if (draft.revision !== expectedRevision) return {status:409,body:{error:'STALE_CURRENT'}};
      if(mode!=='benchmark'&&originalPreview?.revision===draft.revision&&originalPreview.fingerprint===draft.fingerprint)
        return {status:200,body:originalPreview.header};
      const started = performance.now();
      const validated = take(core.validateTemplate(draft.definition));
      const fixture=mode==='benchmark'?null:await original();
      const sample = fixture
        ? {...fixture.request,docKey,version:draft.definition.version}
        : {...request,docKey,version:draft.definition.version,
          data:{...request.data,headerBanner:bannerId,docVersion:'Phase 1'}};
      const resolved = take(core.composeDocument(validated,take(core.prepareGeneration(validated,sample))));
      const refs = await readReferences(pool,identity,draft.revision);
      const {snapshot,readiness} = await resolveFontReadiness(pool,draft.definition,draft.fingerprint,refs,
        {document:resolved,input:sample},undefined,{deferFiles:true});
      assert.equal(readiness.status,'ready');
      const resources = await snapshotResources(snapshot,tempRoot);
      if(fixture){
        let draw;
        const engine=createEngine(resources,{runtime:createTextRuntime,
          subset(pages,current,temp){draw=pages;return subsetFonts(pages,current,temp);},write:writePdf});
        const engineStarted=performance.now();
        const pdf=take(await engine.generatePdfTo(resolved,fixture.provider,{async write(){},async abort(reason){throw Error(reason);}}));
        const engineMs=performance.now()-engineStarted;
        assert.equal(draw.pages.length,pdf.pageCount);
        const paths=await glyphPaths(draw,resources);
        const cache={revision:draft.revision,fingerprint:draft.fingerprint,draw,paths,fonts:Object.keys(paths)};
        const first=projectOriginalPage(cache,0);
        const layoutHash=hash(draw.pages);
        cache.header={revision:cache.revision,fingerprint:cache.fingerprint,pages:[first],paged:true,
          pageCount:pdf.pageCount,layoutHash,pdfHash:pdf.sha256,engineMs,renderMs:performance.now()-started,
          engineVersion:rendererIdentity.version,entryCount:fixture.entryCount,imagePlacements:fixture.placements};
        originalPreview=cache;
        return {status:200,body:cache.header};
      }
      const expectedFaces = new Map([
        ['d6b2e60fb81aa933aaf61564e41732a5ab2cdcaafffac5242ea72cbc1f9e2722',300],
        ['b8150084e25734e6f31696c57ff009f5564efa09d295848b717d9e2328c0311d',400],
      ]);
      const weights = new Map(resources.fonts.map(f=>[f.id,expectedFaces.get(f.sha256)]));
      let draw;
      const engine = createEngine(resources,{runtime:createTextRuntime,subset:subsetFonts,
        write(pages,fonts,images){draw=pages;return writePdf(pages,fonts,images);}});
      const engineStarted = performance.now();
      const pdf = take(await engine.generatePdf(resolved,{[bannerId]:banner}));
      const engineMs = performance.now()-engineStarted;
      assert.equal(draw.pages.length,pdf.pageCount);
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
        pageCount:pdf.pageCount,layoutHash:hash(pages),pdfHash:createHash('sha256').update(pdf.bytes).digest('hex'),engineMs,
        renderMs:performance.now()-started,engineVersion:rendererIdentity.version}};
    } finally { previewBusy = false; }
  }

  async function dispatch(packet) {
    if (packet.action === 'catalog') {
      const {rows} = await pool.query(
        'SELECT t.id AS "templateId", t.doc_key AS "docKey", t.name, c.revision, c.updated_at AS "updatedAt" ' +
        'FROM authoring_templates a JOIN templates t ON t.id=a.template_id JOIN template_current c ON c.template_id=t.id '+
        'WHERE a.principal=$1 AND t.id=$2 AND t.doc_key=$3',
        [principal,identity,docKey]);
      return {status:200,body:{items:rows.map(row=>({...row,description:'ฉบับทดสอบแยกจาก UAT ในคลังจริง'}))}};
    }
    if (packet.templateId !== identity) return {status:404,body:{error:'not_found'}};
    if (packet.action === 'get') {
      const result = await service('GET',route);
      return {status:result.statusCode,body:result.json()};
    }
    if (packet.action === 'rename') {
      const {sectionId,label,expectedRevision,idempotencyKey}=packet.body??{};
      if(typeof label!=='string'||!label.trim()||label.length>128||!Number.isSafeInteger(expectedRevision)
        ||expectedRevision<1||typeof idempotencyKey!=='string'||!/^[a-f0-9-]{36}$/i.test(idempotencyKey))
        return {status:400,body:{error:'invalid_rename'}};
      const draft=await readDraft();
      const section=draft.definition.sections.find(s=>s.id===sectionId);
      if (!section) return {status:404,body:{error:'section_not_found'}};
      section.label=label.trim();
      const result=await service('PUT',route,{definition:draft.definition,expectedRevision,idempotencyKey});
      return {status:result.statusCode,body:result.json()};
    }
    if (packet.action === 'structure') {
      const result = await service('PUT',route,packet.body);
      return {status:result.statusCode,body:result.json()};
    }
    if (packet.action === 'preview') return render(packet.body?.expectedRevision,packet.body?.sample);
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
