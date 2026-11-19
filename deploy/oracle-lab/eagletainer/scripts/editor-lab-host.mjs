import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {createReadStream} from 'node:fs';
import {readFile,stat} from 'node:fs/promises';
import {createLabSampleWord} from './lab-srs-sample-word.mjs';
import {extname,join,resolve,sep} from 'node:path';
import {pipeline} from 'node:stream/promises';
import {fileURLToPath} from 'node:url';
import {openSectionPublication} from './section-publication.mjs';
import {phase1Bridge} from './phase1-bridge.mjs';
import {openPreviewShares,sharedPreviewApi} from './preview-shares.mjs';

const site=fileURLToPath(new URL('../dist/',import.meta.url));
const prefix='/api/editor-phase1';
const shareOrigin=process.env.FLOWDOC_PREVIEW_SHARE_ORIGIN;
const sharesDirectory=process.env.FLOWDOC_PREVIEW_SHARE_DIR;
const shareUrl=shareOrigin?new URL(shareOrigin):undefined;
if(shareUrl&&(shareUrl.origin!==shareOrigin||shareUrl.protocol!=='https:'&&
  !['127.0.0.1','localhost'].includes(shareUrl.hostname)))throw Error('Invalid shared Preview origin');
const previewShares=sharesDirectory&&shareUrl?await openPreviewShares(sharesDirectory):undefined;
if(previewShares)setInterval(()=>previewShares.sweep().catch(()=>{}),15*60*1000).unref();

const mediaTypes={
  '.css':'text/css; charset=utf-8','.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8',
  '.json':'application/json; charset=utf-8','.wasm':'application/wasm','.woff2':'font/woff2','.woff':'font/woff',
  '.ttf':'font/ttf','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.svg':'image/svg+xml','.ico':'image/x-icon',
};
const sampleWord=createLabSampleWord({
  fixture:JSON.parse(await readFile(new URL('./srs-v2-sample-fixture.json',import.meta.url),'utf8')),
  image:await readFile(join(site,'flowdoc-sample.png')),
  serviceUrl:'http://127.0.0.1:5194',
  serviceToken:JSON.parse(await readFile(new URL('./srs-sample-upstream.json',import.meta.url),'utf8'))[0].token,
});
const fromZeroFixture=JSON.parse(await readFile(new URL('./srs-from-zero-fixture.json',import.meta.url),'utf8'));
const fromZeroUrl='http://127.0.0.1:5195';
const fromZero=createLabSampleWord({
  fixture:fromZeroFixture,
  image:await readFile(join(site,'flowdoc-sample.png')),
  serviceUrl:fromZeroUrl,
  serviceToken:(await readFile(new URL('./srs-from-zero-upstream',import.meta.url),'utf8')).trim(),
});
const fromZeroSample=prefix+'/drafts/'+fromZeroFixture.templateId+'/sample-documents';
const libraryFixtures=JSON.parse(await readFile(new URL('./library-sample-fixtures.json',import.meta.url),'utf8'));
const libraryToken=(await readFile(new URL('./library-sample-upstream',import.meta.url),'utf8')).trim();
const libraryImage=await readFile(join(site,'flowdoc-sample.png'));
const librarySamples=libraryFixtures.map(fixture=>({
  docKey:fixture.docKey,
  path:prefix+'/drafts/'+fixture.templateId+'/sample-documents',
  handle:createLabSampleWord({fixture,image:libraryImage,serviceUrl:fromZeroUrl,serviceToken:libraryToken}),
}));
const authoringKeys=new Set([fromZeroFixture.docKey,...librarySamples.map(sample=>sample.docKey)]);
let api;
const server=createServer((request,response)=>{
  void dispatch(request,response).catch(()=>{
    if(response.headersSent||response.destroyed)response.destroy();
    else response.writeHead(500).end();
  });
});

async function dispatch(request,response){
  const host=request.headers.host??'';
  const local=/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host);
  const publicGuest=previewShares&&host===shareUrl.host;
  if(!local&&!publicGuest)
    return response.writeHead(403).end();
  const url=new URL(request.url,'http://localhost');
  if(previewShares&&(url.pathname===sharedPreviewApi||url.pathname.startsWith(sharedPreviewApi+'/'))){
    request.url='/shared-preview'+url.pathname.slice(sharedPreviewApi.length)+url.search;
    return api(request,response);
  }
  if(publicGuest&&!local&&url.pathname!=='/shared-preview'&&
    !/^\/(?:assets\/[\w.-]+\.(?:js|css)|font-(?:300|400)\.ttf|flowdoc-sample\.png)$/.test(url.pathname))
    return response.writeHead(404).end();
  if(local){
  const usesFromZero=url.pathname===fromZeroSample||url.pathname.startsWith(fromZeroSample+'/')||
    (url.pathname==='/documents'&&request.headers['doc-key']===fromZeroFixture.docKey);
  const librarySample=librarySamples.find(({docKey,path})=>url.pathname==='/documents'
    ?request.headers['doc-key']===docKey
    :url.pathname===path||url.pathname.startsWith(path+'/'));
  const sample=librarySample?.handle??(usesFromZero?fromZero:sampleWord);
  if(await sample(request,response,url.pathname))return;
  }
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
  if(pathname==='/shared-preview'){
    if(!previewShares)return response.writeHead(404).end();
    response.setHeader('Referrer-Policy','no-referrer');
    response.setHeader('X-Robots-Tag','noindex, nofollow');
    pathname='/phase1-editor.html';
  }
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

const sectionPublication=await openSectionPublication(process.env.FLOWDOC_SECTION_PUBLICATION_CONFIG);
phase1Bridge({enabled:true,sectionPublication,previewShares,previewShareOrigin:shareOrigin,documentsBaseUrl:'http://127.0.0.1:5194',
  documentsBaseUrlFor:value=>authoringKeys.has(value.docKey)?fromZeroUrl:undefined,startWorker:()=>spawn(process.execPath,['/phase1/phase1-server.mjs'])})
  .configureServer({httpServer:server,middlewares:{use(path,handler){
    if(path!==prefix)throw Error('Unexpected Editor API path');
    api=handler;
  }}});
const port=Number(process.env.PORT??5193);
if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Invalid Editor HTTP port');
server.listen(port,'127.0.0.1');
process.once('SIGTERM',()=>server.close());
