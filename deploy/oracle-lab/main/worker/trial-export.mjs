import {randomUUID} from 'node:crypto';
import {open,rm,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createPdfEngine,createDocxEngine,PDF_STREAM_CONTRACT,validateTemplate,prepareGeneration,composeDocument,normalizeOutputName} from '/candidate/node_modules/@flowdoc/core/dist/index.js';
import {outputDisposition} from '/candidate/dist/tasks/output-name.js';
import {artifactSpec,DOCX_MAX_BYTES} from '/candidate/dist/tasks/artifact.js';
import {trialImages,trialImageProvider} from './trial-preview-images.mjs';

const reject=(status,error)=>({status,body:{error}});
const invalid=result=>({status:422,body:{issues:result.issues.slice(0,20).map(({code,path})=>({code,path}))}});
export function createTrialExports(root,readDraft,resourcesFor){
  let active;
  async function release(entry){
    if(!entry)return;
    clearTimeout(entry.timer);
    await rm(entry.path,{force:true});
    if(active===entry)active=undefined;
  }
  async function generate(templateId,body,sharedDraft){
    const {format,expectedRevision,fingerprint,trial}=body??{};
    if(!['pdf','docx'].includes(format)||!Number.isSafeInteger(expectedRevision)||typeof fingerprint!=='string'
      ||!trial?.data||!Array.isArray(trial.sections)||!Array.isArray(trial.images))return reject(422,'invalid_trial');
    if(active)return reject(429,'export_busy');
    const id=randomUUID(),entry={id,templateId,path:join(root,id+'.'+format),size:0};
    active=entry;
    try{
      const result=sharedDraft?{ok:true,value:sharedDraft}:await readDraft(templateId);
      if(!result.ok)return reject(404,'not_found');
      const draft=result.value;
      if(draft.revision!==expectedRevision||draft.fingerprint!==fingerprint)return reject(409,'STALE_CURRENT');
      const validated=validateTemplate(draft.definition);
      if(!validated.ok)return invalid(validated);
      const input={docKey:draft.docKey,version:draft.definition.version,data:trial.data,sections:trial.sections};
      const prepared=prepareGeneration(validated.value,input);
      if(!prepared.ok)return invalid(prepared);
      const composed=composeDocument(validated.value,prepared.value);
      if(!composed.ok)return invalid(composed);
      let assets;
      try{assets=await trialImages(trial.images);}
      catch{return reject(422,'invalid_image');}
      const resources=await resourcesFor(templateId,draft);
      if(!resources)return reject(422,'font_not_ready');
      const engine=await (format==='docx'?createDocxEngine(resources):createPdfEngine(resources));
      if(!engine.ok)return invalid(engine);
      const provider=await trialImageProvider(assets,PDF_STREAM_CONTRACT);
      const maxBytes=format==='docx'?DOCX_MAX_BYTES:256*1024*1024;
      const rawPath=entry.path+'.raw';
      const signal=AbortSignal.timeout(100000);
      let rendered;
      try{
        const output=await open(rawPath,'wx',0o600);
        try{
          const sink={write:bytes=>output.writeFile(bytes),async abort(){}};
          rendered=format==='docx'
            ?await engine.value.generateDocxTo(composed.value,provider,sink,{signal,maxBytes})
            :await engine.value.generatePdfTo(composed.value,provider,sink,{signal,maxBytes});
        }finally{await output.close();}
        if(!rendered.ok)return invalid(rendered);
        const raw=await stat(rawPath);
        if(raw.size!==rendered.value.byteLength||raw.size===0)return reject(503,'export_failed');
        try{
          const location=process.env.FLOWDOC_PREVIEW_WATERMARK_RUNTIME;
          const runtime=location?pathToFileURL(location):new URL('./preview-watermark-runtime.cjs',import.meta.url);
          const {default:{stampPreviewExport}}=await import(runtime.href);
          await stampPreviewExport(format,rawPath,entry.path,{maxBytes,signal});
        }catch{return reject(503,'export_watermark_failed');}
      }finally{await rm(rawPath,{force:true});}
      const {size}=await stat(entry.path);
      if(size===0)return reject(503,'export_failed');
      entry.size=size;
      entry.timer=setTimeout(()=>void release(entry).catch(()=>{}),5*60*1000);
      return {status:200,body:{id,size,mediaType:artifactSpec(format).mediaType,
        disposition:outputDisposition(normalizeOutputName('preview-'+draft.docKey)||'preview',format),warningCount:rendered.warnings.length}};
    }finally{if(!entry.size)await release(entry);}
  }
  async function chunk(templateId,{id,offset}){
    const entry=active;
    if(!entry?.size||entry.id!==id||entry.templateId!==templateId)return reject(404,'export_expired');
    if(!Number.isSafeInteger(offset)||offset<0||offset>=entry.size)return reject(416,'invalid_offset');
    const bytes=Buffer.allocUnsafe(Math.min(entry.size-offset,768*1024));
    const file=await open(entry.path,'r');
    try{
      const {bytesRead}=await file.read({buffer:bytes,position:offset});
      return {status:200,bytes:bytes.subarray(0,bytesRead).toString('base64')};
    }finally{await file.close();}
  }
  return {generate,chunk,async release(templateId,{id}){
    if(active?.size&&active.id===id&&active.templateId===templateId)await release(active);
    return {status:200,body:{released:true}};
  }};
}
