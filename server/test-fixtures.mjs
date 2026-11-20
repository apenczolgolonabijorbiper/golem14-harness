import {mkdtempSync,readFileSync,writeFileSync,mkdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {boundedSpawn} from './subprocess.mjs';
import {parseSource} from '../processor/memory-tool.mjs';

export const harness=resolve(dirname(fileURLToPath(import.meta.url)),'..');
export function command(executable,args,options={}) {
  const r=boundedSpawn(executable,args,{encoding:'utf8',...options});
  if(r.status!==0)throw Error('Command failed: '+JSON.stringify([executable,...args])+': '+(r.stderr||r.stdout||r.error));
  return r.stdout.trim();
}

export function pythonCommand({env=process.env,platform=process.platform}={}) {
  if(env.GOLEM_PYTHON) return [env.GOLEM_PYTHON];
  return platform==='win32'?['py','-3']:['python3'];
}
export function python(args,options={}) {
  const [executable,...prefix]=pythonCommand({env:options.env??process.env});
  return command(executable,[...prefix,...args],options);
}

export function fixture(t,{profile=false}={}) {
  const base=mkdtempSync(join(tmpdir(),'golem-test-')),root=join(base,'instance');
  t.after(()=>rmSync(base,{recursive:true,force:true,maxRetries:10,retryDelay:100}));
  python([join(harness,'processor/init-instance.py'),'--root',root,...(profile?['--profile']:[])]);
  const read=path=>readFileSync(join(root,path),'utf8');
  const write=(path,value)=>{mkdirSync(dirname(join(root,path)),{recursive:true});writeFileSync(join(root,path),typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value,null,2)+'\n');};
  const git=(...args)=>command('git',['-C',root,...args]);
  git('init','-q');git('config','commit.gpgsign','false');git('config','gc.auto','0');git('config','maintenance.auto','false');git('config','core.hooksPath',join(base,'no-hooks'));git('config','user.name','Synthetic');git('config','user.email','synthetic@localhost');
  const save=()=>{git('add','.');git('commit','-qm','Synthetic snapshot');};save();
  const observe=(n=1,{age=120000,kind='observation',body='Synthetic record.'}={})=>{
    const id=`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,path=`inbox/${id}.md`;
    write(path,`---\nid: ${id}\nrecorded_at: ${new Date(Date.now()-age).toISOString()}\nkind: ${kind}\n---\n${body}\n`);
    return parseSource(path,read(path));
  };
  const analyze=(claim,{bad=false}={})=>{
    const graph=JSON.parse(read('memory/graph.json'));
    graph.updated_at=new Date().toISOString();
    for(const s of claim.sources){
      const source=parseSource(s.path,read(s.path));graph.sources.push({id:s.id,path:s.path,sha256:s.sha256,recorded_at:source.recorded_at});
      const id='ent-'+s.id;
      graph.entities.push({id,type:'other',kind:'record',label:'Synthetic record',aliases:[],source_ids:[s.id],uncertainty:[],created_at:graph.updated_at});
      graph.claims.push({id:'clm-'+s.id,subject_id:id,attributed_to_id:id,predicate:'describes',object:{value:'Synthetic'},classification:'source_assertion',sources:[{observation_id:s.id,quote:bad?'Missing quotation':source.body.trim()}],asserted_at:source.recorded_at,valid_time:{from:null,to:null,expression:null,precision:'unknown'},status:'active',supersedes:[],uncertainty:[],created_at:graph.updated_at});
    }
    write('memory/graph.json',graph);
    write(`memory/runs/${claim.run_id}.md`,'# Synthetic semantic review\n\nSources reviewed; declaration only.\n'+(claim.guidance_identity?'guidance_version: '+claim.guidance_identity+'\n':''));
  };
  return {root,read,write,git,save,observe,analyze};
}
