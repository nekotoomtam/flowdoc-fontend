import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {deflateSync} from 'node:zlib';

const requireCandidate=createRequire('/candidate/package.json');
const sharp=(...args)=>requireCandidate('sharp')(...args);
const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const sourceLimit=12_000_000;
const variantLimit=8_000_000;
const derivativeBudgetBytes=64*1024*1024;
const maxDerivatives=2000;
const maxImageNodes=10000;
const pt=length=>length.unit==='mm'?length.value*72/25.4:length.value;
const framePixels=length=>Math.max(1,Math.round(pt(length)*200/72));
const assetKey=signature=>{
  const hash=createHash('sha256').update(signature).digest('hex');
  return [hash.slice(0,8),hash.slice(8,12),'8'+hash.slice(13,16),'8'+hash.slice(17,20),hash.slice(20,32)].join('-');
};

async function sourceImages(uploads){
  if(!Array.isArray(uploads)||uploads.length>24)throw Error('invalid_images');
  const sources=new Map();
  let total=0;
  for(const {id,bytes:encoded} of uploads){
    if(typeof id!=='string'||!uuid.test(id)||sources.has(id)||typeof encoded!=='string'||encoded.length>1398104)
      throw Error('invalid_image');
    const bytes=Buffer.from(encoded,'base64');
    total+=bytes.length;
    if(!bytes.length||bytes.toString('base64')!==encoded||bytes.length>1048576||total>2097152)
      throw Error('invalid_image');
    const metadata=await sharp(bytes,{limitInputPixels:sourceLimit,failOn:'warning'}).metadata();
    if(!['png','jpeg'].includes(metadata.format)||!metadata.width||!metadata.height||(metadata.pages??1)>1)
      throw Error('invalid_image');
    const swap=metadata.orientation>=5&&metadata.orientation<=8;
    sources.set(id,{bytes,jpeg:metadata.format==='jpeg',
      width:swap?metadata.height:metadata.width,height:swap?metadata.width:metadata.height});
  }
  return sources;
}

export function planTrialImageVariants(nodes,sources){
  if(nodes.length>maxImageNodes)throw Error('invalid_image_budget');
  const variants=new Map();
  let projectedBytes=0;
  for(const node of nodes){
    const {resourceId,width,height}=node.props;
    if(!sources.has(resourceId))continue;
    // Match Service's /documents render-child derivative signature and rounding.
    const signature=JSON.stringify([resourceId,width,height,200,'srgb-orientation-v1']);
    let variant=variants.get(signature);
    if(!variant){
      const pixelWidth=framePixels(width),pixelHeight=framePixels(height);
      if(!Number.isFinite(pixelWidth*pixelHeight)||pixelWidth*pixelHeight>variantLimit)
        throw Error('invalid_image_frame');
      const source=sources.get(resourceId);
      const scale=Math.min(1,pixelWidth/source.width,pixelHeight/source.height);
      projectedBytes+=4*Math.max(1,Math.ceil(source.width*scale))*Math.max(1,Math.ceil(source.height*scale));
      if(variants.size>=maxDerivatives||projectedBytes>derivativeBudgetBytes)throw Error('invalid_image_budget');
      variant={id:assetKey(signature),source,width:pixelWidth,height:pixelHeight};
      variants.set(signature,variant);
    }
    node.props.resourceId=variant.id;
  }
  return variants.values();
}

// Each call owns its composed document. Remap only its temporary resources;
// the saved definition and raw worksheet image IDs retain their own identity.
export async function trialImages(uploads,document){
  const sources=await sourceImages(uploads);
  const variants=document?planTrialImageVariants((await import('/candidate/dist/images/nodes.js')).imageNodes(document),sources):
    [...sources].map(([id,source])=>({id,source,width:1800,height:1800}));
  const assets=new Map(),dimensions=Object.create(null);
  let derivativeBytes=0;
  for(const {id,source,width,height} of variants){
    const image=sharp(source.bytes,{limitInputPixels:sourceLimit,failOn:'warning'}).rotate()
      .toColourspace('srgb').resize({width,height,fit:'inside',withoutEnlargement:true});
    const {data,info}=await (source.jpeg?image.jpeg({quality:90}):image.png()).toBuffer({resolveWithObject:true});
    derivativeBytes+=source.jpeg?data.length:info.width*info.height*4;
    if(derivativeBytes>derivativeBudgetBytes)throw Error('invalid_image_budget');
    dimensions[id]={width:info.width,height:info.height};
    assets.set(id,{type:source.jpeg?'image/jpeg':'image/png',bytes:data});
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
