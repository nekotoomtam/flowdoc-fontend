import encodedArtwork from './preview-watermark.png';
import {stampPreviewDocx,stampPreviewPdf} from './preview-watermark.mjs';

const artwork=Buffer.from(encodedArtwork,'base64');

export function stampPreviewExport(format,source,target,options){
  const stamp=format==='docx'?stampPreviewDocx:stampPreviewPdf;
  return stamp(source,target,artwork,options);
}
