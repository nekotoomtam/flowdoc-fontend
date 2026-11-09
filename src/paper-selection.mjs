// Map between the current input and the last snapshot visible on the paper.
// Positions in a change that has not been laid out yet share its visible edge.
export function paperOffsetMap(rendered,input){
  let prefix=0,suffix=0;
  const limit=Math.min(rendered.length,input.length);
  while(prefix<limit&&rendered[prefix]===input[prefix])prefix++;
  while(suffix<limit-prefix&&rendered[rendered.length-1-suffix]===input[input.length-1-suffix])suffix++;
  const renderedEnd=rendered.length-suffix,inputEnd=input.length-suffix;
  const map=(offset,fromEnd,toEnd)=>offset<=prefix?offset:offset>=fromEnd?toEnd+offset-fromEnd:prefix;
  return {
    toPaper:offset=>map(offset,inputEnd,renderedEnd),
    toInput:offset=>map(offset,renderedEnd,inputEnd),
  };
}

export function paperCaretStops(edit,lineWidth){
  if(edit.blank)return [[0,edit.start]];
  const offsets=new Set(),stops=[];
  for(const [x,start] of edit.clusters){
    if(offsets.has(start))continue;
    offsets.add(start);stops.push([x,start]);
  }
  if(!offsets.has(edit.end))stops.push([lineWidth,edit.end]);
  return stops;
}
