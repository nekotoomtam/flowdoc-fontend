import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {isDeepStrictEqual} from 'node:util';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {sectionBackgrounds} from './section-backgrounds.mjs';
import {previewSharePacket} from './preview-shares.mjs';

const root=process.env.FLOWDOC_EDITOR_LAB_ROOT??'/home/ubuntu/flowdoc-editor-phase1-20261108';
if(!/^\/home\/ubuntu\/flowdoc-[a-z0-9-]+$/.test(root))throw Error('Invalid editor lab directory');
const stage='/home/ubuntu/flowdoc-library-model20-staging-20261108';
const candidate='/home/ubuntu/flowdoc-audit-187957aecc2d/flowdoc-schema-freshapi-git055-complete-20261106/candidate';
const reference='/home/ubuntu/flowdoc-audit-187957aecc2d/flowdoc-schema-freshapi-full-direct-fonts4-20261106';
const nodeImage='sha256:07c71903922ef511587627683cb2a5041faa62273ee18da2cb52b434b5900388';
const resumeRoot='/home/ubuntu/flowdoc-kernel-g0g1-20261107';
const resumeMounts=process.env.FLOWDOC_RESUMABLE_PREVIEW==='1'
  ?` -v ${resumeRoot}/flow-table-resume-v3:/resume-core:ro -v ${resumeRoot}/line-suffix-v3:/resume-runtime:ro -v ${resumeRoot}/incremental5-checks/runtime/linux-x64/flowdoc-icu4x-line-segmenter:/resume-segmenter:ro -e FLOWDOC_RESUMABLE_PREVIEW=1`
  :'';
const labCommand=`sudo docker run --rm -i --network none --memory 1g --cpus 2 --user 0:0 -v ${root}:/phase1:ro -v ${stage}/socket:/socket -v ${stage}/staged-fonts:/fonts:ro -v ${candidate}:/candidate:ro -v ${reference}/converted:/reference:ro -v ${reference}/candidate/lab-full/assets:/reference-assets:ro -e FONT_STORAGE_DIR=/fonts${resumeMounts} --entrypoint node ${nodeImage} /phase1/phase1-server.mjs`;
const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;

export async function documentsTarget(configured,publication){
  if(!configured?.trim())return {status:'unconfigured'};
  try{
    const url=new URL(configured.trim());
    if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)
      return {status:'unavailable'};
    const baseUrl=url.origin+url.pathname.replace(/\/+$/,'');
    const options={signal:AbortSignal.timeout(4000),redirect:'error'};
    const [contractReply,lookup]=await Promise.all([
      fetch(baseUrl+'/templates/'+encodeURIComponent(publication.docKey)+'/contract',options),
      // An unauthenticated lookup checks the task route without starting a generation.
      fetch(baseUrl+'/documents',{...options,method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({taskId:'00000000-0000-4000-8000-000000000001'})}),
    ]);
    await lookup.body?.cancel();
    if(!contractReply.ok||lookup.status!==401){
      await contractReply.body?.cancel();
      return {status:'unavailable'};
    }
    const contract=(await contractReply.json()).value;
    if(isDeepStrictEqual(contract,publication.contract))return {status:'verified',baseUrl};
  }catch{}
  return {status:'unavailable'};
}

function startRemoteWorker(){
  return spawn('ssh.exe',['-T','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes',
    '-o','ConnectTimeout=8','-i','C:/test/keyflow.key','ubuntu@129.221.205.23',labCommand],{windowsHide:true});
}

