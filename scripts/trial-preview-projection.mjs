export function projectTrialPage(cache,index){
  const {commands,images,...page}=cache.draw.pages[index];
  const glyphs=Object.create(null);
  const lines=commands.map(command=>{
    const {text,bounds,fontId,fontSizePt,baselineOffsetPt,color,glyphs:run}=command;
    const [units,paths]=cache.paths[fontId];
    const font=cache.fonts.indexOf(fontId), scale=fontSizePt/units;
    let advance=0;
    const glyphUses=[];
    for(const g of run){
      const d=paths[g.glyphId], key='g'+font+'-'+g.glyphId;
      if(d){glyphs[key]=d;glyphUses.push([key,bounds.xPt+advance+g.offsetXPt,bounds.yPt+baselineOffsetPt-g.offsetYPt]);}
      advance+=g.advancePt;
    }
    const owner=cache.bindings?.lines.get(command);
    let edit;
    if(owner){
      let x=0;
      const clusters=run.map(g=>{
        const cluster=[x,owner.blank?0:owner.start+g.clusterStartOffset,owner.blank?0:owner.start+g.clusterEndOffset];
        x+=g.advancePt;return cluster;
      });
      edit={...owner,clusters,...cache.bindings.tab.get(owner.occurrence)};
    }
    return {text,...bounds,fontSizePt,baselineOffsetPt,color,scale,glyphUses,...(edit?{edit}:{})};
  });
  return {...page,sampleImages:images??[],glyphs,lines};
}

export function trialFocusPage(trial,draw,bindings){
  const focus=trial?.focus;
  const candidates=typeof focus?.key==='string'?bindings?.locations.get(focus.key):undefined;
  const matching=candidates?.filter(position=>position.occurrence===focus.occurrence);
  const positions=matching?.length?matching:candidates;
  const requestedPage=focus?.pageIndex??trial?.pageIndex;
  const preferred=Number.isSafeInteger(requestedPage)?Math.min(Math.max(0,requestedPage),draw.pages.length-1):0;
  const caret=Number.isSafeInteger(focus?.offset)?focus.offset:0;
  const position=positions?.find(p=>p.pageIndex===preferred&&p.start<=caret&&caret<=p.end)
    ??positions?.find(p=>p.start<=caret&&caret<=p.end)
    ??positions?.find(p=>p.pageIndex===preferred);
  return position?.pageIndex??preferred;
}
