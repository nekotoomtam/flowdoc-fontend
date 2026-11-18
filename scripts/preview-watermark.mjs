import {readFile,stat,writeFile} from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import {posix} from 'node:path';
import {Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {DOMParser,XMLSerializer} from '@xmldom/xmldom';
import JSZip from 'jszip';
import {decodePDFRawStream,degrees,PDFDocument,PDFRawStream} from 'pdf-lib';

const angle=32;
const scale=.78;
const word='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const rel='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const pkg='http://schemas.openxmlformats.org/package/2006/relationships';
const types='http://schemas.openxmlformats.org/package/2006/content-types';
const drawing='http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const graphic='http://schemas.openxmlformats.org/drawingml/2006/main';
const picture='http://schemas.openxmlformats.org/drawingml/2006/picture';
const artworkPath='word/media/flowdoc-preview-watermark.png';
const headerTypes=['default','first','even'];
const serializer=new XMLSerializer();
const parse=xml=>new DOMParser({onError:(_level,message)=>{throw Error(message);}}).parseFromString(xml,'application/xml');
const nodes=(root,ns,name)=>Array.from(root.getElementsByTagNameNS(ns,name));

async function readBounded(path,maxBytes,signal){
  if((await stat(path)).size>maxBytes)throw Error('Preview export exceeds output limit');
  return readFile(path,{signal});
}

function paintPdfBackground(page,image,{x,y,width,height}){
  const name=page.node.newXObject('SectionBackground',image.ref);
  const contents=page.node.normalizedEntries().Contents;
  for(let index=0;index<contents.size();index++){
    const stream=page.doc.context.lookup(contents.get(index));
    if(!(stream instanceof PDFRawStream))continue;
    const bytes=Buffer.from(decodePDFRawStream(stream).decode());
    const paint=/^q\n[^\n]+ rg\n[^\n]+ re f\nQ\n/.exec(bytes.subarray(0,256).toString('latin1'));
    if(!paint)continue;
    const at=paint[0].length;
    const layer=Buffer.from(`q\n${width} 0 0 ${height} ${x} ${y} cm\n${name} Do\nQ\n`,'ascii');
    contents.set(index,page.doc.context.register(page.doc.context.flateStream(Buffer.concat([bytes.subarray(0,at),layer,bytes.subarray(at)]))));
    return;
  }
  throw Error('Missing Engine PDF paper paint');
}

export async function stampPreviewPdf(source,target,artwork,{maxBytes,signal,pageBackgrounds}){
  const pdf=await PDFDocument.load(await readBounded(source,maxBytes,signal),{updateMetadata:false});
  const image=await pdf.embedPng(artwork);
  const pages=pdf.getPages(), embedded=new Map();
  if(Array.isArray(pageBackgrounds)&&pageBackgrounds.length!==pages.length)throw Error('PDF background page count mismatch');
  const radians=angle*Math.PI/180;
  for(const [index,page] of pages.entries()){
    signal?.throwIfAborted();
    const {x,y,width,height}=page.getMediaBox();
    const background=Array.isArray(pageBackgrounds)?pageBackgrounds[index]:pageBackgrounds;
    if(background){
      if(!embedded.has(background.sha256)){
        const embed=background.format==='jpeg'?pdf.embedJpg.bind(pdf):pdf.embedPng.bind(pdf);
        embedded.set(background.sha256,await embed(background.bytes));
      }
      paintPdfBackground(page,embedded.get(background.sha256),{x,y,width,height});
    }
    const markWidth=Math.min(width,height)*scale;
    const markHeight=markWidth*image.height/image.width;
    page.drawImage(image,{
      x:x+width/2-(markWidth*Math.cos(radians)-markHeight*Math.sin(radians))/2,
      y:y+height/2-(markWidth*Math.sin(radians)+markHeight*Math.cos(radians))/2,
      width:markWidth,height:markHeight,rotate:degrees(angle)
    });
  }
  const bytes=await pdf.save({updateFieldAppearances:false});
  if(bytes.length>maxBytes)throw Error('Preview export exceeds output limit');
  await writeFile(target,bytes,{flag:'wx',mode:0o600,signal});
}

async function xml(zip,path,fallback){
  const part=zip.file(path);
  if(!part&&!fallback)throw Error('Missing Word package part');
  return parse(part?await part.async('string'):fallback);
}

function addRelationship(doc,type,target){
  const occupied=new Set(nodes(doc,pkg,'Relationship').map(node=>node.getAttribute('Id')));
  let index=1;
  while(occupied.has('rId'+index))index++;
  const id='rId'+index,node=doc.createElementNS(pkg,'Relationship');
  node.setAttribute('Id',id);
  node.setAttribute('Type',rel+'/'+type);
  node.setAttribute('Target',target);
  doc.documentElement.appendChild(node);
  return id;
}

function registerType(doc,element,attributes){
  const node=doc.createElementNS(types,element);
  for(const [name,value] of Object.entries(attributes))node.setAttribute(name,value);
  doc.documentElement.appendChild(node);
}

function addHeaderReference(section,type,id){
  const ref=section.ownerDocument.createElementNS(word,'w:headerReference');
  ref.setAttributeNS(word,'w:type',type);
  ref.setAttributeNS(rel,'r:id',id);
  section.insertBefore(ref,section.firstChild);
}

function sectionDimensions(section){
  const size=Array.from(section.childNodes).find(node=>node.namespaceURI===word&&node.localName==='pgSz');
  const width=Number(size?.getAttributeNS(word,'w'))||12240;
  const height=Number(size?.getAttributeNS(word,'h'))||15840;
  return [width*635,height*635];
}

function anchoredMark(id,imageId,width,height,background=false){
  const rotation=background?0:(360-angle)*60000;
  const position=background?'<wp:posOffset>0</wp:posOffset>':'<wp:align>center</wp:align>';
  const name=background?'FlowDoc Section background':'FlowDoc Preview';
  return parse(`<w:r xmlns:w="${word}" xmlns:r="${rel}" xmlns:wp="${drawing}" xmlns:a="${graphic}" xmlns:pic="${picture}">
    <w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="0" behindDoc="${background?1:0}" locked="0" layoutInCell="0" allowOverlap="1">
      <wp:simplePos x="0" y="0"/>
      <wp:positionH relativeFrom="page">${position}</wp:positionH>
      <wp:positionV relativeFrom="page">${position}</wp:positionV>
      <wp:extent cx="${width}" cy="${height}"/>
      <wp:wrapNone/>
      <wp:docPr id="${id}" name="${name}" descr="${background?'Section background':'ฉบับทดลอง · PREVIEW'}"/>
      <a:graphic><a:graphicData uri="${picture}"><pic:pic>
        <pic:nvPicPr><pic:cNvPr id="0" name="${name}"/><pic:cNvPicPr/></pic:nvPicPr>
        <pic:blipFill><a:blip r:embed="${imageId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>
        <pic:spPr><a:xfrm rot="${rotation}"><a:off x="0" y="0"/><a:ext cx="${width}" cy="${height}"/></a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>
      </pic:pic></a:graphicData></a:graphic>
    </wp:anchor></w:drawing></w:r>`).documentElement;
}

async function applyWordBackgrounds(zip,sections,effectiveHeaders,rels,contentTypes,options){
  const {wordBackgrounds:images,signal,emptyRels,emptyHeader,nextDrawingId}=options;
  const uniform=images.every(image=>image===images[0]);
  if(!uniform&&images.length!==sections.length)throw Error('Word background section count mismatch');
  const media=new Map(), variants=new Map();
  for(const [index,section] of sections.entries()){
    const image=uniform?images[0]:images[index];
    const dimensions=sectionDimensions(section);
    for(const [type,original] of effectiveHeaders[index]){
      signal?.throwIfAborted();
      let id=original.id;
      if(image){
        if(!media.has(image.sha256)){
          const name='word/media/flowdoc-section-background-'+image.sha256+'.'+image.format;
          zip.file(name,image.bytes);
          registerType(contentTypes,'Override',{PartName:'/'+name,ContentType:'image/'+image.format});
          media.set(image.sha256,name);
        }
        const key=JSON.stringify([original.path,image.sha256,dimensions]);
        if(!variants.has(key)){
          const dir=posix.dirname(original.path);
          let suffix=variants.size+1,path;
          do{path=posix.join(dir,'flowdoc-section-background-header-'+suffix++ +'.xml');}while(zip.file(path));
          const relationships=part=>posix.join(dir,'_rels',posix.basename(part)+'.rels');
          const [header,headerRels]=await Promise.all([xml(zip,original.path),xml(zip,relationships(original.path),emptyRels)]);
          const imageId=addRelationship(headerRels,'image',posix.relative(dir,media.get(image.sha256)));
          let paragraph=Array.from(header.documentElement.childNodes).findLast(node=>node.namespaceURI===word&&node.localName==='p');
          if(!paragraph){
            paragraph=header.importNode(nodes(parse(emptyHeader),word,'p')[0],true);
            header.documentElement.appendChild(paragraph);
          }
          for(const drawingProperty of nodes(header,drawing,'docPr'))drawingProperty.setAttribute('id',String(nextDrawingId()));
          paragraph.appendChild(header.importNode(anchoredMark(nextDrawingId(),imageId,...dimensions,true),true));
          zip.file(path,serializer.serializeToString(header));
          zip.file(relationships(path),serializer.serializeToString(headerRels));
          registerType(contentTypes,'Override',{PartName:'/'+path,ContentType:'application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml'});
          variants.set(key,addRelationship(rels,'header',posix.relative('word',path)));
        }
        id=variants.get(key);
      }
      const ref=nodes(section,word,'headerReference').find(node=>node.getAttributeNS(word,'type')===type);
      if(ref)ref.setAttributeNS(rel,'r:id',id);
      else addHeaderReference(section,type,id);
    }
  }
}

export async function stampPreviewDocx(source,target,artwork,{maxBytes,signal,wordBackgrounds}){
  const zip=await JSZip.loadAsync(await readBounded(source,maxBytes,signal));
  const documentPath='word/document.xml', documentRelsPath='word/_rels/document.xml.rels';
  const contentTypesPath='[Content_Types].xml';
  const emptyRels=`<Relationships xmlns="${pkg}"/>`;
  const [doc,rels,contentTypes]=await Promise.all([
    xml(zip,documentPath),xml(zip,documentRelsPath,emptyRels),xml(zip,contentTypesPath)
  ]);
  const sections=nodes(doc,word,'sectPr').filter(section=>['body','pPr'].includes(section.parentNode.localName));
  if(!sections.length)throw Error('Preview Word has no sections');
  const first=sections[0];
  const firstTypes=new Set(nodes(first,word,'headerReference').map(node=>node.getAttributeNS(word,'type')));
  const missing=headerTypes.filter(type=>!firstTypes.has(type));
  const emptyHeader=`<w:hdr xmlns:w="${word}"><w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="1" w:lineRule="exact"/></w:pPr></w:p></w:hdr>`;
  if(missing.length){
    let number=1;
    while(zip.file('word/flowdoc-preview-header-'+number+'.xml'))number++;
    const name='flowdoc-preview-header-'+number+'.xml';
    const id=addRelationship(rels,'header',name);
    zip.file('word/'+name,emptyHeader);
    registerType(contentTypes,'Override',{
      PartName:'/word/'+name,ContentType:'application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml'
    });
    for(const type of missing)addHeaderReference(first,type,id);
    zip.file(documentPath,serializer.serializeToString(doc));
    zip.file(documentRelsPath,serializer.serializeToString(rels));
  }
  const headers=new Map(nodes(rels,pkg,'Relationship').filter(node=>node.getAttribute('Type')===rel+'/header')
    .map(node=>[node.getAttribute('Id'),node.getAttribute('Target')]));
  const inherited=new Map(), sizes=new Map(), effectiveHeaders=[];
  for(const section of sections){
    for(const node of nodes(section,word,'headerReference')){
      const id=node.getAttributeNS(rel,'id');
      const targetName=headers.get(id);
      if(!targetName)throw Error('Missing Word header relationship');
      const path=targetName.startsWith('/')?targetName.slice(1):posix.join('word',targetName);
      if(!path.startsWith('word/'))throw Error('Invalid Word header path');
      inherited.set(node.getAttributeNS(word,'type'),{id,path});
    }
    effectiveHeaders.push(new Map(inherited));
    for(const {path} of inherited.values())sizes.set(path,Math.min(sizes.get(path)??Infinity,...sectionDimensions(section)));
  }
  if(zip.file(artworkPath))throw Error('Preview watermark asset already exists');
  zip.file(artworkPath,artwork);
  registerType(contentTypes,'Override',{PartName:'/'+artworkPath,ContentType:'image/png'});
  zip.file(contentTypesPath,serializer.serializeToString(contentTypes));
  const png=Buffer.from(artwork.buffer,artwork.byteOffset,artwork.byteLength);
  let drawingId=1_000_000_000;
  for(const [path,pageSize] of sizes){
    signal?.throwIfAborted();
    const relsPath=posix.join(posix.dirname(path),'_rels',posix.basename(path)+'.rels');
    const [header,headerRels]=await Promise.all([xml(zip,path),xml(zip,relsPath,emptyRels)]);
    const imageId=addRelationship(headerRels,'image',posix.relative(posix.dirname(path),artworkPath));
    const width=Math.round(pageSize*scale),height=Math.round(width*png.readUInt32BE(20)/png.readUInt32BE(16));
    // Word positions an anchor inside a header table relative to that table.
    let paragraph=Array.from(header.documentElement.childNodes)
      .find(node=>node.namespaceURI===word&&node.localName==='p');
    if(!paragraph){
      paragraph=header.importNode(nodes(parse(emptyHeader),word,'p')[0],true);
      header.documentElement.appendChild(paragraph);
    }
    paragraph.appendChild(header.importNode(anchoredMark(drawingId++,imageId,width,height),true));
    zip.file(path,serializer.serializeToString(header));
    zip.file(relsPath,serializer.serializeToString(headerRels));
  }
  if(wordBackgrounds?.some(Boolean)){
    await applyWordBackgrounds(zip,sections,effectiveHeaders,rels,contentTypes,{
      wordBackgrounds,signal,emptyRels,emptyHeader,nextDrawingId:()=>drawingId++
    });
    zip.file(documentPath,serializer.serializeToString(doc));
    zip.file(documentRelsPath,serializer.serializeToString(rels));
    zip.file(contentTypesPath,serializer.serializeToString(contentTypes));
  }
  let bytes=0;
  const limit=new Transform({transform(chunk,_encoding,done){
    bytes+=chunk.length;
    done(bytes>maxBytes?Error('Preview export exceeds output limit'):null,chunk);
  }});
  await pipeline(zip.generateNodeStream({streamFiles:true,compression:'DEFLATE'}),limit,
    createWriteStream(target,{flags:'wx',mode:0o600}),{signal});
}
