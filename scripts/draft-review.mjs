import {isDeepStrictEqual} from 'node:util';
import {randomUUID,createHash} from 'node:crypto';

const result=(status,body)=>({status,body});
const uuid=s=>typeof s==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(s);
function structure(section){return section?.source?.fragment;}
function additions(original,copy){
 const before=original.sections[0],after=copy.sections[0],old=structure(before)?.nodes??{},nodes=structure(after)?.nodes??{};
 const tables=Object.values(nodes).filter(n=>n.type==='table'&&!old[n.id]);
 const changes=[];
 for(const table of tables){
   const rows=table.rowIds.map(id=>nodes[id]);
   const blocks=rows.flatMap(r=>r.cellIds.flatMap(id=>nodes[id].childIds));
   const header=nodes[blocks[0]]?.children?.find(n=>n.type==='text')?.text??'';
   changes.push({kind:'table',label:'เพิ่มตาราง '+table.columns.length+' คอลัมน์ · '+header,ids:blocks.slice(0,1)});
 }
 for(const field of Object.keys(after.inputSchema.fields)){
   if(Object.hasOwn(before.inputSchema.fields,field))continue;
   const ids=Object.values(nodes).filter(n=>n.children?.some(c=>c.type==='field-ref'&&c.scope==='section'&&c.key===field)).map(n=>n.id);
   changes.push({kind:'field',label:'ผูกตัวแปร '+field,ids});
 }
 return changes;
}

function addTable(definition,label,key){
 const section=definition.sections[0],fragment=structure(section);
 if(!fragment||Object.hasOwn(section.inputSchema.fields,key))return false;
 const insert=(type,props)=>{const id=randomUUID();fragment.nodes[id]={id,type,...props};return id;};
 const block=child=>insert('text-block',{role:{role:'paragraph'},props:{textStyleId:Object.keys(definition.styles)[0]},children:[{id:randomUUID(),...child}]});
 const row=child=>insert('table-row',{props:{allowBreak:false},cellIds:[insert('table-cell',{props:{columnIndex:0,rowSpan:1,colSpan:1},childIds:[block(child)]})]});
 const table=insert('table',{props:{headerRowCount:1,repeatHeaderRows:true},columns:[{width:{unit:'pt',value:240}}],
   rowIds:[row({type:'text',text:label}),row({type:'field-ref',scope:'section',key})]});
 section.inputSchema.fields[key]={type:'string',required:false};
 fragment.rootIds.push(table);return true;
}

export async function draftReview(action,ctx){
 const {body,parent,state,serviceIssue,load,service,createDraft,render}=ctx;
 if(!state.versions.includes(body.source))return result(422,{error:'invalid_source'});
 const sourceResult=await load(parent.docKey,body.source);
 if(!sourceResult.ok)return result(422,sourceResult);
 const stored=sourceResult.value,source=stored.template.definition;
 if(action==='clone-review'){
   if(!uuid(body.nonce))return result(422,{error:'invalid_clone'});
   const digest=createHash('sha256').update([parent.templateId,body.source,body.nonce].join(':')).digest('hex').slice(0,24);
   const definition={...source,docKey:'editor-draft-review-'+digest,name:source.name.slice(0,150)+' · ร่างจากรุ่น '+body.source};
   const response=await createDraft({definition,idempotencyKey:body.nonce});
   if(response.status>=300)return response;
   const copy=response.body.value;
   await serviceIssue.rememberReview(parent,copy.templateId,{source:body.source,latest:state.versions[0],fingerprint:stored.template.fingerprint});
   return result(201,{id:copy.templateId,revision:copy.revision,fingerprint:copy.fingerprint,changes:[]});
 }
 if(!uuid(body.id))return result(422,{error:'invalid_draft'});
 const provenance=await serviceIssue.reviewOrigin(parent,body.id);
 if(!provenance||provenance.source!==body.source||provenance.fingerprint!==stored.template.fingerprint)return result(404,{error:'draft_not_found'});
 const read=await service('GET','/'+body.id);
 if(read.statusCode!==200)return result(read.statusCode,read.json());
 const copy=read.json().value;
 if(copy.revision!==body.revision||copy.fingerprint!==body.fingerprint)return result(409,{error:'stale_draft'});
 let changes=additions(source,copy.definition);
 if(action==='save-review'){
   if(!uuid(body.nonce)||changes.length||typeof body.column!=='string'||!body.column.trim()||body.column.length>100||
     typeof body.field!=='string'||!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(body.field)||['constructor','prototype'].includes(body.field))return result(422,{error:'invalid_edit'});
   const definition=structuredClone(copy.definition);
   if(!addTable(definition,body.column.trim(),body.field))return result(422,{error:'invalid_table'});
   const save=await service('PUT','/'+body.id,{definition,expectedRevision:copy.revision,idempotencyKey:body.nonce});
   if(save.statusCode>=300)return result(save.statusCode,save.json());
   const saved=save.json().value;
   return result(200,{id:copy.templateId,revision:saved.revision,fingerprint:saved.fingerprint,changes:additions(source,saved.definition)});
 }
 if(action==='paper-review'){
   const papers=[];
   for(const isCopy of [false,true]){
     const draft=isCopy?copy:{templateId:parent.templateId,docKey:parent.docKey,definition:source,versionId:stored.versionId,revision:body.source,fingerprint:stored.template.fingerprint};
     const section=draft.definition.sections[0];
     const data=Object.fromEntries(Object.entries(section.inputSchema.fields).filter(([,v])=>v.type==='string').map(([k])=>[k,'{{'+k+'}}']));
     const trial={data:{},sections:[{sectionKey:section.sectionKey,instanceKey:'review',data}],images:[],blanks:[],pageIndex:body.pageIndex??0};
     const response=await render(draft.templateId,{expectedRevision:draft.revision,trial},{draft,baseline:true,review:true});
     if(response.status!==200)return response;
     papers.push({...response.body,version:isCopy?state.versions[0]+1:body.source,editable:[]});
   }
   return result(200,{papers,changes});
 }
 if(action==='publish-review'){
   const reviewed=state.pinned!=null&&body.comparedVersion===state.pinned;
   if(!reviewed&&(provenance.latest!==state.versions[0]||!changes.length))return result(409,{error:'stale_publication'});
   const definition={...copy.definition,templateId:parent.templateId,docKey:parent.docKey,name:source.name};
   if(reviewed){
     const latest=state.versions[0],snapshot=await load(parent.docKey,latest);
     if(!snapshot.ok)return result(409,{error:'latest_unavailable'});
     if(isDeepStrictEqual({...definition,version:latest},snapshot.value.template.definition))return result(409,{error:'already_published'});
   }
   return serviceIssue.publish({...parent,definition},state.versions[0]+1);
 }
 return result(404,{error:'not_found'});
}
