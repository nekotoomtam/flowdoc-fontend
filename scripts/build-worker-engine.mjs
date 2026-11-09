import {build} from 'esbuild';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve,relative} from 'node:path';
import {withPageSeal} from './worker-page-seal.mjs';

const root=resolve(process.argv[2]??'../flowdoc-core');
const output=resolve('public/worker-engine');
const src=root.replaceAll('\\','/')+'/src/';
const read=name=>readFileSync(src+name,'utf8');
const shapeSource=read('runtime/textRuntime.ts');
const decode=shapeSource.slice(shapeSource.indexOf('export function byteOffsets'),shapeSource.indexOf('export function createTextRuntime'));
if(!decode.includes('decodeShapeSteps'))throw Error('Core does not contain the cooperative shape decoder');
const entry=`
export {prepareGeneration} from '${src}data/prepareGeneration.ts';
export {composeDocument} from '${src}composition/composeDocument.ts';
export {LatestLayoutJobs} from '${src}interactive/layoutJob.ts';
export {scriptSpans} from '${src}runtime/scriptSpans.ts';
export {selectFont} from '${src}fonts/selection.ts';
const Buffer={byteLength(value:string){return new TextEncoder().encode(value).length}};
${decode}
`;
mkdirSync(output,{recursive:true});
const result=await build({stdin:{contents:entry,resolveDir:root,loader:'ts'},bundle:true,platform:'browser',format:'esm',
  metafile:true,outfile:output+'/core.mjs',plugins:[{name:'no-docx-prefix-compiler',setup(plugin){
    plugin.onLoad({filter:/[\\/](documentFlow|layoutJob)\.ts$/},({path})=>({
      contents:withPageSeal(path,readFileSync(path,'utf8').replaceAll('\r\n','\n')),loader:'ts'
    }));
    plugin.onResolve({filter:/prefixFit\.js$/},()=>({path:'prefixFit',namespace:'browser'}));
    plugin.onLoad({filter:/.*/,namespace:'browser'},()=>({contents:
      'export async function tryPrefixFit(){return false} export function withPrefixBudget(owner,wrapper){return wrapper}'}));
  }}]});
execFileSync('wasm-pack',['build',resolve(root,'native'),'--target','web','--release','--out-dir',output,'--no-pack','--no-opt'],{stdio:'inherit'});
const outlines=execFileSync('python',['-c',`
import json, subprocess, sys
from fontTools.ttLib import TTFont
args=[]
for weight in (300,400):
    path=f"public/font-{weight}.ttf"
    with TTFont(path) as font: args.append([str(weight),path,list(range(len(font.getGlyphOrder())))])
result=subprocess.run([sys.executable,"scripts/preview-glyph-paths.py"],input=json.dumps(args),text=True,capture_output=True,check=True)
print(result.stdout)
`],{maxBuffer:8*1024*1024});
writeFileSync(output+'/outlines.json',outlines);
const hash=file=>createHash('sha256').update(readFileSync(file)).digest('hex');
const files=Object.keys(result.metafile.inputs).filter(path=>!path.startsWith('browser:')&&path!=='<stdin>')
  .map(path=>resolve(path)).concat(src+'runtime/textRuntime.ts');
writeFileSync(output+'/provenance.json',JSON.stringify({
  coreCommit:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),
  browserPageSeal:hash('scripts/worker-page-seal.mjs'),
  sourceHashes:Object.fromEntries(files.map(path=>[relative(root,path).replaceAll('\\','/'),hash(path)])),
  artifacts:Object.fromEntries(['core.mjs','flowdoc_text_engine.js','flowdoc_text_engine_bg.wasm','outlines.json'].map(name=>[name,hash(output+'/'+name)]))
},null,2)+'\n');
