// Read-only instrumentation of the release-equivalent Core 0.5.5 package.
import fs from 'node:fs';
const root='/candidate/vendor/installed-core/package/dist/';
const core=await import(root+'index.js');
const {createEngine}=await import(root+'pdf/createPdfEngine.js');
const {createTextRuntime}=await import(root+'runtime/textRuntime.js');
const {subsetFonts}=await import(root+'runtime/subsetFonts.js');
const {writePdf}=await import(root+'pdf/writePdf.js');
const unwrap=(r)=>{if(!r.ok)throw Error(JSON.stringify(r));return r.value};
const read=p=>JSON.parse(fs.readFileSync('/spike/'+p,'utf8'));
const fixture=read('fixtures/font-fixture.json');
const base=unwrap(await core.loadBundledResources({pythonExecutable:'python',tempRoot:'/tmp'}));
const uuid=i=>`00000000-0000-4000-8000-${String(i).padStart(12,'0')}`;
const resources=unwrap(await core.loadLibraryFonts(base,fixture.faces.map((f,i)=>({releaseId:fixture.releaseId,faceId:uuid(i+1),assetId:uuid(i+10),weight:f.weight,style:'normal',path:`/spike/public/font-${f.weight}.ttf`,sha256:f.sha256,licenses:[{id:uuid(20),path:'/spike/public/OFL.txt',sha256:fixture.licenseHash}]}))));
const template=unwrap(core.validateTemplate(read('public/spike-template.json')));
for(const name of ['baseline','edited']){
 const request=read(name==='baseline'?'public/spike-request.json':'artifacts/edited-request.json');
 const resolved=unwrap(core.composeDocument(template,unwrap(core.prepareGeneration(template,request))));
 fs.writeFileSync(`/out/${name}-resolved.json`,JSON.stringify(resolved));
 const engine=createEngine(resources,{runtime:createTextRuntime,subset:subsetFonts,write(draw,fonts,images){fs.writeFileSync(`/out/${name}-draw.json`,JSON.stringify(draw));return writePdf(draw,fonts,images)}});
 const result=unwrap(await engine.generatePdf(resolved));
 fs.writeFileSync(`/out/${name}.pdf`,result.bytes);
 console.log(JSON.stringify({name,pageCount:result.pageCount}));
}
