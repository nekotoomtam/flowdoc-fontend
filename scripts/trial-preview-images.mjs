import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {deflateSync} from 'node:zlib';

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

export async function trialImageProvider({assets,dimensions},contract){
  const images=Object.create(null),blobs=new Map();
  function ref(key,bytes){
    blobs.set(key,bytes);
    return {key,byteLength:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
  }
  for(const [id,asset] of assets){
    const size=dimensions[id];
    if(asset.type==='image/jpeg'){
      images[id]={...size,kind:'jpeg',content:ref(id,asset.bytes)};
      continue;
    }
    const pixels=await sharp(asset.bytes).ensureAlpha().raw().toBuffer();
    const rgb=Buffer.allocUnsafe(pixels.length/4*3),alpha=Buffer.allocUnsafe(pixels.length/4);
    let transparent=false;
    for(let i=0;i<alpha.length;i++){
      rgb[i*3]=pixels[i*4];rgb[i*3+1]=pixels[i*4+1];rgb[i*3+2]=pixels[i*4+2];
      alpha[i]=pixels[i*4+3];transparent||=alpha[i]!==255;
    }
    images[id]={...size,kind:'rgb-deflate',content:ref(id,deflateSync(rgb)),
      ...(transparent?{alpha:ref(id+'-alpha',deflateSync(alpha))}:{})};
  }
  return {contract,images,async *open({key},signal){
    const bytes=blobs.get(key);
    if(!bytes)throw Error('Unknown trial image');
    for(let offset=0;offset<bytes.length;offset+=65536){
      signal?.throwIfAborted();
      yield bytes.subarray(offset,offset+65536);
    }
  }};
}
