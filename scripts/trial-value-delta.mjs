const maxChanges=256;

/**
 * A patch changes only existing text controls. Any change to input shape,
 * attachments, or other control types requires a full snapshot.
 * @param {{data:unknown,sections:unknown,images:unknown}} base
 * @param {{data:unknown,sections:unknown,images:unknown}} next
 * @param {{has(key:string):boolean}} editable
 */
export function trialValueChanges(base,next,editable){
  /** @type {{path:(string|number)[],value:string}[]} */
  const changes=[];
  /** @param {any} before @param {any} after @param {(string|number)[]} path */
  function compare(before,after,path){
    if(before===after)return true;
    if(typeof before==='string'&&typeof after==='string'){
      if(changes.length>=maxChanges||path.length>32||!editable.has(JSON.stringify(path)))return false;
      changes.push({path,value:after});
      return true;
    }
    if(!before||!after||typeof before!=='object'||typeof after!=='object'||Array.isArray(before)!==Array.isArray(after))return false;
    const keys=Object.keys(before);
    return keys.length===Object.keys(after).length&&keys.every(key=>Object.hasOwn(after,key)&&
      compare(before[key],after[key],[...path,Array.isArray(before)?Number(key):key]));
  }
  return compare(base.data,next.data,['data'])&&compare(base.sections,next.sections,['sections'])&&
    compare(base.images,next.images,['images'])?changes:undefined;
}

/** Apply to a private copy, so failed or old requests cannot mutate a base run. */
export function applyTrialValueChanges(base,patch){
  if(!Array.isArray(patch?.changes)||patch.changes.length>maxChanges)throw Error('invalid_trial_patch');
  const trial=structuredClone({data:base.data,sections:base.sections,blanks:base.blanks??[]});
  const blanks=new Map(trial.blanks.map(path=>[JSON.stringify(path),path]));
  const seen=new Set();
  for(const change of patch.changes){
    const {path,value}=change??{};
    if(!Array.isArray(path)||path.length>32||typeof value!=='string'||
       !(path[0]==='data'&&path.length>=2||path[0]==='sections'&&path.length>=4&&
         Number.isSafeInteger(path[1])&&['data','header','footer'].includes(path[2])))
      throw Error('invalid_trial_patch');
    let parent=trial;
    for(const [index,key] of path.entries()){
      if(!parent||typeof parent!=='object'||(Array.isArray(parent)?!Number.isSafeInteger(key)||key<0:
        typeof key!=='string'||['__proto__','prototype','constructor'].includes(key))||!Object.hasOwn(parent,key))
        throw Error('invalid_trial_patch');
      if(index===path.length-1){
        if(typeof parent[key]!=='string')throw Error('invalid_trial_patch');
        const id=JSON.stringify(path);
        if(seen.has(id))throw Error('invalid_trial_patch');
        seen.add(id);
        parent[key]=value;
        if(value==='')blanks.set(id,path);else blanks.delete(id);
      }else parent=parent[key];
    }
  }
  return {...trial,blanks:[...blanks.values()],images:base.images,pageIndex:patch.pageIndex,focus:patch.focus};
}
