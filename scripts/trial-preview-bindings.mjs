// Project whole-field text blocks back to the input occurrence the Engine expanded.
export function trialBindings(definition,resolved,sample,draw){
  const hosts=new Map(), sections=new Map();
  const cache=new Map(),lines=new Map(),locations=new Map();
  const scopePath=(scope,index,local)=>scope==='global'?['data']:scope==='section'?['sections',index,'data']:
    scope==='header'||scope==='footer'?['sections',index,scope]:scope==='local'?local:undefined;
  function host(fragment,structure){
    if(!fragment)return;
    const parents=new Map();
    for(const node of Object.values(fragment.nodes))
      for(const id of node.rowIds??node.cellIds??node.childIds??[])parents.set(id,node.id);
    return {fragment,structure,parents};
  }
  for(const [index,section] of resolved.sections.entries()){
    const authored=definition.sections.find(s=>s.id===section.definitionId);
    sections.set(section.sectionId,{index,authored,body:host(authored.source.fragment,authored.source)});
    for(const band of ['header','footer']){
      const fragment=section[band];
      if(!fragment)continue;
      const bandHost=host(authored[band].fragment,authored[band]);
      for(const id of Object.keys(fragment.nodes))hosts.set(id,{source:fragment.sourceMap[id],host:bandHost});
    }
  }
  const formats=new Map(Object.entries(definition.areaFormats??{}).map(([id,f])=>[id,host(f.fragment,f)]));
  function lookup(id){
    const band=hosts.get(id),source=band?.source??resolved.sourceMap[id],section=sections.get(source?.sectionId);
    if(!section)return;
    const {index,authored}=section;
    let owner=band?.host??section.body,local;
    if(source.areaId!==undefined){
      owner=formats.get(source.areaFormatId);
      const field=Object.entries(authored.inputSchema.fields).find(([,value])=>value.areaId===source.areaId);
      const global=Object.entries(definition.globalSchema.fields).find(([,value])=>value.areaId===source.areaId);
      if(!field&&!global)return;
      local=[...scopePath(field?'section':'global',index), (field??global)[0],source.areaEntryIndex,'data'];
    }
    const block=owner?.fragment.nodes[source.sourceId];
    const field=block?.type==='text-block'&&block.children.length===1?block.children[0]:undefined;
    if(field?.type!=='field-ref')return;
    let path=scopePath(field.scope,index,local);
    if(field.scope==='group'||field.scope==='item'){
      const group=owner.structure.rowGroups?.find(g=>g.id===source.groupId);
      if(group){
        const base=scopePath(group.source.scope,index,local);
        if(base&&Number.isInteger(source.groupIndex)){
          path=[...base,group.source.key,source.groupIndex];
          if(field.scope==='item')path=Number.isInteger(source.itemIndex)?[...path,group.memberRepeat.source.key,source.itemIndex]:undefined;
        }
      }else if(field.scope==='item'&&Number.isInteger(source.itemIndex)){
        const repeat=source.repeatId!==undefined?owner.structure.cellRepeats?.find(r=>r.id===source.repeatId):
          owner.structure.repeats?.find(r=>r.rowTemplateId===owner.parents.get(owner.parents.get(source.sourceId)));
        const base=repeat&&scopePath(repeat.source.scope,index,local);
        if(base)path=[...base,repeat.source.key,source.itemIndex];
      }
    }
    if(!path)return;
    path=[...path,field.key];
    const value=path.reduce((current,key)=>current&&Object.hasOwn(current,key)?current[key]:undefined,sample);
    if(typeof value!=='string')return;
    return {key:JSON.stringify(path),value:value.replace(/\r\n?/g,'\n').replace(/\t/g,' '),end:0,commands:[],valid:true};
  }
  for(const [pageIndex,page] of draw.pages.entries()){
    for(const line of page.commands){
      const id=line.nodeId;
      if(!cache.has(id))cache.set(id,lookup(id));
      const edit=cache.get(id);
      if(!edit?.valid)continue;
      // A split line must occur at this exact source position. Fail closed on synthetic text.
      let start=edit.end;
      while(edit.value[start]==='\n')start++;
      if(!edit.value.startsWith(line.text,start)){edit.valid=false;continue;}
      edit.end=start+line.text.length;
      edit.commands.push({line,start,pageIndex});
    }
  }
  for(const edit of cache.values()){
    if(!edit?.valid||edit.value.slice(edit.end).replace(/\n/g,'')!=='')continue;
    let positions=locations.get(edit.key);
    if(!positions){positions=[];locations.set(edit.key,positions);}
    for(const {line,start,pageIndex} of edit.commands){
      lines.set(line,{key:edit.key,start,end:start+line.text.length});
      positions.push({pageIndex,start,end:start+line.text.length});
    }
  }
  return {lines,locations};
}
