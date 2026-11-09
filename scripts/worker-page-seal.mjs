// Browser experiment against the current internal Core source. Keep the
// integration at the closed-page boundary and fail on an unfamiliar source.
export function withPageSeal(path,source){
  function replace(before,after){
    if(source.split(before).length!==2)throw Error('Unsupported Core page-seal source: '+path);
    source=source.replace(before,after);
  }
  if(path.endsWith('documentFlow.ts')){
    replace('onSectionEnd?:(extent:', 'onPageClosed?:(draw:DrawDocument)=>void;onSectionEnd?:(extent:');
    replace('        const g = geometry(sectionPageIndex);','        if(current)bounds?.onPageClosed?.({pages,pageTexts,pageFieldSlots,contentsSlots});\n        const g = geometry(sectionPageIndex);');
  }else{
    replace('flowMemo?:FlowMemo){','flowMemo?:FlowMemo,onPageClosed?:(draw:DrawDocument)=>void){');
    replace('maxImagePlacements:Infinity,signal:abort.signal}', 'maxImagePlacements:Infinity,signal:abort.signal,onPageClosed}');
    replace('images:PdfImageMetadata={}){','images:PdfImageMetadata={},onPageClosed?:(draw:DrawDocument)=>void){');
    replace('this.reuseFlow?this.flowMemo:undefined)};', 'this.reuseFlow?this.flowMemo:undefined,onPageClosed)};');
  }
  return source;
}
