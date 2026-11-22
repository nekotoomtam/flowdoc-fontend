import {createServer} from 'node:http';
import {readFile, chmod, unlink} from 'node:fs/promises';
import {createPool} from '/candidate/dist/db/connection.js';
import {documentBaseline,setDocumentBaseline} from '/settings/baseline.mjs';

const pool=createPool(process.env.DATABASE_URL);
const fixture=JSON.parse(await readFile('/settings/fixture.json','utf8'));
const [consumer]=JSON.parse(await readFile('/settings/consumer.json','utf8'));
const png=new Blob([await readFile('/settings/sample.png')],{type:'image/png'});
const socket='/control/issuer.sock';
if(!consumer.docKeys.includes(fixture.docKey))throw Error('Issuer credential mismatch');
async function paper(version){
  const form=new FormData();
  form.set('payload',new Blob([JSON.stringify(fixture.payload)],{type:'application/json'}),'payload.json');
  for(const field of fixture.fields)form.set(field,png,'sample.png');
  const res=await fetch('http://127.0.0.1:5194/documents',{method:'POST',body:form,signal:AbortSignal.timeout(90000),
    headers:{Authorization:'Bearer '+consumer.token,'Doc-Key':fixture.docKey,'Output-Format':'pdf','Document-Version':String(version),Accept:'application/pdf'}});
  if(!res.ok)throw Error('Preview issuance failed '+res.status);
  const bytes=Buffer.from(await res.arrayBuffer()),task=res.headers.get('x-flowdoc-task-id');
  const pin=await pool.query('SELECT template_pin FROM tasks WHERE id=$1 AND owner_key=$2 AND created_by_principal=$3',[task,consumer.ownerKey,consumer.principalId]);
  if(Number(pin.rows[0]?.template_pin.version)!==version||pin.rows[0]?.template_pin.docKey!==fixture.docKey||bytes.subarray(0,5).toString()!=='%PDF-')throw Error('Unverified preview');
  return {version,pdf:bytes.toString('base64')};
}
async function handle(req,res){
  const send=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
  try{
    const state=await documentBaseline(pool,fixture.templateId,consumer);
    if(req.url==='/state'&&req.method==='GET')return send(200,state);
    if(req.method!=='POST'||!['/compare','/apply'].includes(req.url))return send(404,{});
    let input='';for await(const part of req){input+=part;if(input.length>4096)return send(413,{});}
    const body=JSON.parse(input);
    if(state.pinned!==body.pinned||state.versions[0]!==body.latest)return send(409,{error:'stale'});
    if(!state.versions.includes(body.version))return send(422,{error:'invalid_version'});
    if(req.url==='/compare'){
      const active=state.pinned??state.versions[0];
      const current=await paper(active),selected=await paper(body.version);
      return send(200,{papers:[current,selected]});
    }
    const result=await setDocumentBaseline(pool,fixture.templateId,consumer,body,body.version);
    return send(result==='updated'?200:result==='stale'?409:422,{result});
  }catch(error){console.error(error.message);return send(502,{error:'issuer_unavailable'});}
}
await unlink(socket).catch(e=>{if(e.code!=='ENOENT')throw e;});
createServer(handle).listen(socket,async()=>chmod(socket,0o600));

