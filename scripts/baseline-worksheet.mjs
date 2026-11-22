// Preserve each repeated row's path when inserting a Preview-only blank.
export function baselineWorksheet(definition,sample,edits){
  const trial={...structuredClone(sample),images:[],blanks:[]};
  const editable=[],omitted=[],insertedBlanks=[];
  function visit(schema,data,path){
    if(!schema?.fields||!data||typeof data!=='object'||Array.isArray(data))return;
    for(const key of Object.keys(data)){
      if(!Object.hasOwn(schema.fields,key)){
        omitted.push([...path,key]);
        delete data[key];
      }
    }
    for(const [key,field] of Object.entries(schema?.fields??{})){
      const at=[...path,key],current=data[key];
      if(field.type==='array'&&Array.isArray(current)){
        current.forEach((row,i)=>visit(field.items,row,[...at,i]));
      }else if(field.type==='string'&&(current===undefined||current==='')&&field.default===undefined){
        const address=JSON.stringify(at);
        editable.push(address);
        data[key]=Object.hasOwn(edits,address)?edits[address]:'';
        if(!data[key]){
          trial.blanks.push(at);
          if(current===undefined)insertedBlanks.push(at);
        }
      }
    }
  }
  visit(definition.globalSchema,trial.data,['data']);
  for(const [i,instance] of trial.sections.entries()){
    const section=definition.sections.find(s=>s.sectionKey===instance.sectionKey);
    visit(section?.inputSchema,instance.data,['sections',i,'data']);
    for(const band of ['header','footer'])visit(section?.[band]?.inputSchema,instance[band],['sections',i,band]);
  }
  const payload=structuredClone({data:trial.data,sections:trial.sections});
  for(const path of insertedBlanks){
    const obj=path.slice(0,-1).reduce((parent,key)=>parent[key],payload);
    delete obj[path.at(-1)];
  }
  return {trial,editable,omitted,payload};
}
