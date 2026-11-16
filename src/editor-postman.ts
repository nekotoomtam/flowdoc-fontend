import type {Definition, Field, Format, Schema} from './editor-structure';

type Path=(string|number)[];
export type ApiExample={payload:object;images:{path:Path;file?:File}[]};
type InputSection={sectionKey:string;label?:string;inputSchema:Schema;header?:Schema;footer?:Schema};
type InputContract={globalSchema:Schema;sections:InputSection[];areaFormats?:Record<string,Pick<Format,'ownerAreaId'|'key'|'inputSchema'>>};
export type PublishedContract=InputContract&{docKey:string;version:number;assembly?:{input:string}};
export const postmanImage='flowdoc-sample.png';
export const postmanDocumentUrl='{{FLOWDOC_BASE_URL}}/documents';
export const wordMediaType='application/vnd.openxmlformats-officedocument.wordprocessingml.document';
export const imagePart=(path:Path)=>'/'+[...path,'image'].map(value=>String(value).replaceAll('~','~0').replaceAll('/','~1')).join('/');
export const shellLiteral=(value:string)=>"'"+value.replaceAll("'","'\"'\"'")+"'";

export function draftInputContract(definition:Definition):InputContract{
  return {globalSchema:definition.globalSchema,areaFormats:definition.areaFormats,sections:definition.sections.map(section=>({
    sectionKey:section.sectionKey,label:section.label,inputSchema:section.inputSchema,header:section.header?.inputSchema,footer:section.footer?.inputSchema,
  }))};
}
const textExamples:Record<string,string>={
  projectName:'โครงการตัวอย่าง FlowDoc',documentVersion:'1.0',updatedDate:'16/11/2026',date:'16/11/2026',
  author:'ทีมเอกสาร',name:'ผู้ทดสอบ',position:'วิศวกรระบบ',organization:'FlowDoc Lab',
  address:'กรุงเทพมหานคร',telephone:'02-000-0000',fax:'02-000-0001',code:'REQ',
  text:'ข้อความสำหรับทดสอบการออกเอกสาร',detail:'ระบบสามารถตรวจข้อมูลและสร้างเอกสารได้',
  summary:'ทดสอบการสร้างเอกสารและตรวจผลที่ได้',remark:'ผ่านการตรวจสอบ',time:'09:00',
};
export function sampleTextValue(key:string,field:Field,sectionLabel='',headingLevel?:string){
  if(typeof field.default==='string'&&field.default.trim())return field.default;
  if(key==='text'&&headingLevel)return 'หัวข้อระดับ '+headingLevel+' · '+sectionLabel;
  return Object.hasOwn(textExamples,key)?textExamples[key]:'ตัวอย่าง '+(field.label||key);
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
  function values(schema:Schema,path:Path,sectionLabel='',headingLevel?:string):object{
    return Object.fromEntries(Object.entries(schema.fields).map(([key,field])=>{
      const at=[...path,key];
      if(field.type==='image'){
        images.push({path:at});
        return [key,{image:{upload:true}}];
      }
      if(field.type==='link')return [key,{type:'url',value:'https://example.com'}];
      if(field.type==='array')return [key,field.items?[values(field.items,[...at,0],sectionLabel)]:[]];
      if(field.type==='area'){
        const formats=byArea.get(field.areaId??'')??[];
        return [key,formats.map((format,i)=>({format:format.key,data:values(format.inputSchema,[...at,i,'data'],
          sectionLabel,/^heading([1-6])$/i.exec(format.key)?.[1])}))];
      }
      if(key==='anchor')return [key,'sample-heading-'+(++anchors)];
      return [key,sampleTextValue(key,field,sectionLabel,headingLevel)];
    }));
  }
  const data=values(contract.globalSchema,['data']);
  const sections=contract.sections.map((section,i)=>{
    const label=section.label||section.sectionKey;
    return {
      sectionKey:section.sectionKey,instanceKey:'example-'+(i+1),data:values(section.inputSchema,['sections',i,'data'],label),
      ...(section.header?{header:values(section.header,['sections',i,'header'],label)}:{}),
      ...(section.footer?{footer:values(section.footer,['sections',i,'footer'],label)}:{}),
    };
  });
  return {payload:{data,sections},images};
}

export function postmanCurl(contract:PublishedContract,example:ApiExample,baseUrl:string){
  const url=baseUrl?baseUrl+'/documents':postmanDocumentUrl;
  // Keep shell quotes and cURL's form option separator out of the JSON text.
  const body=JSON.stringify(example.payload,null,2).replace(/[;']/g,char=>char===';'?'\\u003b':'\\u0027');
  return [
    'curl --request POST '+shellLiteral(url),
    '  --header '+shellLiteral('Authorization: Bearer {{FLOWDOC_TOKEN}}'),
    '  --header '+shellLiteral('Doc-Key: '+contract.docKey),
    '  --header '+shellLiteral('Output-Format: docx'),
    '  --header '+shellLiteral('Accept: '+wordMediaType),
    '  --form '+shellLiteral('payload='+body+';type=application/json'),
    ...example.images.map(image=>'  --form '+shellLiteral(imagePart(image.path)+'=@'+postmanImage+';type=image/png')),
  ].join(' \\\n');
}

export function postmanCollection(contract:PublishedContract,example:ApiExample,baseUrl=''){
  const auth={type:'bearer',bearer:[{key:'token',value:'{{FLOWDOC_TOKEN}}',type:'string'}]};
  const tests=[
    "pm.test('FlowDoc returned a Word download', () => {",
    "  pm.response.to.have.status(200);",
    "  pm.expect(pm.response.headers.get('Content-Type')).to.eql('"+wordMediaType+"');",
    "  pm.expect(pm.response.headers.get('Content-Disposition')).to.include('.docx');",
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
      {name:'ดาวน์โหลด Word',event:[{listen:'test',script:{type:'text/javascript',exec:tests}}],
        request:{method:'POST',auth,url:postmanDocumentUrl,
          header:[{key:'Doc-Key',value:'{{DOC_KEY}}'},{key:'Output-Format',value:'docx'},{key:'Accept',value:wordMediaType}],
          body:{mode:'formdata',formdata:[
            {key:'payload',type:'text',contentType:'application/json',value:JSON.stringify(example.payload,null,2)},
            ...example.images.map(image=>({key:imagePart(image.path),type:'file',src:postmanImage,contentType:'image/png'})),
          ]}}},
    ],
  };
}
