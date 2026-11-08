import {createRequire} from 'node:module';

const sharp=createRequire('/candidate/package.json')('sharp');
const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;

export async function trialImages(uploads){
  if(!Array.isArray(uploads)||uploads.length>24)throw Error('invalid_images');
  const assets=new Map(),dimensions=Object.create(null);
  let total=0;
  for(const {id,bytes:encoded} of uploads){
    if(typeof id!=='string'||!uuid.test(id)||assets.has(id)||typeof encoded!=='string'||encoded.length>1398104)
      throw Error('invalid_image');
    const bytes=Buffer.from(encoded,'base64');
    total+=bytes.length;
    if(!bytes.length||bytes.toString('base64')!==encoded||bytes.length>1048576||total>2097152)throw Error('invalid_image');
    const operation=sharp(bytes,{limitInputPixels:12_000_000,failOn:'warning'});
    const metadata=await operation.metadata();
    if(!['png','jpeg'].includes(metadata.format))throw Error('invalid_image');
    const image=operation.autoOrient().toColourspace('srgb').resize({width:1800,height:1800,fit:'inside',withoutEnlargement:true});
    const jpeg=metadata.format==='jpeg';
    const {data,info}=await (jpeg?image.jpeg({quality:90}):image.png()).toBuffer({resolveWithObject:true});
    dimensions[id]={width:info.width,height:info.height};
    assets.set(id,{type:jpeg?'image/jpeg':'image/png',bytes:data});
  }
  return {assets,dimensions};
}
