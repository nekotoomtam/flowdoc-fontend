import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';

const root='/home/ubuntu/flowdoc-editor-phase1-20261108';
const stage='/home/ubuntu/flowdoc-library-model20-staging-20261108';
const candidate='/home/ubuntu/flowdoc-audit-187957aecc2d/flowdoc-schema-freshapi-git055-complete-20261106/candidate';
const reference='/home/ubuntu/flowdoc-audit-187957aecc2d/flowdoc-schema-freshapi-full-direct-fonts4-20261106';
const nodeImage='sha256:07c71903922ef511587627683cb2a5041faa62273ee18da2cb52b434b5900388';
const labCommand=`sudo docker run --rm -i --network none --memory 1g --cpus 2 --user 0:0 -v ${root}:/phase1:ro -v ${stage}/socket:/socket -v ${stage}/staged-fonts:/fonts:ro -v ${candidate}:/candidate:ro -v ${reference}/converted:/reference:ro -v ${reference}/candidate/lab-full/assets:/reference-assets:ro -e FONT_STORAGE_DIR=/fonts --entrypoint node ${nodeImage} /phase1/phase1-server.mjs`;
const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;

export function phase1Bridge({enabled=process.env.FLOWDOC_EDITOR_PHASE1==='1'}={}) {
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
    const proc=spawn('ssh.exe',['-T','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes',
      '-o','ConnectTimeout=8','-i','C:/test/keyflow.key','ubuntu@129.221.205.23',labCommand],{windowsHide:true});
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
    if(pending.size>=8)return Promise.resolve({status:429,body:{error:'lab_busy'}});
    const proc=start(), id=++sequence;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>stop(proc),packet.action==='preview'?120000:30000);
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
      if(!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)||
        (req.headers.origin&&req.headers.origin!=='http://'+host)||
        (req.headers['sec-fetch-site']&&!['same-origin','none'].includes(req.headers['sec-fetch-site'])))
        return send(403,{error:'forbidden'});
      if(!enabled)return send(503,{error:'phase1_disabled'});
      const match=/^\/drafts\/([^/]+)(\/(?:preview|structure))?$/.exec(req.url??'');
      const pageRoute=/^\/drafts\/([^/]+)\/preview-pages\/(\d+)\/(\d+)$/.exec(req.url??'');
      const assetRoute=/^\/drafts\/([^/]+)\/preview-assets\/([a-f0-9-]+)$/.exec(req.url??'');
      let action,templateId,body;
      if(req.method==='GET'&&req.url==='/catalog')action='catalog';
      else if(req.method==='POST'&&req.url==='/drafts')action='create';
      else if(match&&uuid.test(match[1])){
        templateId=match[1];
        if(req.method==='GET'&&!match[2])action='get';
        if(req.method==='PUT'&&!match[2])action='rename';
        if(req.method==='POST'&&match[2]==='/preview')action='preview';
        if(req.method==='PUT'&&match[2]==='/structure')action='structure';
      }
      if(req.method==='GET'&&pageRoute&&uuid.test(pageRoute[1])){
        action='preview-page';templateId=pageRoute[1];body={revision:Number(pageRoute[2]),index:Number(pageRoute[3])};
      }
      if(req.method==='GET'&&assetRoute&&uuid.test(assetRoute[1])&&uuid.test(assetRoute[2])){
        action='preview-asset';templateId=assetRoute[1];body={key:assetRoute[2]};
      }
      if(!action)return send(404,{error:'not_found'});
      if(req.method!=='GET'){
        if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']??''))return send(415,{error:'invalid_content_type'});
        try{
          const chunks=[];let bytes=0;
          for await(const chunk of req){bytes+=chunk.length;if(bytes>(['structure','create'].includes(action)?2*1024*1024:4096))return send(413,{error:'body_too_large'});chunks.push(chunk);}
          body=JSON.parse(Buffer.concat(chunks).toString('utf8'));
        }catch{return send(400,{error:'invalid_json'});}
      }
      try{
        const reply=await ask({action,templateId,body});
        if(action==='preview-asset'&&reply.status===200&&['image/png','image/jpeg'].includes(reply.mediaType)){
          res.writeHead(200,{'Content-Type':reply.mediaType,'Cache-Control':'private, max-age=3600','X-Content-Type-Options':'nosniff'});
          res.end(Buffer.from(reply.bytes,'base64'));
        }else send(reply.status,reply.body);
      }
      catch{send(503,{error:'phase1_unavailable'});}
    });
  }};
}
