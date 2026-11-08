import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {deflateSync} from 'node:zlib';

const sharp=createRequire('/candidate/package.json')('sharp');
const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');

export async function trialImages(uploads,contract){
  if(!Array.isArray(uploads)||uploads.length>24)throw Error('invalid_images');
  const assets=new Map(),blobs=new Map(),images=Object.create(null);
  let total=0;
  function ref(key,bytes){
    blobs.set(key,bytes);
    return {key,byteLength:bytes.length,sha256:digest(bytes)};
  }
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
    if(metadata.format==='jpeg'){
      const {data,info}=await image.jpeg({quality:90}).toBuffer({resolveWithObject:true});
      images[id]={kind:'jpeg',width:info.width,height:info.height,content:ref(id,data)};
      assets.set(id,{type:'image/jpeg',bytes:data});
    }else{
      const {data,info}=await image.ensureAlpha().raw().toBuffer({resolveWithObject:true});
      const rgb=Buffer.alloc(info.width*info.height*3),alpha=Buffer.alloc(info.width*info.height);
      let transparent=false;
      for(let i=0;i<alpha.length;i++){
        rgb[i*3]=data[i*4];rgb[i*3+1]=data[i*4+1];rgb[i*3+2]=data[i*4+2];
        alpha[i]=data[i*4+3];transparent ||= alpha[i]!==255;
      }
      images[id]={kind:'rgb-deflate',width:info.width,height:info.height,content:ref(id,deflateSync(rgb)),
        ...(transparent?{alpha:ref(id+'-alpha',deflateSync(alpha))}:{})};
      assets.set(id,{type:'image/png',bytes:await sharp(data,{raw:info}).png().toBuffer()});
    }
  }
  return {assets,provider:{contract,images,async *open(ref,signal){
    const bytes=blobs.get(ref.key);
    if(!bytes)throw Error('Unknown preview asset');
    for(let offset=0;offset<bytes.length;offset+=65536){
      signal?.throwIfAborted();yield bytes.subarray(offset,offset+65536);
    }
  }}};
}
