import {randomBytes} from 'node:crypto';

const word='application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const ttl=5*60_000;
const grantLimit=32;
const maxWordBytes=2*1024*1024;

export function createLabSampleWord({fixture,image,serviceUrl,serviceToken,clock=Date.now}){
  const {docKey,templateId,version,payload,fields}=fixture;
  if(!templateId||!docKey||version!==2||!payload||new Set(fields).size!==4||
    fields.length!==4||!image?.length||!serviceToken)throw Error('Invalid SRS sample Word configuration');
  const route='/api/editor-phase1/drafts/'+templateId+'/sample-word';
  const grants=new Map();
  let active=0;
  const json=(response,status,data)=>response.writeHead(status,{
    'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',
  }).end(JSON.stringify(data));
  const reject=(response,status,error)=>json(response,status,{error});

  return async function handle(request,response,pathname){
    if(pathname!==route&&pathname!==route+'/issue')return false;
    await respond(request,response,pathname);
    return true;
  };

  async function respond(request,response,pathname){
    if(request.method==='GET'&&pathname===route)return json(response,200,{available:true});
    if(request.method!=='POST')return reject(response,405,'method_not_allowed');
    // This Lab capability takes no caller data and renders only the fixed fixture.
    if(request.headers['transfer-encoding']||Number(request.headers['content-length']??0)!==0)
      return reject(response,400,'sample_has_no_request_body');

    const now=clock();
    for(const [grant,expires] of grants)if(expires<=now)grants.delete(grant);
    if(pathname===route+'/issue'){
      const origin='http://'+request.headers.host;
      if(request.headers.origin!==origin||request.headers['sec-fetch-site']!=='same-origin')
        return reject(response,403,'sample_issue_requires_lab_editor');
      if(grants.size>=grantLimit)return reject(response,429,'sample_grant_limit');
      const grant=randomBytes(24).toString('base64url');
      grants.set(grant,now+ttl);
      const command=[
        "curl --request POST '"+origin+route+"'",
        "  --header 'Authorization: Bearer "+grant+"'",
        "  --header 'Accept: "+word+"'",
      ].join(' \\\n');
      return json(response,200,{command,expiresAt:new Date(now+ttl).toISOString()});
    }

    const grant=/^Bearer ([A-Za-z0-9_-]{32})$/.exec(request.headers.authorization??'')?.[1];
    if(!grant||!grants.has(grant))return reject(response,401,'sample_grant_expired_or_used');
    if(active>=2)return reject(response,429,'sample_busy');
    grants.delete(grant);
    active++;
    try{
      const signal=AbortSignal.timeout(90_000);
      const contract=await fetch(serviceUrl+'/templates/'+encodeURIComponent(docKey)+'/contract',{signal,redirect:'error'});
      if(!contract.ok||(await contract.json()).value?.version!==version)
        return reject(response,409,'sample_version_unavailable');
      const form=new FormData();
      form.set('payload',new Blob([JSON.stringify(payload)],{type:'application/json'}),'payload.json');
      const png=new Blob([image],{type:'image/png'});
      for(const field of fields)form.set(field,png,'flowdoc-sample.png');
      const output=await fetch(serviceUrl+'/documents',{method:'POST',body:form,signal,redirect:'error',
        headers:{Authorization:'Bearer '+serviceToken,'Doc-Key':docKey,'Output-Format':'docx',Accept:word}});
      const size=Number(output.headers.get('content-length'));
      if(!output.ok||output.headers.get('content-type')!==word||!Number.isSafeInteger(size)||size<4||size>maxWordBytes){
        await output.body?.cancel();
        return reject(response,502,'sample_word_unavailable');
      }
      const bytes=Buffer.from(await output.arrayBuffer());
      if(bytes.length!==size||bytes.subarray(0,4).toString('hex')!=='504b0304')
        return reject(response,502,'sample_word_unavailable');
      response.writeHead(200,{'Content-Type':word,'Content-Length':bytes.length,
        'Content-Disposition':'attachment; filename="SRS-v2-sample.docx"','Cache-Control':'no-store',
        'X-Content-Type-Options':'nosniff'}).end(bytes);
    }catch{
      reject(response,502,'sample_word_unavailable');
    }finally{
      active--;
    }
  }
}
