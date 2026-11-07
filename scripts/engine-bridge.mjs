import {spawn} from 'node:child_process';
import readline from 'node:readline';

const lab='/home/ubuntu/flowdoc-prosemirror-spike-20261107';
const candidate='/home/ubuntu/flowdoc-audit-187957aecc2d/flowdoc-schema-freshapi-git055-complete-20261106/candidate';
const image='sha256:07c71903922ef511587627683cb2a5041faa62273ee18da2cb52b434b5900388';
export function engineBridge() {
  let child,sequence=0;
  const pending=new Map();
  function stop(reason='Engine bridge closed') {
    child?.stdin.end();child?.kill();child=undefined;
    for(const job of pending.values()){clearTimeout(job.timer);job.reject(Error(reason))}pending.clear();
  }
  function start() {
    if(child)return;
    const proc=spawn('ssh.exe',['-T','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=10','-i','C:/test/keyflow.key','ubuntu@129.221.205.23',
      `sudo docker run --rm -i --network none --memory 1g --memory-swap 1g --cpus 2 --user 10001:10001 -v ${lab}:/spike:ro -v ${candidate}:/candidate:ro --entrypoint node ${image} /spike/scripts/engine-server.mjs`],{windowsHide:true});
    child=proc;
    proc.stdin.on('error',e=>{if(child===proc)stop(e.message)});
    readline.createInterface({input:proc.stdout}).on('line',line=>{
      try{const result=JSON.parse(line),job=pending.get(result.id);if(!job)return;pending.delete(result.id);clearTimeout(job.timer);result.error?job.reject(Error(result.error)):job.resolve(result)}catch{stop('Invalid Engine response')}
    });
    proc.stderr.on('data',d=>process.stderr.write(d));
    proc.on('error',e=>{if(child===proc)stop(e.message)});
    proc.on('exit',()=>{if(child===proc)stop('Engine process exited')});
  }
  return {name:'flowdoc-engine-spike',configureServer(server){
    server.httpServer?.on('close',()=>stop());
    server.middlewares.use('/api/layout',async(req,res)=>{
      if(req.method!=='POST'){res.statusCode=405;return res.end()}
      // Bind to loopback and reject cross-origin browser calls to this lab bridge.
      if(req.headers.origin&&req.headers.origin!==`http://${req.headers.host}`){res.statusCode=403;return res.end()}
      try {
        let body='';for await(const chunk of req){body+=chunk;if(body.length>262144)throw Error('Spike request too large')}
        const request=JSON.parse(body);start();const id=++sequence;
        const result=await new Promise((resolve,reject)=>{
          const timer=setTimeout(()=>stop('Engine request timed out'),30000);
          pending.set(id,{resolve,reject,timer});child.stdin.write(JSON.stringify({id,request})+'\n');
        });
        res.setHeader('Content-Type','application/json');res.end(JSON.stringify(result));
      }catch(error){res.statusCode=503;res.end(JSON.stringify({error:String(error)}))}
    });
  }};
}
