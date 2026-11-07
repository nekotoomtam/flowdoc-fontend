// Bundle pinned, unmodified Core layout code for this bounded frontend experiment.
// The PDF-only prefix optimization is disabled; it is not configured by generatePdf.
import {build} from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const root=path.resolve('../flowdoc-core');
const commit=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
if(commit!=='77b69bc974605284be8f67e741fb95609030aaba')throw Error('Core source differs from pinned release');
if(execFileSync('git',['status','--porcelain','--','src'],{cwd:root,encoding:'utf8'}).trim())throw Error('Core source has local changes');
const src=root.replaceAll('\\','/')+'/src/';
const native=fs.readFileSync(path.join(root,'src/runtime/textRuntime.ts'),'utf8');
const decode=native.slice(native.indexOf('export function byteOffsets'),native.indexOf('export function createTextRuntime')).replaceAll('Buffer.byteLength(text)','new TextEncoder().encode(text).length').replaceAll('Buffer.byteLength(ch)','new TextEncoder().encode(ch).length');
const entry=`export {documentFlow} from '${src}layout/documentFlow.ts';
export {scriptSpans} from '${src}runtime/scriptSpans.ts';
export {cacheTextRuntime} from '${src}runtime/cacheTextRuntime.ts';\n${decode}`;
fs.mkdirSync('src/vendor',{recursive:true});
const result=await build({stdin:{contents:entry,resolveDir:root,loader:'ts'},bundle:true,format:'esm',platform:'browser',outfile:'src/vendor/core-layout.mjs',metafile:true,
 plugins:[{name:'unconfigured-prefix-fit',setup(b){b.onResolve({filter:/prefixFit\.js$/},()=>({path:'prefixFit',namespace:'spike'}));b.onLoad({filter:/.*/,namespace:'spike'},()=>({contents:'export async function tryPrefixFit(){return false}'}));}}]});
const files=Object.keys(result.metafile.inputs).filter(p=>!p.startsWith('spike:')&&p!=='<stdin>').map(p=>({path:path.relative(root,path.resolve(p)).replaceAll('\\','/'),sha256:createHash('sha256').update(fs.readFileSync(p)).digest('hex')}));
files.push({path:'src/runtime/textRuntime.ts',sha256:createHash('sha256').update(native).digest('hex')});
fs.writeFileSync('src/vendor/provenance.json',JSON.stringify({commit,files,adapter:'Unconfigured prefixFit returns false, matching native PDF. Only fixed UAT resolved data is supported by this spike.'},null,2));
fs.mkdirSync('artifacts',{recursive:true});
await build({stdin:{contents:`export {validateTemplate} from '${src}template/validateTemplate.ts';export {prepareGeneration} from '${src}data/prepareGeneration.ts';export {composeDocument} from '${src}composition/composeDocument.ts';`,resolveDir:root,loader:'ts'},bundle:true,format:'esm',platform:'node',outfile:'artifacts/core-compose.mjs'});
const core=await import(pathToFileURL(path.resolve('artifacts/core-compose.mjs')).href);
const unwrap=r=>{if(!r.ok)throw Error(JSON.stringify(r));return r.value};
const template=unwrap(core.validateTemplate(JSON.parse(fs.readFileSync('public/spike-template.json','utf8'))));
const request=JSON.parse(fs.readFileSync('public/spike-request.json','utf8'));
const resolved=unwrap(core.composeDocument(template,unwrap(core.prepareGeneration(template,request))));
fs.writeFileSync('public/spike-resolved.json',JSON.stringify(resolved));
fs.copyFileSync('fixtures/font-fixture.json','public/spike-fonts.json');
