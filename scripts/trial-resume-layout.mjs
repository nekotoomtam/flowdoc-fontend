import {setImmediate as nextTask} from 'node:timers/promises';

const root='/resume-core/dist';
const runtime='/resume-runtime';
const segmenter='/resume-segmenter';
const expectedBuild='flow-table-resume-v3';

export async function createResumePreview(){
  const [{LatestLayoutJobs},{createTextRuntime},{withCooperativeTextRuntime},{NativeThaiKernel}]=await Promise.all([
    import(root+'/interactive/layoutJob.js'),import(root+'/runtime/textRuntime.js'),
    import(root+'/interactive/cooperativeTextRuntime.js'),import(root+'/interactive/nativeThaiKernel.js'),
  ]);
  let runner,scope,revision=0;
  async function close(){
    const previous=runner;
    runner=undefined;scope=undefined;revision=0;
    await previous?.close();
  }
  const counters=job=>{
    const flow=job.flowMemo.stats(),table=job.flowMemo.tablePagination.stats(),fragments=job.flowMemo.tableFragments.stats();
    return {reusedRootPages:flow.reusedPages,replayedTablePages:table.replayedPages,resumedTablePages:table.resumedPages,
      computedTableCuts:table.computedCuts,reusedFragments:fragments.hits};
  };
  return {close,async layout(document,resources,images,owner){
    const pinned={...resources,shaperPath:runtime+'/flowdoc-rustybuzz-smoke',segmenterPath:segmenter};
    const key=JSON.stringify([owner,pinned.fonts.map(font=>[font.id,font.sha256,font.path])]);
    if(scope!==key){
      await close();
      runner=new LatestLayoutJobs(signal=>withCooperativeTextRuntime(createTextRuntime(pinned,signal),
        new NativeThaiKernel(runtime+'/flowdoc-thai-line-probe-session',{signal})),{reuseRuntime:true,reuseFlow:true,lineCacheScope:key});
      scope=key;
    }
    const job=runner, before=counters(job), requested=++revision;
    let timedOut=false,retirement;
    const timer=setTimeout(()=>{timedOut=true;retirement=close();void retirement.catch(()=>{});},105000);
    try{
      job.submit(requested,document,images);
      let result,slices=0;
      do{
        result=await job.advance(8);
        if(result.status==='paused'){slices++;await nextTask();}
      }while(result.status==='paused'&&!timedOut);
      if(result.status==='failed')throw result.error;
      if(timedOut||result.status!=='complete'||result.revision!==requested)throw Error('Resume layout did not complete');
      if(result.draw.pages.length>2000)throw Error('Preview page limit exceeded');
      let imagePlacements=0;
      for(const page of result.draw.pages)imagePlacements+=page.images?.length??0;
      if(imagePlacements>10000)throw Error('Preview image limit exceeded');
      const after=counters(job);
      const reuse=Object.fromEntries(Object.keys(after).map(key=>[key,after[key]-before[key]]));
      return {ok:true,value:result.draw,warnings:result.draw.warnings??[],
        resume:{build:expectedBuild,revision:requested,slices,...reuse}};
    }catch(error){
      await (retirement??close()).catch(()=>{});
      return {ok:false,issues:error?.issues??[{code:error?.code??'LAYOUT_FAILED',path:error?.path??'document',
        message:error instanceof Error?error.message:'Resume preview layout failed'}],warnings:[]};
    }finally{clearTimeout(timer);}
  }};
}
