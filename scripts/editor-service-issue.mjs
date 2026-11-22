import {createHash, randomUUID} from 'node:crypto';
import {mkdir, readFile, rename, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {isDeepStrictEqual} from 'node:util';

const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const shaPattern=/^[a-f0-9]{64}$/;
const documentKey=/^[a-z0-9][a-z0-9-]{0,79}$/;
const maxPdfBytes=8*1024*1024;
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const isObject=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const pointerToken=key=>String(key).replaceAll('~','~0').replaceAll('/','~1');
const json=async path=>JSON.parse(await readFile(path,'utf8'));
const optionalFile=path=>readFile(path).catch(error=>{if(error.code!=='ENOENT')throw error;});
const sorted=value=>Array.isArray(value)?value.map(sorted):isObject(value)
  ?Object.fromEntries(Object.keys(value).sort().map(key=>[key,sorted(value[key])])):value;

class IssueError extends Error {
  constructor(status,code,issues){super(code);this.status=status;this.issues=issues;}
}
function fail(status,code,issues){throw new IssueError(status,code,issues);}
function publicFailure(error){
  if(!(error instanceof IssueError))return {status:503,body:{error:'SERVICE_ISSUE_UNAVAILABLE'}};
  return {status:error.status,body:{error:error.message,...(error.issues?{issues:error.issues}:{})}};
}
function worksheet(trial){
  if(!isObject(trial?.data)||!Array.isArray(trial.sections)||!Array.isArray(trial.images))
    fail(422,'INVALID_WORKSHEET');
  return {data:trial.data,sections:trial.sections,images:[...trial.images].sort((a,b)=>String(a?.id).localeCompare(String(b?.id)))};
}

export function assertIssuePreview(draft,proof,request){
  if(!Number.isSafeInteger(request?.expectedRevision)||draft.revision!==request.expectedRevision||
    draft.fingerprint!==request.fingerprint)fail(409,'STALE_CURRENT');
  if(!uuid.test(request.previewId??'')||!proof?.trial||proof.scope||proof.templateId!==draft.templateId||
    proof.revision!==draft.revision||proof.fingerprint!==draft.fingerprint)fail(409,'PREVIEW_REQUIRED');
  if(!isDeepStrictEqual(worksheet(proof.trial),worksheet(request.trial)))fail(409,'PREVIEW_INPUT_CHANGED');
  if(proof.trial.blanks?.length)fail(422,'PREVIEW_PLACEHOLDERS');
}

function imageBytes(image){
  if(!uuid.test(image?.id??'')||typeof image.bytes!=='string'||image.bytes.length>1398104)
    fail(422,'INVALID_WORKSHEET_IMAGE');
  const bytes=Buffer.from(image.bytes,'base64');
  if(bytes.length===0||bytes.length>1048576||bytes.toString('base64')!==image.bytes)
    fail(422,'INVALID_WORKSHEET_IMAGE');
  const mediaType=bytes.subarray(0,8).toString('hex')==='89504e470d0a1a0a'?'image/png':
    bytes.subarray(0,3).toString('hex')==='ffd8ff'?'image/jpeg':undefined;
  if(!mediaType)fail(422,'INVALID_WORKSHEET_IMAGE');
  return {bytes,mediaType};
}

export function worksheetForm(definition,trial){
  const input=worksheet(trial);
  if(input.images.length>24)fail(422,'INVALID_WORKSHEET_IMAGE');
  const uploads=new Map(input.images.map(image=>[image?.id,imageBytes(image)]));
  if(uploads.size!==input.images.length)fail(422,'INVALID_WORKSHEET_IMAGE');
  const imageSize=[...uploads.values()].reduce((sum,image)=>sum+image.bytes.length,0);
  if(imageSize>2097152)fail(422,'INVALID_WORKSHEET_IMAGE');
  const payload=structuredClone({data:input.data,sections:input.sections});
  const formatFor=new Map(Object.values(definition.areaFormats??{}).map(format=>[[format.ownerAreaId,format.key].join('\0'),format]));
  const sectionsByKey=new Map(definition.sections.map(section=>[section.sectionKey,section]));
  const used=new Set(), parts=[];
  function walk(schema,values,path){
    if(!isObject(values)||!schema)return;
    for(const [key,field] of Object.entries(schema.fields??{})){
      if(!Object.hasOwn(values,key))continue;
      const value=values[key],fieldPath=path+'/'+pointerToken(key);
      if(field.type==='image'){
        const image=uploads.get(value);
        if(!image)fail(422,'INVALID_WORKSHEET_IMAGE');
        used.add(value);
        parts.push([fieldPath+'/image',image,value]);
        values[key]={image:{upload:true}};
      }else if(field.type==='array'&&Array.isArray(value)){
        value.forEach((item,index)=>walk(field.items,item,fieldPath+'/'+index));
      }else if(field.type==='area'&&Array.isArray(value)){
        value.forEach((item,index)=>walk(formatFor.get([field.areaId,item?.format].join('\0'))?.inputSchema,
          item?.data,fieldPath+'/'+index+'/data'));
      }
    }
  }
  walk(definition.globalSchema,payload.data,'/data');
  payload.sections.forEach((section,index)=>{
    const schema=sectionsByKey.get(section?.sectionKey);
    if(!schema)fail(422,'INVALID_WORKSHEET');
    walk(schema.inputSchema,section.data,'/sections/'+index+'/data');
    for(const band of ['header','footer'])walk(schema[band]?.inputSchema,section[band],'/sections/'+index+'/'+band);
  });
  if(used.size!==uploads.size||parts.length>1000)fail(422,'INVALID_WORKSHEET_IMAGE');
  const form=new FormData();
  form.set('payload',new Blob([JSON.stringify(payload)],{type:'application/json'}),'payload.json');
  for(const [path,{bytes,mediaType},id] of parts)
    form.set(path,new Blob([bytes],{type:mediaType}),id+(mediaType==='image/png'?'.png':'.jpeg'));
  return {form,worksheetSha256:sha(JSON.stringify(sorted(input)))};
}

export async function openEditorServiceIssue(configPath,{registerSnapshot,readSnapshot,managedLatest,backgroundStore,fetchImpl=fetch}={}){
  if(!configPath)return;
  const config=await json(configPath);
  const {serviceUrl,credentialsFile,artifactDirectory,backgroundDirectory,templates}=config;
  if(typeof serviceUrl!=='string'||!/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/.test(serviceUrl)||
    !credentialsFile||!artifactDirectory||!backgroundDirectory||!Array.isArray(templates)||!templates.length||
    templates.some(item=>!uuid.test(item?.templateId??'')||!documentKey.test(item?.docKey??'')))
    throw Error('Invalid Editor issue configuration');
  const [credential]=await json(credentialsFile);
  if(!credential?.token||credential.taskRead!==true||!Array.isArray(credential.docKeys)||
    !isDeepStrictEqual([...new Set(templates.map(item=>item.docKey))].sort(),[...credential.docKeys].sort()))
    throw Error('Editor issue credential scope mismatch');
  const allowed=new Map(templates.map(item=>[item.templateId,item]));
  const active=new Map();
  await mkdir(artifactDirectory,{recursive:true});
  const request=(path,options={})=>fetchImpl(serviceUrl+path,{...options,signal:AbortSignal.timeout(90000),redirect:'error',
    headers:{Authorization:'Bearer '+credential.token,...options.headers}});
  const accepts=draft=>allowed.get(draft?.templateId)?.docKey===draft?.docKey&&!draft?.readOnly&&!!draft?.definition;
  const byTask=(templateId,taskId)=>join(artifactDirectory,templateId+'-'+taskId+'.json');

  async function captureBackgrounds(draft){
    if(!accepts(draft)||!backgroundStore)return {};
    const settings=await backgroundStore.read(draft.templateId);
    return Object.fromEntries(Object.entries(settings).filter(([id])=>draft.definition.sections.some(section=>section.id===id))
      .map(([id,item])=>[id,item.sha256]).sort());
  }
  async function install(path,bytes){
    const buffer=Buffer.from(bytes);
    try{await writeFile(path,buffer,{flag:'wx'});}
    catch(error){
      if(error.code!=='EEXIST')throw error;
      if(!(await readFile(path)).equals(buffer))fail(409,'IMMUTABLE_PUBLICATION_CONFLICT');
    }
  }
  async function writeBackgroundPin(draft,version,backgrounds){
    const [binding,...rest]=Object.entries(backgrounds);
    const target=allowed.get(draft.templateId);
    if(!target.background){
      if(binding)fail(422,'BACKGROUND_NOT_SUPPORTED');
      return;
    }
    if(!binding||rest.length)fail(422,'SECTION_BACKGROUND_REQUIRED');
    const [sectionId,digest]=binding;
    if(!shaPattern.test(digest??''))fail(422,'INVALID_SECTION_BACKGROUND');
    const image=await backgroundStore?.image(draft.templateId,digest);
    if(!image||image.format!=='png'||sha(image.bytes)!==digest)fail(422,'INVALID_SECTION_BACKGROUND');
    const store=join(backgroundDirectory,draft.templateId);
    await mkdir(join(store,'objects'),{recursive:true});
    await install(join(store,'objects',digest+'.png'),image.bytes);
    await install(join(store,'v'+version+'.json'),JSON.stringify({templateId:draft.templateId,version,sectionId,sha256:digest}));
  }
  async function publishDefinition(draft,version,backgrounds){
    await writeBackgroundPin(draft,version,backgrounds);
    const definition={...draft.definition,version};
    const publication=await registerSnapshot(definition);
    if(!publication.ok)fail(422,'PUBLICATION_FAILED',publication.issues);
    const published=publication.value;
    const selected=await readSnapshot(draft.docKey,version);
    if(!selected.ok||selected.value.versionId!==published.versionId||published.templateId!==draft.templateId||
      published.docKey!==draft.docKey||published.version!==version||
      selected.value.template.fingerprint!==published.fingerprint||
      !isDeepStrictEqual(selected.value.template.definition,definition))fail(409,'IMMUTABLE_PUBLICATION_CONFLICT');
    return published;
  }
  async function generate(draft,proof,formatted,backgrounds,key,managedVersion){
    const receiptPath=join(artifactDirectory,key+'.json');
    const previous=await optionalFile(receiptPath);
    if(previous){
      const result=JSON.parse(previous);
      if(!(await optionalFile(join(artifactDirectory,result.taskId+'.pdf'))))fail(503,'ISSUE_ARTIFACT_UNAVAILABLE');
      return {status:200,body:result};
    }
    const version=managedVersion??draft.revision;
    let published;
    if(managedVersion!==null){
      const stored=await readSnapshot(draft.docKey,version);
      if(!stored.ok||!isDeepStrictEqual(stored.value.template.definition,{...draft.definition,version}))
        fail(409,'PUBLISH_DRAFT_FIRST');
      await writeBackgroundPin(draft,version,backgrounds);
      published={fingerprint:stored.value.template.fingerprint,versionId:stored.value.versionId};
    }else{
      published=await publishDefinition(draft,version,backgrounds);
    }
    const contract=await request('/templates/'+encodeURIComponent(draft.docKey)+'/contract?version='+version);
    if(!contract.ok||(await contract.json()).value?.version!==version)fail(409,'PUBLISHED_VERSION_UNAVAILABLE');
    const issued=await request('/documents',{method:'POST',headers:{'Doc-Key':draft.docKey,
      'Document-Version':String(version),'Output-Format':'pdf',Accept:'application/pdf'},body:formatted.form});
    if(!issued.ok){
      const details=await issued.json().catch(()=>undefined);
      fail(issued.status,'ISSUE_DOCUMENT_FAILED',details?.issues);
    }
    const byteLength=Number(issued.headers.get('content-length'));
    const taskId=issued.headers.get('x-flowdoc-task-id');
    const sha256=issued.headers.get('x-flowdoc-sha256');
    if(!/^application\/pdf\b/i.test(issued.headers.get('content-type')??'')||!Number.isSafeInteger(byteLength)||
      byteLength<5||byteLength>maxPdfBytes||!uuid.test(taskId??'')||!shaPattern.test(sha256??'')){
      await issued.body?.cancel();
      fail(502,'INVALID_PDF_RECEIPT');
    }
    const pdf=Buffer.from(await issued.arrayBuffer());
    if(pdf.length!==byteLength||pdf.subarray(0,5).toString()!=='%PDF-'||sha(pdf)!==sha256)
      fail(502,'INVALID_PDF_RECEIPT');
    for(let attempt=0;attempt<20;attempt++){
      const status=await request('/documents',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({taskId})});
      const result=status.ok?await status.json():{};
      const task=result.task??result.value?.task;
      if(task?.status==='succeeded'&&task.delivery==='succeeded'){
        if(task.taskId!==taskId||task.output?.sha256!==sha256||task.output.bytes!==byteLength||
          task.template?.docKey!==draft.docKey||task.template.version!==version||task.template.fingerprint!==published.fingerprint)
          fail(502,'INVALID_PDF_RECEIPT');
        if(task.completeness!=='complete')fail(422,'INCOMPLETE_PDF');
        if(!Number.isSafeInteger(task.output.pageCount)||task.output.pageCount!==proof.draw.pages.length)
          fail(502,'PDF_PREVIEW_PAGE_MISMATCH');
        const result={templateId:draft.templateId,docKey:draft.docKey,revision:draft.revision,version,
          draftFingerprint:draft.fingerprint,publishedFingerprint:published.fingerprint,
          versionId:published.versionId,worksheetSha256:formatted.worksheetSha256,backgrounds,
          taskId,byteLength,sha256,pageCount:task.output.pageCount,
          serviceHttpStatus:issued.status,generation:task.status,delivery:task.delivery,
          deliveryEvidence:task.deliveryEvidence,completeness:task.completeness,
          pdfUrl:'/api/editor-phase1/drafts/'+draft.templateId+'/issue/'+taskId+'.pdf'};
        const temp=join(artifactDirectory,taskId+'.'+randomUUID()+'.tmp');
        await writeFile(temp,pdf,{flag:'wx'});
        await rename(temp,join(artifactDirectory,taskId+'.pdf'));
        await install(byTask(draft.templateId,taskId),JSON.stringify(result));
        await install(receiptPath,JSON.stringify(result));
        return {status:201,body:result};
      }
      await delay(275);
    }
    fail(502,'DELIVERY_UNVERIFIED');
  }
  return {
    accepts,
    hasLibraryVersions(row){return allowed.has(row.templateId)&&allowed.get(row.templateId).docKey===row.docKey;},
    captureBackgrounds,
    async rememberReview(parent,id,origin){
      if(!accepts(parent)||!uuid.test(id))throw Error('Invalid review');
      await install(join(artifactDirectory,'review-'+parent.templateId+'-'+id+'.json'),JSON.stringify(origin));
    },
    async reviewOrigin(parent,id){
      if(!accepts(parent)||!uuid.test(id))return;
      const bytes=await optionalFile(join(artifactDirectory,'review-'+parent.templateId+'-'+id+'.json'));
      return bytes&&JSON.parse(bytes);
    },
    hasBaselineSample(draft){return accepts(draft)&&Boolean(allowed.get(draft.templateId)?.baselineSampleFile);},
    async baselineSample(draft){
      if(!this.hasBaselineSample(draft))return null;
      return json(allowed.get(draft.templateId).baselineSampleFile);
    },
    consumerFor(draft){
      if(!accepts(draft))return null;
      return {ownerKey:credential.ownerKey,principalId:credential.principalId};
    },
    async publish(draft,version){
      if(!accepts(draft))return {status:404,body:{error:'ISSUE_NOT_AVAILABLE'}};
      try{return {status:201,body:{value:await publishDefinition(draft,version,await captureBackgrounds(draft))}};}
      catch(error){return publicFailure(error);}
    },
    async issue(draft,proof,body,localBackgrounds){
      try{
        if(!accepts(draft))fail(404,'ISSUE_NOT_AVAILABLE');
        assertIssuePreview(draft,proof,body);
        const backgrounds=await captureBackgrounds(draft);
        if(!isDeepStrictEqual(backgrounds,proof.backgrounds)||
          !isDeepStrictEqual(backgrounds,Object.fromEntries(Object.entries(localBackgrounds??{})
            .filter(([id])=>draft.definition.sections.some(section=>section.id===id)).map(([id,item])=>[id,item.sha256]).sort())))
          fail(409,'PREVIEW_BACKGROUND_CHANGED');
        const formatted=worksheetForm(draft.definition,proof.trial);
        const managedVersion=await managedLatest?.(draft,{ownerKey:credential.ownerKey,principalId:credential.principalId})??null;
        const parts=[draft.templateId,draft.revision,draft.fingerprint,backgrounds,formatted.worksheetSha256];
        if(managedVersion!==null)parts.push(managedVersion);
        const key=sha(JSON.stringify(parts));
        if(active.has(key))return await active.get(key);
        if(active.size)fail(429,'ISSUE_BUSY');
        const writing=generate(draft,proof,formatted,backgrounds,key,managedVersion);
        active.set(key,writing);
        try{return await writing;}finally{active.delete(key);}
      }catch(error){return publicFailure(error);}
    },
    async file(draft,taskId){
      if(!accepts(draft)||!uuid.test(taskId??''))return {status:404,body:{error:'not_found'}};
      const receipt=await optionalFile(byTask(draft.templateId,taskId));
      const pdf=receipt&&await optionalFile(join(artifactDirectory,taskId+'.pdf'));
      if(!pdf)return {status:404,body:{error:'not_found'}};
      const {sha256,byteLength}=JSON.parse(receipt);
      if(pdf.length!==byteLength||pdf.length>maxPdfBytes||sha(pdf)!==sha256)
        return {status:503,body:{error:'ISSUE_ARTIFACT_UNAVAILABLE'}};
      return {status:200,body:{sha256,byteLength},bytes:pdf.toString('base64')};
    },
  };
}