export function phase1Bridge({enabled=process.env.FLOWDOC_EDITOR_PHASE1==='1',
  documentsBaseUrl=process.env.FLOWDOC_DOCUMENTS_BASE_URL,documentsBaseUrlFor,
  previewShares,previewShareOrigin,sectionPublication,issueEnabled=false,sectionBackgroundDirectory=process.env.FLOWDOC_SECTION_BACKGROUND_DIR,startWorker=startRemoteWorker}={}) {
  const backgrounds=sectionBackgroundDirectory?sectionBackgrounds(sectionBackgroundDirectory):undefined;
  let child, sequence=0;
  const pending=new Map();
  function stop(proc) {
    if (proc!==child) return;
    child=undefined;
    proc?.stdin.end();
    proc?.kill();
    for (const job of pending.values()) {clearTimeout(job.timer);job.reject(Error('Phase 1 lab unavailable'));}
    pending.clear();
  }
  function start() {
    if (child) return child;
    const proc=startWorker();
    child=proc;
    proc.stdin.on('error',()=>stop(proc));
    proc.on('error',()=>stop(proc));proc.on('exit',()=>stop(proc));
    proc.stderr.on('data',data=>process.stderr.write(data));
    createInterface({input:proc.stdout}).on('line',line=>{
      try {
        const reply=JSON.parse(line), job=pending.get(reply.id);
        if (!job) return;
        pending.delete(reply.id);clearTimeout(job.timer);job.resolve(reply);
      } catch {stop(proc);}
    });
    return proc;
  }
  function ask(packet) {
    if(pending.size>=8&&packet.action!=='export-release')return Promise.resolve({status:429,body:{error:'lab_busy'}});
    const proc=start(), id=++sequence;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>stop(proc),['preview','export','issue'].includes(packet.action)?120000:30000);
      pending.set(id,{timer,resolve,reject});
      proc.stdin.write(JSON.stringify({...packet,id})+'\n');
    });
  }
  return {name:'flowdoc-editor-phase1',configureServer(server){
    server.httpServer?.on('close',()=>stop(child));
    server.middlewares.use('/api/editor-phase1',async(req,res)=>{
      const send=(status,body)=>{
        res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
        res.end(JSON.stringify(body));
      };
      const host=req.headers.host??'';
      const guest=req.url==='/shared-preview'||req.url?.startsWith('/shared-preview/');
      const local=/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host);
      const publicOrigin=previewShareOrigin&&new URL(previewShareOrigin);
      const expectedOrigin=guest&&publicOrigin?.host===host?publicOrigin.origin:local?'http://'+host:undefined;
      if(!expectedOrigin||(req.headers.origin&&req.headers.origin!==expectedOrigin)||
        (req.headers['sec-fetch-site']&&!['same-origin','none'].includes(req.headers['sec-fetch-site'])))
        return send(403,{error:'forbidden'});
      if(!enabled)return send(503,{error:'phase1_disabled'});
      const publishRoute=!guest&&/^\/drafts\/([a-f0-9-]{36})\/section-publication$/.exec(req.url??'');
      if(publishRoute&&sectionPublication?.accepts(publishRoute[1])&&backgrounds){
        if(req.method==='GET')return send(200,{enabled:true});
        if(req.method!=='POST'||req.headers.origin!==expectedOrigin)return send(403,{error:'forbidden'});
        try{
          let length=0;const parts=[];
          for await(const chunk of req){length+=chunk.length;if(length>8192)return send(413,{error:'body_too_large'});parts.push(chunk);}
          const value=JSON.parse(Buffer.concat(parts).toString('utf8'));
          const response=await ask({action:'get',templateId:publishRoute[1]});
          const draft=response.body?.value;
          if(response.status!==200||draft?.readOnly)return send(404,{error:'not_found'});
          if(draft.revision!==value.revision||draft.fingerprint!==value.fingerprint)return send(409,{error:'STALE_CURRENT'});
          const result=await sectionPublication.publish(draft,await backgrounds.read(draft.templateId),value.backgrounds,backgrounds);
          return send(result.status,{value:result.value,error:result.error});
        }catch{return send(502,{error:'publication_failed'});}
      }
      const backdrop=!guest&&/^\/drafts\/([a-f0-9-]{36})\/section-backgrounds(?:\/([a-f0-9-]{36}|[a-f0-9]{64}))?$/.exec(req.url??'');
      if(backdrop&&uuid.test(backdrop[1])){
        if(!backgrounds)return send(404,{error:'not_found'});
        const [,id,key]=backdrop;
        try{
          const result=await ask({action:'get',templateId:id});
          const draft=result.body?.value;
          if(result.status!==200||!draft)return send(404,{error:'not_found'});
          if(req.method==='GET'&&!key)return send(200,{value:await backgrounds.read(id)});
          if(req.method==='GET'&&key?.length===64){
            const asset=await backgrounds.image(id,key);
            if(!asset)return send(404,{error:'not_found'});
            res.writeHead(200,{'Content-Type':'image/'+asset.format,'Cache-Control':'private, max-age=31536000, immutable','X-Content-Type-Options':'nosniff'});
            return res.end(asset.bytes);
          }
          if(!['PUT','DELETE'].includes(req.method)||!draft.definition.sections.some(section=>section.id===key))return send(404,{error:'not_found'});
          if(draft.readOnly)return send(403,{error:'forbidden'});
          const expected=req.headers['if-match'];
          if(typeof expected!=='string'||!/^(none|[a-f0-9]{64})$/.test(expected))return send(400,{error:'revision_required'});
          let bytes;
          if(req.method==='PUT'){
            let size=0;const chunks=[];
            for await(const chunk of req){size+=chunk.length;if(size>8*1024*1024)return send(413,{error:'image_too_large'});chunks.push(chunk);}
            bytes=Buffer.concat(chunks);
          }
          const resultSave=await backgrounds.save(id,key,{expected:expected==='none'?null:expected,bytes,name:decodeURIComponent(String(req.headers['x-image-name']??''))});
          return send(resultSave.status,{value:resultSave.value,error:resultSave.error});
        }catch{return send(500,{error:'background_storage_unavailable'});}
      }
      const shareRoute=!guest&&/^\/drafts\/([^/]+)\/preview-shares(?:\/([a-f0-9]{64}))?$/.exec(req.url??'');
      const readBody=async max=>{
        if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']??''))throw 415;
        const chunks=[];let bytes=0;
        for await(const chunk of req){
          bytes+=chunk.length;
          if(bytes>max)throw 413;
          chunks.push(chunk);
        }
        try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw 400;}
      };
      const issueRoute=!guest&&issueEnabled&&/^\/drafts\/([^/]+)\/issue(?:\/([a-f0-9-]+)\.pdf)?$/i.exec(req.url??'');
      const match=/^\/drafts\/([^/]+)(\/(?:preview|export|structure|publication))?$/.exec(req.url??'');
      const pageRoute=/^\/drafts\/([^/]+)\/preview-pages\/(\d+)\/(\d+)$/.exec(req.url??'');
      const assetRoute=/^\/drafts\/([^/]+)\/preview-assets\/([a-f0-9-]+)$/.exec(req.url??'');
      const trialRoute=/^\/drafts\/([^/]+)\/preview-runs\/([^/]+)\/(pages|assets)\/([^/]+)$/.exec(req.url??'');
      let action,templateId,body;
      if(req.method==='GET'&&req.url==='/catalog')action='catalog';
      else if(req.method==='GET'&&req.url==='/fonts')action='fonts';
      else if(req.method==='POST'&&req.url==='/drafts')action='create';
      else if(match&&uuid.test(match[1])){
        templateId=match[1];
        if(req.method==='GET'&&!match[2])action='get';
        if(req.method==='GET'&&match[2]==='/publication')action='publication';
        if(req.method==='PUT'&&!match[2])action='rename';
        if(req.method==='POST'&&match[2]==='/preview')action='preview';
        if(req.method==='POST'&&match[2]==='/export')action='export';
        if(req.method==='PUT'&&match[2]==='/structure')action='structure';
      }
      if(req.method==='GET'&&pageRoute&&uuid.test(pageRoute[1])){
        action='preview-page';templateId=pageRoute[1];body={revision:Number(pageRoute[2]),index:Number(pageRoute[3])};
      }
      if(req.method==='GET'&&assetRoute&&uuid.test(assetRoute[1])&&uuid.test(assetRoute[2])){
        action='preview-asset';templateId=assetRoute[1];body={key:assetRoute[2]};
      }
      if(req.method==='GET'&&trialRoute&&uuid.test(trialRoute[1])&&uuid.test(trialRoute[2])){
        const [,id,run,type,key]=trialRoute;
        if(type==='pages'&&/^\d+$/.test(key)){action='trial-page';templateId=id;body={run,index:Number(key)};}
        if(type==='assets'&&uuid.test(key)){action='trial-asset';templateId=id;body={run,key};}
      }
      try{
        if(issueRoute&&uuid.test(issueRoute[1])){
          const [,templateId,taskId]=issueRoute;
          if(req.method==='GET'&&!taskId){
            const result=await ask({action:'issue-capability',templateId});
            return send(result.status,result.body);
          }
          if(req.method==='GET'&&uuid.test(taskId??'')){
            const result=await ask({action:'issue-file',templateId,body:{taskId}});
            if(result.status!==200)return send(result.status,result.body);
            const bytes=Buffer.from(result.bytes,'base64');
            res.writeHead(200,{'Content-Type':'application/pdf','Content-Length':bytes.length,
              'Content-Disposition':'attachment; filename="FlowDoc-'+taskId+'.pdf"','Cache-Control':'no-store',
              'X-Content-Type-Options':'nosniff','X-FlowDoc-Sha256':result.body.sha256,'X-FlowDoc-Task-Id':taskId});
            return res.end(bytes);
          }
          if(req.method!=='POST'||taskId||req.headers.origin!==expectedOrigin)return send(403,{error:'forbidden'});
          const body=await readBody(4*1024*1024);
          const result=await ask({action:'issue',templateId,body,backgrounds:await backgrounds?.read(templateId)});
          return send(result.status,result.body);
        }
        if(shareRoute){
          if(!previewShares||!publicOrigin||!uuid.test(shareRoute[1]))return send(404,{error:'not_found'});
          const [,templateId,id]=shareRoute;
          if(req.method==='GET'&&!id)return send(200,{shares:await previewShares.list(templateId)});
          if(req.method==='DELETE'&&id){
            const removed=await previewShares.revoke(templateId,id);
            return send(removed?200:404,{revoked:removed});
          }
          if(req.method!=='POST'||id)return send(405,{error:'method_not_allowed'});
          const {expectedRevision,fingerprint}=await readBody(4096)??{};
          const current=await ask({action:'get',templateId});
          const draft=current.body?.value;
          if(current.status!==200||!draft)return send(current.status,{error:'not_found'});
          if(!Number.isSafeInteger(expectedRevision)||expectedRevision<1||draft.revision!==expectedRevision||draft.fingerprint!==fingerprint)
            return send(409,{error:'STALE_CURRENT'});
          const share=await previewShares.create(draft);
          const link=new URL('/shared-preview',publicOrigin);
          link.hash=share.token;
          return send(201,{id:share.id,revision:share.revision,expiresAt:share.expiresAt,url:link.href});
        }
        let packet;
        if(guest){
          const path=req.url.slice('/shared-preview'.length);
          const share=await previewShares?.get(req.headers['x-flowdoc-preview-share']);
          if(!share)return send(410,{error:'preview_share_unavailable'});
          if(req.method==='GET'&&!path){
            const {templateId,docKey,name,revision,fingerprint,definition}=share.draft;
            return send(200,{ok:true,value:{templateId,docKey,name,revision,fingerprint,readOnly:true,
              definition:{...definition,examples:[]}},expiresAt:new Date(share.until).toISOString()});
          }
          if(req.method==='POST'&&['/preview','/export'].includes(path))body=await readBody(4*1024*1024);
          packet=previewSharePacket(req.method,path,share,req.headers['x-flowdoc-preview-session'],body);
          if(!packet)return send(404,{error:'not_found'});
          ({action,templateId}=packet);
        }else{
          if(!action)return send(404,{error:'not_found'});
          if(req.method!=='GET')body=await readBody(['preview','export'].includes(action)?4*1024*1024:
            ['structure','create'].includes(action)?2*1024*1024:4096);
          packet={action,templateId,body};
        }
        const reply=await ask(packet);
        if(['get','create','rename','structure'].includes(action)&&reply.status<300&&reply.body?.value&&previewShares&&publicOrigin){
          send(reply.status,{...reply.body,value:{...reply.body.value,canSharePreview:true}});
        }else if(action==='publication'&&reply.status===200&&reply.body?.value){
          const value=reply.body.value,target=await documentsTarget(documentsBaseUrlFor?.(value)??documentsBaseUrl,value);
          send(200,{...reply.body,value:{...value,target}});
        }else if(action==='export'&&reply.status===200){
          const {id,size,mediaType,disposition,warningCount}=reply.body;
          let released=false;
          async function release(){
            const result=await ask({action:'export-release',templateId,body:{id}});
            released=result.status===200;
          }
          async function* chunks(){
            for(let offset=0;offset<size;){
              const result=await ask({action:'export-chunk',templateId,body:{id,offset}});
              if(result.status!==200||!result.bytes)throw Error('Export stream unavailable');
              const bytes=Buffer.from(result.bytes,'base64');
              offset+=bytes.length;
              if(!bytes.length||offset>size)throw Error('Invalid export chunk');
              if(offset===size)await release().catch(()=>{});
              yield bytes;
            }
          }
          try{
            if(!res.destroyed){
              res.writeHead(200,{'Content-Type':mediaType,'Content-Disposition':disposition,'Content-Length':size,
                'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-FlowDoc-Warnings':warningCount});
              await pipeline(Readable.from(chunks()),res);
            }
          }finally{if(!released)await release().catch(()=>{});}
        }else if(['preview-asset','trial-asset'].includes(action)&&reply.status===200&&['image/png','image/jpeg'].includes(reply.mediaType)){
          res.writeHead(200,{'Content-Type':reply.mediaType,'Cache-Control':action==='trial-asset'?'no-store':'private, max-age=3600','X-Content-Type-Options':'nosniff'});
          res.end(Buffer.from(reply.bytes,'base64'));
        }else send(reply.status,reply.body);
      }
      catch(error){
        if(res.headersSent||res.destroyed)return res.destroy();
        const inputErrors={400:'invalid_json',413:'body_too_large',415:'invalid_content_type'};
        if(inputErrors[error])return send(error,{error:inputErrors[error]});
        if(error?.message==='SHARE_LIMIT')return send(429,{error:'preview_share_limit'});
        if(error?.message==='SHARE_TOO_LARGE')return send(413,{error:'preview_share_too_large'});
        send(503,{error:'phase1_unavailable'});
      }
    });
  }};
}
