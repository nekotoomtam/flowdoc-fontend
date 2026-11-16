import {randomBytes} from 'node:crypto';

const outputTypes={
  docx:{mediaType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',signature:'504b0304'},
  pdf:{mediaType:'application/pdf',signature:'255044462d'},
};
const ttl=5*60_000;
const maxUses=10;
const grantLimit=32;
const maxPayloadBytes=256*1024;
const maxImageFields=24;
const maxOutputBytes=16*1024*1024;

function mockImageFields(payload){
  const fields=[];
  function visit(value,path){
    if(!value||typeof value!=='object')return;
    if(path.length>48)throw Error('Sample payload is too deeply nested');
    if(!Array.isArray(value)&&Object.keys(value).length===1&&value.image&&
      Object.keys(value.image).length===1&&value.image.upload===true){
      const name='/'+[...path,'image'].map(key=>key.replaceAll('~','~0').replaceAll('/','~1')).join('/');
      if(Buffer.byteLength(name)>2048||/[\x00-\x1f\x7f]/.test(name)||fields.length>=maxImageFields)
        throw Error('Invalid sample image parts');
      fields.push(name);
      return;
    }
    for(const [key,child] of Object.entries(value))visit(child,[...path,key]);
  }
  visit(payload,[]);
  return fields;
}

export function createLabSampleWord({fixture,image,serviceUrl,serviceToken,clock=Date.now}){
  const {docKey,templateId,version,payload,fields}=fixture;
  const expectedFields=payload?mockImageFields(payload):[];
  if(!templateId||!docKey||(!Number.isSafeInteger(version)||version<1)||expectedFields.length!==4||!Array.isArray(fields)||
    JSON.stringify([...expectedFields].sort())!==JSON.stringify([...fields].sort())||
    !image?.length||!serviceToken)throw Error('Invalid SRS sample Word configuration');
  const capability='/api/editor-phase1/drafts/'+templateId+'/sample-documents';
  const route='/documents';
  const exampleBody=JSON.stringify(payload,null,2).replaceAll("'","\\u0027");
  const grants=new Map();
  let active=0;
  const json=(response,status,data)=>response.writeHead(status,{
    'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',
  }).end(JSON.stringify(data));
  const reject=(response,status,error)=>json(response,status,{error});

  return async function handle(request,response,pathname){
    if(pathname!==route&&pathname!==capability&&!pathname.startsWith(capability+'/issue/'))return false;
    await respond(request,response,pathname);
    return true;
  };

  async function respond(request,response,pathname){
    if(request.method==='GET'&&pathname===capability)return json(response,200,{available:true,version,maxUses,ttlSeconds:ttl/1000});
    if(request.method!=='POST')return reject(response,405,'method_not_allowed');
    const now=clock();
    for(const [grant,{expires}] of grants)if(expires<=now)grants.delete(grant);
    if(pathname!==route){
      const format=pathname.slice((capability+'/issue/').length);
      if(!Object.hasOwn(outputTypes,format))return reject(response,400,'invalid_output_format');
      if(request.headers['transfer-encoding']||Number(request.headers['content-length']??0)!==0)
        return reject(response,400,'sample_issue_has_no_request_body');
      const origin='http://'+request.headers.host;
      if(request.headers.origin!==origin||request.headers['sec-fetch-site']!=='same-origin')
        return reject(response,403,'sample_issue_requires_lab_editor');
      if(grants.size>=grantLimit)return reject(response,429,'sample_grant_limit');
      const grant=randomBytes(24).toString('base64url');
      grants.set(grant,{expires:now+ttl,format,remaining:maxUses});
      const command=[
        "curl --request POST '"+origin+route+"'",
        "  --header 'Authorization: Bearer "+grant+"'",
        "  --header 'Doc-Key: "+docKey+"'",
        "  --header 'Output-Format: "+format+"'",
        "  --header 'Accept: "+outputTypes[format].mediaType+"'",
        "  --header 'Content-Type: application/json'",
        "  --data-raw '"+exampleBody+"'",
      ].join(' \\\n');
      return json(response,200,{command,expiresAt:new Date(now+ttl).toISOString()});
    }

    const grant=/^Bearer ([A-Za-z0-9_-]{32})$/.exec(request.headers.authorization??'')?.[1];
    const permission=grant&&grants.get(grant);
    if(!permission)return reject(response,401,'sample_grant_expired_or_used');
    if(permission.remaining===0)return reject(response,429,'sample_grant_limit_reached');
    const {format}=permission;
    const {mediaType,signature}=outputTypes[format];
    if(request.headers['doc-key']!==docKey||request.headers['output-format']!==format||
      request.headers.accept!==mediaType)return reject(response,406,'sample_grant_requires_matching_document_and_format');
    if(!/^application\/json(?:\s*;|\s*$)/i.test(request.headers['content-type']??''))
      return reject(response,415,'sample_requires_json');
    if(Number(request.headers['content-length']??0)>maxPayloadBytes)
      return reject(response,413,'sample_payload_too_large');
    if(active>=2)return reject(response,429,'sample_busy');
    active++;
    try{
      const chunks=[];
      let received=0;
      request.setTimeout(5000);
      for await(const chunk of request.iterator({destroyOnReturn:false})){
        received+=chunk.length;
        if(received>maxPayloadBytes){
          response.setHeader('Connection','close');
          return reject(response,413,'sample_payload_too_large');
        }
        chunks.push(chunk);
      }
      request.setTimeout(0);
      const input=Buffer.concat(chunks);
      let images;
      try{
        const data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(input));
        if(!data||typeof data!=='object'||Array.isArray(data)||!data.data||
          typeof data.data!=='object'||Array.isArray(data.data)||!Array.isArray(data.sections)||
          Object.keys(data).some(key=>key!=='data'&&key!=='sections'))
          return reject(response,422,'sample_requires_data_and_sections');
        images=mockImageFields(data);
      }catch{
        return reject(response,422,'invalid_sample_json_or_images');
      }
      if(permission.expires<=clock())return reject(response,401,'sample_grant_expired_or_used');
      if(permission.remaining===0)return reject(response,429,'sample_grant_limit_reached');
      permission.remaining--;
      const signal=AbortSignal.timeout(90_000);
      const contract=await fetch(serviceUrl+'/templates/'+encodeURIComponent(docKey)+'/contract',{signal,redirect:'error'});
      if(!contract.ok||(await contract.json()).value?.version!==version)
        return reject(response,409,'sample_version_unavailable');
      const form=new FormData();
      form.set('payload',new Blob([input],{type:'application/json'}),'payload.json');
      const png=new Blob([image],{type:'image/png'});
      for(const field of images)form.set(field,png,'flowdoc-sample.png');
      const output=await fetch(serviceUrl+'/documents',{method:'POST',body:form,signal,redirect:'error',
        headers:{Authorization:'Bearer '+serviceToken,'Doc-Key':docKey,'Output-Format':format,Accept:mediaType}});
      const size=Number(output.headers.get('content-length'));
      if(output.status===400||output.status===422){
        await output.body?.cancel();
        return reject(response,422,'sample_data_does_not_match_srs');
      }
      if(!output.ok||output.headers.get('content-type')!==mediaType||!Number.isSafeInteger(size)||size<5||size>maxOutputBytes){
        await output.body?.cancel();
        return reject(response,502,'sample_output_unavailable');
      }
      const bytes=Buffer.from(await output.arrayBuffer());
      if(bytes.length!==size||bytes.subarray(0,signature.length/2).toString('hex')!==signature)
        return reject(response,502,'sample_output_unavailable');
      response.writeHead(200,{'Content-Type':mediaType,'Content-Length':bytes.length,
        'Content-Disposition':'attachment; filename="SRS-v'+version+'-sample.'+format+'"','Cache-Control':'no-store',
        'X-Content-Type-Options':'nosniff'}).end(bytes);
    }catch{
      reject(response,502,'sample_output_unavailable');
    }finally{
      active--;
    }
  }
}
