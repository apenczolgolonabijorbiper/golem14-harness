/** Repo-only paired benchmark against retained Python baseline; never ships baseline. */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {fileURLToPath} from 'node:url';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const python=process.env.GOLEM_PYTHON??(process.platform==='win32'?'py':'python3');
const base=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'golem-paired-')));
const {index}=await import('../processor/process.mjs');
const {initialize}=await import('../processor/init-instance.mjs');
const implementations={python:[python,path.join(repo,'tools/legacy-python')],node:[process.execPath,path.join(repo,'processor')]};
function call(kind,operation,root){const [exe,dir]=implementations[kind],suffix=kind==='python'?'py':'mjs',started=performance.now();const r=spawnSync(exe,[path.join(dir,operation+'.'+suffix),'--root',root],{encoding:'utf8',timeout:120000});if(r.status!==0||r.error)throw Error(r.stderr||String(r.error));return performance.now()-started;}
const median=a=>[...a].sort((a,b)=>a-b)[Math.floor(a.length/2)];
const digest=p=>createHash('sha256').update(fs.readFileSync(path.join(repo,p))).digest('hex');
const report={reference_files:Object.fromEntries(['tools/legacy-python/process.py','tools/legacy-python/init-instance.py','processor/index-core.cjs','processor/init-instance.mjs'].map(p=>[p,digest(p)])),platform:process.platform,arch:process.arch,node:process.version,python:spawnSync(python,['--version'],{encoding:'utf8'}).stdout.trim(),cpu:os.cpus()[0].model,method:'7 paired samples, alternating order; median elapsed CLI time including startup; identical UTF-8 source bytes; fsync enabled; local scratch filesystem. Warm-up excluded. Synthetic only.',cases:[]};
try{
  for(const kind of Object.keys(implementations)){const root=path.join(base,'warmup-'+kind);call(kind,'init-instance',root);call(kind,'process',root);}
  const init={python:[],node:[]};
  for(let i=0;i<7;i++)for(const kind of i%2?['node','python']:['python','node'])init[kind].push(call(kind,'init-instance',path.join(base,'init-'+i+'-'+kind)));
  const directInit=[];for(let i=0;i<7;i++){const started=performance.now();await initialize(path.join(base,'direct-init-'+i));directInit.push(performance.now()-started);}
  report.direct_initialization_ms=directInit;
  report.direct_initialization_median_ms=median(directInit);
  report.cases.push({operation:'initialize',observations:0,samples_ms:init,python_median_ms:median(init.python),node_median_ms:median(init.node),ratio:median(init.node)/median(init.python)});
  for(const count of [0,10,100,1000]){
    const roots={};for(const kind of Object.keys(implementations)){roots[kind]=path.join(base,kind+'-'+count);call(kind,'init-instance',roots[kind]);for(let n=0;n<count;n++){const id=`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;fs.writeFileSync(path.join(roots[kind],'inbox',id+'.md'),`---\nid: ${id}\nrecorded_at: 2026-01-01T00:00:00.000Z\nkind: observation\n---\n\nZażółć 世界. Synthetic evidence. `.repeat(1)+'Body. '.repeat(100)+'\n');}}
    for(const mode of ['fresh','already-indexed','host-direct-fresh','host-direct-already-indexed']){
      const samples={python:[],node:[]};
      for(let i=0;i<7;i++)for(const kind of i%2?['node','python']:['python','node']){
        if(mode==='fresh'||mode==='host-direct-fresh')for(const name of fs.readdirSync(path.join(roots[kind],'evidence')))fs.unlinkSync(path.join(roots[kind],'evidence',name));
        if(kind==='node'&&mode.startsWith('host-direct')){const started=performance.now();index(roots[kind],{log:()=>{}});samples[kind].push(performance.now()-started);}else samples[kind].push(call(kind,'process',roots[kind]));
      }
      const names=fs.readdirSync(path.join(roots.python,'evidence')).sort();
      if(names.length!==count)throw Error('Missing Python evidence');
      for(const name of names)if(!fs.readFileSync(path.join(roots.python,'evidence',name)).equals(fs.readFileSync(path.join(roots.node,'evidence',name))))throw Error('Evidence byte mismatch: '+name);
      report.cases.push({operation:'index-'+mode,observations:count,body_bytes:fs.existsSync(path.join(roots.node,'inbox',names[0]?.replace('.json','.md')??''))&&count?fs.statSync(path.join(roots.node,'inbox',names[0].replace('.json','.md'))).size:0,samples_ms:samples,python_median_ms:median(samples.python),node_median_ms:median(samples.node),ratio:median(samples.node)/median(samples.python),evidence_byte_parity:true});
    }
  }
  const output=process.argv[2]??path.join(repo,'docs/validation/node-runtime-linux.json');fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report.cases.map(({samples_ms,...row})=>row),null,2));
}finally{fs.rmSync(base,{recursive:true,force:true});}
