import {createHash,randomUUID} from 'node:crypto';
import {mkdir,readFile,rename,writeFile} from 'node:fs/promises';
import {join} from 'node:path';

const maxBytes=8*1024*1024;
const png=Buffer.from('89504e470d0a1a0a','hex');
export function sectionBackgrounds(directory) {
 const queues=new Map();
 const missing=e=>e.code==='ENOENT';
 const settings=id=>join(directory,id,'sections.json');
 const read=id=>readFile(settings(id),'utf8').then(JSON.parse).catch(e=>{if(missing(e))return {};throw e;});
 const serialize=(id,work)=>{
  const next=(queues.get(id)??Promise.resolve()).then(work);
  const tail=next.catch(()=>{});
  queues.set(id,tail);
  void tail.then(()=>{if(queues.get(id)===tail)queues.delete(id);});
  return next;
 };
 const props=bytes=>bytes.subarray(0,8).equals(png)?'png':bytes.subarray(0,3).equals(Buffer.from('ffd8ff','hex'))?'jpeg':undefined;
 return {
  read,
  async image(id,hash) {
   for(const format of ['png','jpeg']){
    try{return {bytes:await readFile(join(directory,id,hash+'.'+format)),format};}
    catch(e){if(!missing(e))throw e;}
   }
  },
  async save(id,section,{expected,bytes,name}) {
   const format=bytes&&props(bytes);
   if(bytes&&(!format||bytes.length>maxBytes))return {status:422,error:'invalid_image'};
   return serialize(id,async()=>{
    const current=await read(id);
    if((current[section]?.sha256??null)!==expected)return {status:409,error:'STALE_CURRENT'};
    if(bytes){
     const sha256=createHash('sha256').update(bytes).digest('hex');
     await mkdir(join(directory,id),{recursive:true});
     await writeFile(join(directory,id,sha256+'.'+format),bytes,{flag:'wx'}).catch(e=>{if(e.code!=='EEXIST')throw e;});
     current[section]={sha256,name:String(name??'').slice(0,160),format};
    }else delete current[section];
    await mkdir(join(directory,id),{recursive:true});
    const temp=settings(id)+'.'+randomUUID();
    await writeFile(temp,JSON.stringify(current));
    await rename(temp,settings(id));
    return {status:200,value:current};
   });
  }
 };
}
