import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {deflateSync} from 'node:zlib';

const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const UUID=sha=>[sha.slice(0,8),sha.slice(8,12),sha.slice(12,16),sha.slice(16,20),sha.slice(20,32)].join('-');

export async function loadOriginalUat(contract) {
  const sharp=createRequire('/candidate/package.json')('sharp');
  sharp.cache(false);
  const bundle=JSON.parse(await readFile('/reference/uat-full.json','utf8'));
  assert.equal(bundle.template.docKey,'stage6-uat-full');
  assert.equal(bundle.template.nodeModelVersion,20);
  const request=structuredClone(bundle.request);
  const assets=new Map(), blobs=new Map(), images=Object.create(null);
  function ref(key,bytes){
    blobs.set(key,bytes);
    return {key,byteLength:bytes.length,sha256:digest(bytes)};
  }
  for(const part of bundle.imageParts){
    assert.match(part.sha256,/^[a-f0-9]{64}$/);
    const pointer=part.pointer.split('/').slice(1).map(key=>key.replaceAll('~1','/').replaceAll('~0','~'));
    assert.equal(pointer.pop(),'image');
    const field=pointer.pop();
    assert.ok(field);
    let parent=request;
    for(const segment of pointer){assert.ok(Object.hasOwn(parent,segment));parent=parent[segment];}
    assert.equal(parent[field].image.upload,true);
    const id=UUID(part.sha256);
    parent[field]=id;
    if(assets.has(id))continue;
    const bytes=await readFile(join('/reference-assets',part.sha256));
    assert.equal(digest(bytes),part.sha256);
    const operation=sharp(bytes,{limitInputPixels:40_000_000,failOn:'warning'})
      .autoOrient().toColourspace('srgb').resize({width:2600,height:2600,fit:'inside',withoutEnlargement:true});
    if(part.type==='image/jpeg'){
      const {data,info}=await operation.jpeg({quality:90}).toBuffer({resolveWithObject:true});
      images[id]={kind:'jpeg',width:info.width,height:info.height,content:ref(id,data)};
      assets.set(id,{type:'image/jpeg',bytes:data});
    }else{
      assert.equal(part.type,'image/png');
      const {data,info}=await operation.ensureAlpha().raw().toBuffer({resolveWithObject:true});
      assert.equal(info.channels,4);
      const pixels=info.width*info.height, rgb=Buffer.allocUnsafe(pixels*3), alpha=Buffer.allocUnsafe(pixels);
      let transparent=false;
      for(let i=0;i<pixels;i++){
        rgb[i*3]=data[i*4];rgb[i*3+1]=data[i*4+1];rgb[i*3+2]=data[i*4+2];
        alpha[i]=data[i*4+3];transparent ||= alpha[i]!==255;
      }
      images[id]={kind:'rgb-deflate',width:info.width,height:info.height,content:ref(id,deflateSync(rgb)),
        ...(transparent?{alpha:ref(id+'-alpha',deflateSync(alpha))}:{})};
      assets.set(id,{type:'image/png',bytes:await sharp(data,{raw:info}).png().toBuffer()});
    }
  }
  return {request,assets,placements:bundle.imageParts.length,entryCount:request.sections.reduce((n,s)=>n+s.data.parts.length,0),
    provider:{contract,images,async *open(ref,signal){
      const bytes=blobs.get(ref.key);
      if(!bytes)throw Error('Unknown preview asset');
      for(let offset=0;offset<bytes.length;offset+=65536){
        signal?.throwIfAborted();
        yield bytes.subarray(offset,offset+65536);
      }
    }}};
}
