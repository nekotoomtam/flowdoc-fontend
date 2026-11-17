import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {mkdir,readdir,readFile,rename,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';

export const previewShareTtl=24*60*60*1000;
const idPattern=/^[a-f0-9]{64}$/;
const tokenPattern=/^[A-Za-z0-9_-]{43}$/;
const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
export const sharedPreviewApi='/shared-preview/api';

export async function openPreviewShares(directory,now=Date.now){
  await mkdir(directory,{recursive:true,mode:0o700});
  const path=id=>join(directory,id+'.json');
  const publicInfo=({id,draft,until})=>({id,revision:draft.revision,expiresAt:new Date(until).toISOString()});
  async function read(id){
    if(!idPattern.test(id))return;
    let record;
    try{record=JSON.parse(await readFile(path(id),'utf8'));}
    catch(error){if(error.code==='ENOENT')return;throw error;}
    if(record.until<=now()){
      await rm(path(id),{force:true});
      return;
    }
    return record;
  }
  async function* active(){
    const entries=await readdir(directory);
    for(const name of entries){
      if(!name.endsWith('.json'))continue;
      const record=await read(name.slice(0,-5));
      if(record)yield record;
    }
  }
  let pending=Promise.resolve();
  return {
    create(draft){
      const job=pending.then(async()=>{
        let count=0;
        for await(const record of active())count++;
        if(count>=32)throw Error('SHARE_LIMIT');
        const token=randomBytes(32).toString('base64url');
        const id=createHash('sha256').update(token).digest('hex');
        const record={id,until:now()+previewShareTtl,draft:{...draft,readOnly:true}};
        const bytes=JSON.stringify(record);
        if(Buffer.byteLength(bytes)>8*1024*1024)throw Error('SHARE_TOO_LARGE');
        const temp=join(directory,randomUUID()+'.tmp');
        try{
          await writeFile(temp,bytes,{mode:0o600,flag:'wx'});
          await rename(temp,path(id));
        }finally{await rm(temp,{force:true});}
        return {...publicInfo(record),token};
      });
      pending=job.catch(()=>{});
      return job;
    },
    get(token){
      if(typeof token!=='string'||!tokenPattern.test(token))return;
      return read(createHash('sha256').update(token).digest('hex'));
    },
    async list(templateId){
      const shares=[];
      for await(const record of active())if(record.draft.templateId===templateId)shares.push(publicInfo(record));
      return shares.sort((a,b)=>b.expiresAt.localeCompare(a.expiresAt));
    },
    async revoke(templateId,id){
      const record=await read(id);
      if(record?.draft.templateId!==templateId)return false;
      await rm(path(id),{force:true});
      return true;
    },
    async sweep(){for await(const record of active())continue;}
  };
}

export function previewSharePacket(method,path,share,session,body){
  if(typeof session!=='string'||!uuid.test(session))return;
  const scope=share.id+'/'+session;
  const shared={scope,draft:share.draft};
  const templateId=share.draft.templateId;
  if(method==='POST'&&path==='/preview'&&body&&typeof body==='object'){
    const trial=body.trial;
    const trialPatch=body.trialPatch;
    if(Boolean(trial)===Boolean(trialPatch))return;
    return {action:'preview',templateId,shared,body:{expectedRevision:share.draft.revision,...(trial?{trial}:{trialPatch})}};
  }
  if(method==='POST'&&path==='/export'&&body&&typeof body==='object'){
    return {action:'export',templateId,shared,body:{format:body.format,expectedRevision:share.draft.revision,
      fingerprint:share.draft.fingerprint,trial:body.trial}};
  }
  if(method==='GET'){
    const run=/^\/preview-runs\/([^/]+)\/(pages|assets)\/([^/]+)$/.exec(path);
    if(!run||!uuid.test(run[1]))return;
    if(run[2]==='pages'&&/^\d+$/.test(run[3]))
      return {action:'trial-page',templateId,shared:{scope},body:{run:run[1],index:Number(run[3])}};
    if(run[2]==='assets'&&uuid.test(run[3]))
      return {action:'trial-asset',templateId,shared:{scope},body:{run:run[1],key:run[3]}};
  }
}
