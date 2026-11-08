import {randomUUID} from 'node:crypto';

export const blankGlyph='\u00a0';
const blankGroupGlyph='\u200b';
export function previewInput(sample,paths=[]){
  if(!Array.isArray(paths)||paths.length>50000)throw Error('invalid_blank_fields');
  const marks=new Set();
  if(!paths.length)return {input:sample,marks};
  const input=structuredClone(sample),prefix='trial-'+randomUUID()+'-';
  for(const path of paths){
    if(!Array.isArray(path)||!path.length||path.length>32||!['data','sections'].includes(path[0]))throw Error('invalid_blank_path');
    let parent=input;
    for(const key of path.slice(0,-1)){
      if(!parent||!Object.hasOwn(parent,key))throw Error('invalid_blank_path');
      parent=parent[key];
    }
    const key=path.at(-1);
    if(!parent||!Object.hasOwn(parent,key)||parent[key]!=='')throw Error('invalid_blank_value');
    const marker=prefix+marks.size;
    marks.add(marker);parent[key]=marker;
  }
  return {input,marks};
}
export function markBlankRuns(resolved,marks){
  if(!marks.size)return;
  const omittedAnchors=new Set(),groupLabels=new Set();
  for(const node of Object.values(resolved.nodes))if(node.type==='table')for(const group of node.rowGroups??[]){
    const cell=group.groupLabel&&resolved.nodes[group.groupLabel.cellId];
    if(cell?.childIds.length===1)groupLabels.add(cell.childIds[0]);
  }
  const hosts=[resolved.nodes,...resolved.sections.flatMap(section=>[section.header?.nodes,section.footer?.nodes])];
  for(const host of hosts){
    for(const node of Object.values(host??{})){
      if(node.type!=='text-block')continue;
      let changed=false;
      for(const child of node.children)if(child.type==='text'&&marks.has(child.text)){child.text=groupLabels.has(node.id)?blankGroupGlyph:blankGlyph;changed=true;}
      if(changed&&node.children.length===1){
        delete node.props.toc;
        if(node.props.anchorId!==undefined){omittedAnchors.add(node.props.anchorId);delete node.props.anchorId;}
      }
    }
  }
  if(omittedAnchors.size)for(const host of hosts)for(const node of Object.values(host??{})){
    if(node.type==='text-block')node.children=node.children.map(child=>child.type==='reference'&&omittedAnchors.has(child.target)
      ?{id:child.id,type:'text',text:child.text}:child);
  }
}

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
    const cell=owner.fragment.nodes[owner.parents.get(source.sourceId)];
    const row=cell&&owner.fragment.nodes[owner.parents.get(cell.id)];
    const table=row&&owner.fragment.nodes[owner.parents.get(row.id)];
    let contentWidth;
    if(cell?.type==='table-cell'&&row?.type==='table-row'&&table?.type==='table'){
      const point=value=>value.unit==='mm'?value.value*72/25.4:value.value;
      const column=cell.props.columnIndex??row.cellIds.indexOf(cell.id);
      contentWidth=table.columns.slice(column,column+(cell.props.colSpan??1)).reduce((sum,col)=>sum+point(col.width),0)
        -(cell.props.padding?.left?point(cell.props.padding.left):4)-(cell.props.padding?.right?point(cell.props.padding.right):4);
    }
    return {key:JSON.stringify(path),value:value.replace(/\r\n?/g,'\n').replace(/\t/g,' '),end:0,commands:[],valid:true,
      blank:value==='',contentWidth,align:block.props.textAlign??'left'};
  }
  for(const [pageIndex,page] of draw.pages.entries()){
    for(const line of page.commands){
      const id=line.nodeId;
      if(!cache.has(id))cache.set(id,lookup(id));
      const edit=cache.get(id);
      if(!edit?.valid)continue;
      // A split line must occur at this exact source position. Fail closed on synthetic text.
      if(edit.blank){
        if(line.text===blankGlyph||line.text===blankGroupGlyph)edit.commands.push({line,start:0,pageIndex});
        else edit.valid=false;
        continue;
      }
      let start=edit.end;
      while(edit.value[start]==='\n')start++;
      if(!edit.value.startsWith(line.text,start)){edit.valid=false;continue;}
      edit.end=start+line.text.length;
      edit.commands.push({line,start,pageIndex});
    }
  }
  for(const [occurrence,edit] of cache){
    if(!edit?.valid||edit.value.slice(edit.end).replace(/\n/g,'')!=='')continue;
    let positions=locations.get(edit.key);
    if(!positions){positions=[];locations.set(edit.key,positions);}
    for(const {line,start,pageIndex} of edit.commands){
      const end=edit.blank?0:start+line.text.length;
      lines.set(line,{key:edit.key,occurrence,start,end,blank:edit.blank,contentWidth:edit.contentWidth,align:edit.align});
      positions.push({pageIndex,start,end,occurrence});
    }
  }
  const ordered=new Map();
  for(const [pageIndex,page] of draw.pages.entries())for(const line of page.commands){
    const binding=lines.get(line);
    if(binding&&!ordered.has(binding.occurrence))ordered.set(binding.occurrence,{occurrence:binding.occurrence,pageIndex});
  }
  const stops=[...ordered.values()],tab=new Map();
  for(const [index,stop] of stops.entries())tab.set(stop.occurrence,{previous:stops[index-1],next:stops[index+1]});
  return {lines,locations,tab};
}
