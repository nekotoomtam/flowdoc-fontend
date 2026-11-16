import type {Definition, Format, Schema} from './editor-structure';

type Path=(string|number)[];
export type ApiExample={payload:object;images:{path:Path;file?:File}[]};
type InputSection={sectionKey:string;inputSchema:Schema;header?:Schema;footer?:Schema};
type InputContract={globalSchema:Schema;sections:InputSection[];areaFormats?:Record<string,Pick<Format,'ownerAreaId'|'key'|'inputSchema'>>};
export type PublishedContract=InputContract&{docKey:string;version:number;assembly?:{input:string}};
export const postmanImage='flowdoc-sample.png';
export const imagePart=(path:Path)=>'/'+[...path,'image'].map(value=>String(value).replaceAll('~','~0').replaceAll('/','~1')).join('/');

export function draftInputContract(definition:Definition):InputContract{
  return {globalSchema:definition.globalSchema,areaFormats:definition.areaFormats,sections:definition.sections.map(section=>({
    sectionKey:section.sectionKey,inputSchema:section.inputSchema,header:section.header?.inputSchema,footer:section.footer?.inputSchema,
  }))};
}
export function fullApiExample(contract:InputContract):ApiExample{
  const images:ApiExample['images']=[];
  const byArea=new Map<string,NonNullable<InputContract['areaFormats']>[string][]>();
  for(const format of Object.values(contract.areaFormats??{})){
    const entries=byArea.get(format.ownerAreaId)??[];
    entries.push(format);
    byArea.set(format.ownerAreaId,entries);
  }
  let anchors=0;
  function values(schema:Schema,path:Path):object{
    return Object.fromEntries(Object.entries(schema.fields).map(([key,field])=>{
      const at=[...path,key];
      if(field.type==='image'){
        images.push({path:at});
        return [key,{image:{upload:true}}];
      }
      if(field.type==='link')return [key,{type:'url',value:'https://example.com'}];
      if(field.type==='array')return [key,field.items?[values(field.items,[...at,0])]:[]];
      if(field.type==='area'){
        const formats=byArea.get(field.areaId??'')??[];
        return [key,formats.map((format,i)=>({format:format.key,data:values(format.inputSchema,[...at,i,'data'])}))];
      }
      if(key==='anchor')return [key,'sample-heading-'+(++anchors)];
      if(key==='projectName')return [key,'โครงการตัวอย่าง FlowDoc'];
      return [key,typeof field.default==='string'&&field.default?field.default:'ตัวอย่าง '+key];
    }));
  }
  const data=values(contract.globalSchema,['data']);
  const sections=contract.sections.map((section,i)=>({
    sectionKey:section.sectionKey,instanceKey:'example-'+(i+1),data:values(section.inputSchema,['sections',i,'data']),
    ...(section.header?{header:values(section.header,['sections',i,'header'])}:{}),
    ...(section.footer?{footer:values(section.footer,['sections',i,'footer'])}:{}),
  }));
  return {payload:{data,sections},images};
}

export function postmanCollection(contract:PublishedContract,example:ApiExample){
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
      {key:'FLOWDOC_BASE_URL',value:'',type:'string'},{key:'FLOWDOC_TOKEN',value:'',type:'string'},
      {key:'DOC_KEY',value:contract.docKey,type:'string'},{key:'VERSION',value:String(contract.version),type:'string'},
    ],
    item:[
      {name:'อ่านสัญญาข้อมูลของโครง',request:{method:'GET',
        url:'{{FLOWDOC_BASE_URL}}/templates/{{DOC_KEY}}/contract?version={{VERSION}}'}},
      {name:'ออก PDF · ตัวอย่างครบทุกตัวแปร',event:[{listen:'test',script:{type:'text/javascript',exec:tests}}],
        request:{method:'POST',auth,url:'{{FLOWDOC_BASE_URL}}/documents',
          header:[{key:'Doc-Key',value:'{{DOC_KEY}}'},{key:'Output-Format',value:'pdf'},{key:'Accept',value:'multipart/mixed'}],
          body:{mode:'formdata',formdata:[
            {key:'payload',type:'text',contentType:'application/json',value:JSON.stringify(example.payload,null,2)},
            ...example.images.map(image=>({key:imagePart(image.path),type:'file',src:postmanImage,contentType:'image/png'})),
          ]}}},
    ],
  };
}
