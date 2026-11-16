export function tableSamplePaths(definition){
  if(!Array.isArray(definition?.sections))return [];
  const paths=new Set(),byArea=new Map();
  for(const section of definition.sections){
    for(const node of Object.values(section.source?.fragment?.nodes??{})){
      if(node.type==='area'&&node.props?.areaId)byArea.set(node.props.areaId,section.sectionKey);
    }
  }
  function collect(host,sectionKey,formatPath){
    if(!host)return;
    function pathFor(source){
      if(source?.scope==='global')return ['data',source.key];
      if(source?.scope==='section'&&sectionKey)return ['section',sectionKey,'data',source.key];
      if(source?.scope==='local'&&formatPath)return [...formatPath,source.key];
    }
    for(const repeat of host.repeats??[]){
      const path=pathFor(repeat.source);
      if(path)paths.add(JSON.stringify(path));
    }
    for(const group of host.rowGroups??[]){
      const path=pathFor(group.source);
      if(!path)continue;
      paths.add(JSON.stringify(path));
      const members=group.memberRepeat?.source;
      if(members?.scope==='group')paths.add(JSON.stringify([...path,members.key]));
    }
  }
  for(const section of definition.sections)collect(section.source,section.sectionKey);
  for(const format of Object.values(definition.areaFormats??{})){
    collect(format,byArea.get(format.ownerAreaId),['format',format.ownerAreaId,format.key]);
  }
  return [...paths];
}
