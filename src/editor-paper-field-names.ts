import type {Definition, DocNode, Fragment, Schema} from './editor-structure';

// These forms place some captions and values in independent columns. Read
// the caption from the saved node so a wording edit appears in Preview.
export function paperFieldNames(def:Definition){
  const names=new WeakMap<Schema,Map<string,string>>();
  function record(schema:Schema,key:string,name:string){
    if(!Object.hasOwn(schema.fields,key)||!name)return;
    let fields=names.get(schema);
    if(!fields){fields=new Map();names.set(schema,fields);}
    if(!fields.has(key))fields.set(key,name);
  }
  function lines(node?:DocNode){
    return (node?.children??[]).map(i=>i.type==='text'?i.text??'':i.type==='line-break'?'\n':'').join('').trim().split('\n');
  }
  function pair(fragment:Fragment|undefined,schema:Schema,scope:string,valueId:string,captionId:string,line?:number){
    const value=fragment?.nodes[valueId]?.children?.find(i=>i.type==='field-ref'&&i.scope===scope);
    if(!value?.key)return;
    const parts=lines(fragment?.nodes[captionId]);
    record(schema,value.key,(line===undefined?parts.join(' '):parts[line])?.trim()??'');
  }
  for(const section of def.sections){
    const header=section.header?.fragment,body=section.source.fragment;
    for(const [value,caption,line] of [[17,15],[22,20],[41,38],[42,39],[48,47],[57,55],[65,64,0],[66,64,1],[67,64,2],[71,69]]){
      pair(header,section.inputSchema,'section','head-'+value,'head-'+caption,line);
    }
    for(let row=0;row<3;row++)pair(body,def.globalSchema,'global','meta-'+row+'-t2','meta-'+row+'-t0');
    for(const [value,caption] of [[17,13],[19,15],[39,35],[41,37]]){
      pair(body,section.inputSchema,'section','t'+value,'t'+caption);
    }
    if(header?.nodes['head-73']){
      for(const format of Object.values(def.areaFormats??{})){
        const rows=format.inputSchema.fields.rows?.items;
        if(format.key!=='cargo'||!rows||!Object.values(section.inputSchema.fields).some(f=>f.areaId===format.ownerAreaId))continue;
        for(const [key,id] of Object.entries({marks:73,description:75,weight:77,measurement:79}))
          record(rows,key,lines(header.nodes['head-'+id]).join(' '));
      }
    }
    for(const host of [body,header,section.footer?.fragment]){
      for(const n of Object.values(host?.nodes??{})){
        const parts=n.children;
        if(parts?.length!==2||parts[0].type!=='text'||parts[1].type!=='field-ref'||!parts[1].key)continue;
        const scope=parts[1].scope;
        if(scope==='global'||scope==='section')record(scope==='global'?def.globalSchema:section.inputSchema,parts[1].key,parts[0].text?.trim()??'');
      }
    }
  }
  const descriptive:Record<string,string>={projectName:'ชื่อโครงการ',organization:'ชื่อองค์กร',address:'ที่อยู่',banner:'ภาพหัวกระดาษ'};
  return (schema:Schema,key:string)=>names.get(schema)?.get(key)||schema.fields[key].label||
    (Object.hasOwn(descriptive,key)?descriptive[key]:key.replace(/([a-z])([A-Z])/g,'$1 $2').replace(/[_-]/g,' ').replace(/^./,c=>c.toUpperCase()));
}
