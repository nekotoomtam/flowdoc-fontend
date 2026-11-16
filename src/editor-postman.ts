import type {Definition, Format, Schema} from './editor-structure';

type Path=(string|number)[];
export type ApiExample={payload:object;images:{path:Path;file?:File}[]};
type InputSection={sectionKey:string;inputSchema:Schema;header?:Schema;footer?:Schema};
type InputContract={globalSchema:Schema;sections:InputSection[];areaFormats?:Record<string,Pick<Format,'ownerAreaId'|'key'|'inputSchema'>>};
export type PublishedContract=InputContract&{docKey:string;version:number;assembly?:{input:string}};
export const postmanImage='flowdoc-sample.png';
export const postmanDocumentUrl='{{FLOWDOC_BASE_URL}}/documents';
export const imagePart=(path:Path)=>'/'+[...path,'image'].map(value=>String(value).replaceAll('~','~0').replaceAll('/','~1')).join('/');

export function draftInputContract(definition:Definition):InputContract{
  return {globalSchema:definition.globalSchema,areaFormats:definition.areaFormats,sections:definition.sections.map(section=>({
    sectionKey:section.sectionKey,inputSchema:section.inputSchema,header:section.header?.inputSchema,footer:section.footer?.inputSchema,
  }))};
}
const textExamples:Record<string,string>={
  projectName:'โครงการตัวอย่าง FlowDoc',documentVersion:'1.0',updatedDate:'16/11/2026',date:'16/11/2026',
  author:'ทีมเอกสาร',name:'ผู้ทดสอบ',position:'วิศวกรระบบ',organization:'FlowDoc Lab',
  address:'กรุงเทพมหานคร',telephone:'02-000-0000',fax:'02-000-0001',code:'REQ',
  text:'ข้อความสำหรับทดสอบการออกเอกสาร',detail:'ระบบสามารถตรวจข้อมูลและสร้างเอกสารได้',
  summary:'ทดสอบการสร้างเอกสารและตรวจผลที่ได้',remark:'ผ่านการตรวจสอบ',time:'09:00',
};
export function fullApiExample(contract:InputContract,tablePaths:readonly string[]):ApiExample{
  const images:ApiExample['images']=[];
  const tableLists=new Set(tablePaths);
  const byArea=new Map<string,NonNullable<InputContract['areaFormats']>[string][]>();
  for(const format of Object.values(contract.areaFormats??{})){
    const entries=byArea.get(format.ownerAreaId)??[];
    entries.push(format);
    byArea.set(format.ownerAreaId,entries);
  }
  let anchors=0;
  function values(schema:Schema,path:Path,schemaPath:string[],rows:number[]=[]):object{
    return Object.fromEntries(Object.entries(schema.fields).map(([key,field])=>{
      const at=[...path,key];
      const fieldPath=[...schemaPath,key];
      if(field.type==='image'){
        images.push({path:at});
        return [key,{image:{upload:true}}];
      }
      if(field.type==='link')return [key,{type:'url',value:'https://example.com'}];
      if(field.type==='array'){
        const items=field.items;
        const count=tableLists.has(JSON.stringify(fieldPath))?3:1;
        return [key,items?Array.from({length:count},(_,i)=>values(items,[...at,i],fieldPath,[...rows,i+1])):[]];
      }
      if(field.type==='area'){
        const formats=byArea.get(field.areaId??'')??[];
        return [key,formats.map((format,i)=>({format:format.key,data:values(format.inputSchema,[...at,i,'data'],
          ['format',format.ownerAreaId,format.key])}))];
      }
      if(key==='anchor')return [key,'sample-heading-'+(++anchors)];
      if(typeof field.default==='string'&&field.default.trim())return [key,field.default];
      const sample=Object.hasOwn(textExamples,key)?textExamples[key]:'ตัวอย่าง '+(field.label||key);
      return [key,rows.length&&!['date','time'].includes(key)?sample+' '+rows.join('.') : sample];
    }));
  }
  const data=values(contract.globalSchema,['data'],['data']);
  const sections=contract.sections.map((section,i)=>({
    sectionKey:section.sectionKey,instanceKey:'example-'+(i+1),data:values(section.inputSchema,['sections',i,'data'],['section',section.sectionKey,'data']),
    ...(section.header?{header:values(section.header,['sections',i,'header'],['section',section.sectionKey,'header'])}:{}),
    ...(section.footer?{footer:values(section.footer,['sections',i,'footer'],['section',section.sectionKey,'footer'])}:{}),
  }));
  return {payload:{data,sections},images};
}

export function postmanCollection(contract:PublishedContract,example:ApiExample,baseUrl=''){
  const auth={type:'bearer',bearer:[{key:'token',value:'{{FLOWDOC_TOKEN}}',type:'string'}]};
  const tests=[
    "pm.test('FlowDoc returned a multipart document response', () => {",
    "  pm.response.to.have.status(200);",
    "  pm.expect(pm.response.headers.get('Content-Type')).to.include('multipart/mixed');",
    "  const body = pm.response.text();",
    "  pm.expect(body).to.match(/\x22type\x22\\s*:\\s*\x22artifact\x22/);",
    "  pm.expect(body).to.match(/\x22completeness\x22\\s*:\\s*\x22complete\x22/);",
    "  pm.expect(body).to.include('Content-Type: application/pdf');",
    '});',
  ];
  return {
    info:{name:'FlowDoc · '+contract.docKey+' · v'+contract.version,
      schema:'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
      description:'ตั้ง FLOWDOC_BASE_URL และ FLOWDOC_TOKEN จาก Service ที่เผยแพร่โครงนี้ หากมีรูป ให้เลือก '+postmanImage+' ในช่องรูปของ Body → form-data'},
    variable:[
      {key:'FLOWDOC_BASE_URL',value:baseUrl,type:'string'},{key:'FLOWDOC_TOKEN',value:'',type:'string'},
      {key:'DOC_KEY',value:contract.docKey,type:'string'},
    ],
    item:[
      {name:'ออก PDF',event:[{listen:'test',script:{type:'text/javascript',exec:tests}}],
        request:{method:'POST',auth,url:postmanDocumentUrl,
          header:[{key:'Doc-Key',value:'{{DOC_KEY}}'},{key:'Output-Format',value:'pdf'},{key:'Accept',value:'multipart/mixed'}],
          body:{mode:'formdata',formdata:[
            {key:'payload',type:'text',contentType:'application/json',value:JSON.stringify(example.payload,null,2)},
            ...example.images.map(image=>({key:imagePart(image.path),type:'file',src:postmanImage,contentType:'image/png'})),
          ]}}},
    ],
  };
}
