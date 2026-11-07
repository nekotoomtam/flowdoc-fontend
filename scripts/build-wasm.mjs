import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
execFileSync('wasm-pack.exe',['build','wasm-runtime','--target','web','--release','--out-dir','../artifacts/wasm-build','--no-pack','--no-opt'],{stdio:'inherit',windowsHide:true});
fs.mkdirSync('public/wasm',{recursive:true});fs.mkdirSync('src/vendor',{recursive:true});
fs.copyFileSync('artifacts/wasm-build/flowdoc_spike_text_bg.wasm','public/wasm/flowdoc_spike_text_bg.wasm');
for(const name of ['flowdoc_spike_text.js','flowdoc_spike_text.d.ts'])fs.copyFileSync('artifacts/wasm-build/'+name,'src/vendor/'+name);
