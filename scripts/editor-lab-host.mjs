import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {createReadStream} from 'node:fs';
import {stat} from 'node:fs/promises';
import {extname,join,resolve,sep} from 'node:path';
import {pipeline} from 'node:stream/promises';
import {fileURLToPath} from 'node:url';
import {phase1Bridge} from './phase1-bridge.mjs';

const site=fileURLToPath(new URL('../dist/',import.meta.url));
const watermarkRuntime=join(site,'preview-watermark-runtime.cjs');
const prefix='/api/editor-phase1';
const mediaTypes={
  '.css':'text/css; charset=utf-8','.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8',
  '.json':'application/json; charset=utf-8','.wasm':'application/wasm','.woff2':'font/woff2','.woff':'font/woff',
  '.ttf':'font/ttf','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.svg':'image/svg+xml','.ico':'image/x-icon',
};
let api;
const server=createServer((request,response)=>{
  void dispatch(request,response).catch(()=>{
    if(response.headersSent||response.destroyed)response.destroy();
    else response.writeHead(500).end();
  });
});

async function dispatch(request,response){
  if(!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(request.headers.host??''))
    return response.writeHead(403).end();
  const url=new URL(request.url,'http://localhost');
  if(url.pathname===prefix||url.pathname.startsWith(prefix+'/')){
    request.url=url.pathname.slice(prefix.length)+url.search;
    return api(request,response);
  }
  if(!['GET','HEAD'].includes(request.method))return response.writeHead(405,{Allow:'GET, HEAD'}).end();
  if(url.pathname==='/'||(url.pathname==='/library.html'&&url.searchParams.get('phase1')!=='1'))
    return response.writeHead(302,{Location:'/library.html?phase1=1','Cache-Control':'no-store'}).end();
  let pathname;
  try{pathname=decodeURIComponent(url.pathname);}
  catch{return response.writeHead(400).end();}
  const file=resolve(join(site,pathname));
  const type=mediaTypes[extname(file)];
  if(!file.startsWith(resolve(site)+sep)||!type)
    return response.writeHead(404).end();
  const info=await stat(file).catch(()=>undefined);
  if(!info?.isFile())return response.writeHead(404).end();
  response.writeHead(200,{'Content-Type':type,'Content-Length':info.size,'X-Content-Type-Options':'nosniff',
    'Cache-Control':pathname.startsWith('/assets/')?'public, max-age=31536000, immutable':'no-cache'});
  if(request.method==='HEAD')return response.end();
  await pipeline(createReadStream(file),response);
}

phase1Bridge({enabled:true,startWorker:()=>spawn(process.execPath,['/phase1/phase1-server.mjs'],{
  env:{...process.env,FLOWDOC_PREVIEW_WATERMARK_RUNTIME:watermarkRuntime}
})})
  .configureServer({httpServer:server,middlewares:{use(path,handler){
    if(path!==prefix)throw Error('Unexpected Editor API path');
    api=handler;
  }}});
const port=Number(process.env.PORT??5193);
if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Invalid Editor HTTP port');
server.listen(port,'127.0.0.1');
process.once('SIGTERM',()=>server.close());
