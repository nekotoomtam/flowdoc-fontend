// Local experiment transport only. No public API and no Service mutation.
import fs from 'node:fs';
import readline from 'node:readline';
import {createHash} from 'node:crypto';
import {projectLayout} from '../src/engine-layout.mjs';
const root='/candidate/vendor/installed-core/package/dist/';
const core=await import(root+'index.js');
const {createEngine}=await import(root+'pdf/createPdfEngine.js');
const {createTextRuntime}=await import(root+'runtime/textRuntime.js');
const {subsetFonts}=await import(root+'runtime/subsetFonts.js');
const {writePdf}=await import(root+'pdf/writePdf.js');
const unwrap=r=>{if(!r.ok)throw Error(JSON.stringify(r));return r.value};
const read=p=>JSON.parse(fs.readFileSync('/spike/'+p,'utf8'));
const fixture=read('fixtures/font-fixture.json');
const base=unwrap(await core.loadBundledResources({pythonExecutable:'python',tempRoot:'/tmp'}));
const uuid=i=>`00000000-0000-4000-8000-${String(i).padStart(12,'0')}`;
const resources=unwrap(await core.loadLibraryFonts(base,fixture.faces.map((f,i)=>({releaseId:fixture.releaseId,faceId:uuid(i+1),assetId:uuid(i+10),weight:f.weight,style:'normal',path:`/spike/public/font-${f.weight}.ttf`,sha256:f.sha256,licenses:[{id:uuid(20),path:'/spike/public/OFL.txt',sha256:fixture.licenseHash}]}))));
const template=unwrap(core.validateTemplate(read('public/spike-template.json')));
for await (const raw of readline.createInterface({input:process.stdin})) {
  let packet;
  try {
    packet=JSON.parse(raw);
    const started=performance.now();
    const resolved=unwrap(core.composeDocument(template,unwrap(core.prepareGeneration(template,packet.request))));
    let captured;
    const engine=createEngine(resources,{runtime:createTextRuntime,subset:subsetFonts,write(draw,fonts,images){captured=draw;return writePdf(draw,fonts,images)}});
    const pdf=unwrap(await engine.generatePdf(resolved));
    const layout=projectLayout(captured,resolved.sourceMap,packet.request);
    console.log(JSON.stringify({id:packet.id,layout,pageCount:pdf.pageCount,engineMs:performance.now()-started,
      requestHash:createHash('sha256').update(JSON.stringify(packet.request)).digest('hex')}));
  } catch(error) { console.log(JSON.stringify({id:packet?.id,error:String(error)})); }
}
