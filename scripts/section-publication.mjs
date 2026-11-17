import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash,randomUUID} from 'node:crypto';
import {mkdtemp,readFile,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
const exec=promisify(execFile);
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');

export async function openSectionPublication(configPath) {
 if(!configPath)return;
 const config=JSON.parse(await readFile(configPath,'utf8'));
 const {sourceTemplateId,targetTemplateId,docKey,directory}=config;
 const cli=async(...args)=>{
  const {stdout}=await exec(process.execPath,['/candidate/dist/cli.js',...args],{timeout:30000});
  const result=JSON.parse(stdout);
  if(!result.ok)throw Error('Publication registry rejected the request');
  return result.value;
 };
 let queued=Promise.resolve();
 const install=async(path,bytes)=>{
  try{await writeFile(path,bytes,{flag:'wx'});}
  catch(error){if(error.code!=='EEXIST'||!(await readFile(path)).equals(Buffer.from(bytes)))throw error;}
 };
 return {
  accepts:id=>id===sourceTemplateId,
  publish(draft,settings,expectedBackgrounds,store){
   const run=queued.then(async()=>{
    if(draft.templateId!==sourceTemplateId||!draft.definition||draft.readOnly)return {status:404,error:'not_found'};
    const digestMap=Object.fromEntries(Object.entries(settings).filter(([id])=>draft.definition.sections.some(section=>section.id===id)).map(([id,item])=>[id,item.sha256]).sort());
    if(JSON.stringify(digestMap)!==JSON.stringify(expectedBackgrounds))return {status:409,error:'STALE_CURRENT'};
    const [section]=draft.definition.sections;
    if(draft.definition.sections.length!==1||!digestMap[section.id])return {status:422,error:'background_required'};
    const prior=await cli('show',docKey);
    const latest=prior.template.definition;
    if(latest.templateId!==targetTemplateId)throw Error('Unexpected published template');
    const version=latest.version+1;
    const item=await store.image(sourceTemplateId,digestMap[section.id]);
    if(!item||digest(item.bytes)!==digestMap[section.id])throw Error('Missing draft image');
    const definition={...draft.definition,templateId:targetTemplateId,docKey,version};
    const sharp=createRequire('/candidate/package.json')('sharp');
    const op=sharp(item.bytes,{limitInputPixels:16000000,failOn:'warning'});
    const info=await op.metadata();
    if(!['png','jpeg'].includes(info.format)||info.pages>1)return {status:422,error:'invalid_image'};
    const bytes=info.format==='png'?item.bytes:await op.rotate().png().toBuffer();
    const hash=digest(bytes);
    const pin={templateId:targetTemplateId,version,sectionId:section.id,sha256:hash,sourceSha256:digestMap[section.id]};
    await mkdir(join(directory,'objects'),{recursive:true});
    await install(join(directory,'objects',hash+'.png'),bytes);
    // Install immutable image and binding before making the DB version visible.
    await install(join(directory,'v'+version+'.json'),JSON.stringify(pin));
    const temp=await mkdtemp(join(tmpdir(),'flowdoc-publish-'));
    try{
     const path=join(temp,randomUUID()+'.json');
     await writeFile(path,JSON.stringify(definition));
     const result=await cli('register',path);
     if(result.version!==version||result.templateId!==targetTemplateId||result.docKey!==docKey)throw Error('Unexpected registration result');
     return {status:201,value:{...result,backgroundSha256:hash}};
    }finally{await rm(temp,{recursive:true,force:true});}
   });
   queued=run.catch(()=>{});
   return run;
  }
 };
}
