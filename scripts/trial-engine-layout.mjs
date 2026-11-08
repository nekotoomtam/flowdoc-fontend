import {validateResolvedDocument} from '/candidate/node_modules/@flowdoc/core/dist/composition/validateResolvedDocument.js';
import {documentFlow} from '/candidate/node_modules/@flowdoc/core/dist/layout/documentFlow.js';
import {indexDestinations,resolveLinkGeometry} from '/candidate/node_modules/@flowdoc/core/dist/layout/linkGeometry.js';
import {fillContentsNumbers} from '/candidate/node_modules/@flowdoc/core/dist/layout/fillContentsNumbers.js';
import {fillPageFields} from '/candidate/node_modules/@flowdoc/core/dist/layout/fillPageFields.js';
import {cacheTextRuntime} from '/candidate/node_modules/@flowdoc/core/dist/runtime/cacheTextRuntime.js';
import {createTextRuntime} from '/candidate/node_modules/@flowdoc/core/dist/runtime/textRuntime.js';

// Use the packaged Engine's layout and finalization stages; this path never calls a writer.
export async function layoutPreview(document,resources,images){
  const issues=validateResolvedDocument(document);
  if(issues.length)return {ok:false,issues,warnings:[]};
  const signal=AbortSignal.timeout(105000);
  const session=createTextRuntime(resources,signal),runtime=cacheTextRuntime(session);
  try{
    const draw=await documentFlow(document,runtime,images,{maxPages:2000,maxImagePlacements:10000,signal});
    const anchors=indexDestinations(document,draw);
    await fillContentsNumbers(draw,anchors,runtime,true);
    await fillPageFields(draw,runtime);
    resolveLinkGeometry(document,draw,anchors);
    return {ok:true,value:draw,warnings:draw.warnings??[]};
  }catch(error){
    return {ok:false,issues:[{code:error.code??'LAYOUT_FAILED',path:error.path??'document',
      message:error instanceof Error?error.message:'Preview layout failed'}],warnings:[]};
  }finally{
    runtime.dispose();
    await session.close();
  }
}
