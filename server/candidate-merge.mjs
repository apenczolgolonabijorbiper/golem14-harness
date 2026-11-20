// Mechanical candidate construction only. Publication, ancestry and reservations belong to the host.
import {lstat,readdir,realpath,mkdir,writeFile,rm} from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual as equal} from 'node:util';
import {instancePath,readInstanceFile,within,physicallyWithin,utf8,loadProfile} from './application-profile.mjs';
import {validateMemory} from './memory-model.mjs';
import {validateHypotheses} from './hypotheses.mjs';
import {parseSource} from '../processor/memory-tool.mjs';

const engine=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const lease='memory/processing-lock.json';
const collections={'memory/graph.json':['sources','entities','claims'],'memory/processed.json':['observations'],'questions/queue.json':['questions'],'memory/hypotheses.json':['hypotheses']};
const summaries=new Set(['memory/index.md','questions/queue.md']);
const json=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
async function noLinks(path){
  for(let p=resolve(path);;p=dirname(p)){
    if((await lstat(p)).isSymbolicLink())throw Error('Symlink snapshot path refused');
    if(dirname(p)===p)return;
  }
}
async function capture(path){
  await noLinks(path);const root=await realpath(path);
  if(!(await lstat(root)).isDirectory()||within(engine,root)||physicallyWithin(engine,root)||within(root,engine)||physicallyWithin(root,engine))throw Error('Snapshot must be a directory separate from the engine');
  const files=new Map();let bytes=0,entries=0;
  async function walk(dir=''){
    for(const entry of (await readdir(join(root,dir),{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
      if(!dir&&entry.name.toLowerCase()==='.git')continue;
      const path=dir?dir+'/'+entry.name:entry.name;instancePath(path);
      if(++entries>50000||path.split('/').length>128)throw Error('Snapshot exceeds 50,000 entries or 128 path components');
      if(/[. ]$/.test(entry.name)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(entry.name))throw Error('Nonportable snapshot path: '+path);
      if(path===lease)continue; // Host lease state is neither read nor copied.
      if(entry.isDirectory())await walk(path);
      else {
        if(!entry.isFile())throw Error('Non-regular snapshot file: '+path);
        const size=(await lstat(join(root,path))).size;
        if(files.size>=50000||bytes+size>64*1024*1024)throw Error('Snapshot exceeds 50,000 files or 64 MiB');
        const value=await readInstanceFile(root,path);bytes+=value.length;
        if(bytes>64*1024*1024)throw Error('Snapshot exceeds 64 MiB');
        files.set(path,value);
      }
    }
  }
  await walk();return {root,files};
}
function reader(files){return async path=>{instancePath(path);if(!files.has(path))throw Object.assign(Error('Missing snapshot file: '+path),{code:'ENOENT'});return files.get(path);};}
async function state(snapshot){
  const read=reader(snapshot.files),get=async path=>JSON.parse(utf8(await read(path)));
  const graph=await get('memory/graph.json'),ledger=await get('memory/processed.json'),queue=await get('questions/queue.json'),hypotheses=await get('memory/hypotheses.json');
  if(!snapshot.files.has('instance/purpose.md'))throw Error('Missing instance/purpose.md');
  for(const path of summaries)await read(path);
  for(const value of [ledger,queue])if(!Number.isFinite(Date.parse(value?.updated_at)))throw Error('Invalid collection updated_at');
  const sources=Object.create(null);
  for(const [path,bytes] of snapshot.files)if(/^inbox\/[^/]+\.md$/.test(path)){const s=parseSource(path,utf8(bytes));sources[s.id]=s;}
  const profile=await loadProfile(snapshot.root,{read});
  return {graph,ledger,queue,hypotheses,sources,profile};
}
function errors(s,previous){
  const result=validateMemory(s.graph,{...s,previous});
  if(!result.length)result.push(...validateHypotheses(s.hypotheses,s.graph));
  return result;
}
function readableErrors(s,files){const text=utf8(files.get('questions/queue.md'));return s.queue.questions.filter(q=>!text.includes(q.id)||!text.includes(q.text)).map(q=>'Readable queue missing question: '+q.id);}
function guidancePaths(files){
  const paths=new Set(['instance/purpose.md','golem.config.json']);
  const config=files.has('golem.config.json')?JSON.parse(utf8(files.get('golem.config.json'))):null;
  if(config?.profile){const p=config.profile;paths.add(p.path);if(p.vocabulary)paths.add(p.vocabulary);for(const s of p.sections??[])paths.add(s.path);}
  return paths;
}

export async function mergeSnapshots({base,ours,theirs,out}){
  const report={merged:{},conflicts:[],needs_regeneration:[],warnings:[],base_checked_by:'host'};
  let conflictCount=0;
  const conflict=(file,id,kind,detail)=>{conflictCount++;if(report.conflicts.length<1000)report.conflicts.push({file,...(id?{id}:{}),kind,...(detail?{detail}:{} )});};
  const finish=()=>({...report,conflict_summary:{total:conflictCount,returned:report.conflicts.length,truncated:conflictCount>report.conflicts.length}});
  let created=false,output;
  try{
    if(![base,ours,theirs,out].every(p=>typeof p==='string'&&p))throw Error('Required merge options: --base --ours --theirs --out');
    output=resolve(out);await noLinks(dirname(output));
    try{await lstat(output);throw Error('Output already exists');}catch(e){if(e.code!=='ENOENT')throw e;}
    const parent=await realpath(dirname(output));output=join(parent,output.slice(dirname(output).length+1));
    if(within(engine,output)||physicallyWithin(engine,parent)||within(output,engine))throw Error('Output must be outside the engine');
    const B=await capture(base),O=await capture(ours),T=await capture(theirs);
    for(const s of [B,O,T])if(within(s.root,output)||within(output,s.root)||physicallyWithin(s.root,parent))throw Error('Output overlaps an input snapshot');
    const states=await Promise.all([B,O,T].map(state));
    const [b,o,t]=states;
    // Check keyed shape before merging; history checks follow so record conflicts can name IDs.
    for(const [i,s] of states.entries()){
      const issues=[...errors(s),...readableErrors(s,[B,O,T][i].files)];
      for(const error of issues)conflict(['base','ours','theirs'][i],null,'invalid_snapshot',error);
    }
    if(conflictCount)return finish();
    const result=new Map(),regen=new Set();
    for(const path of new Set([...guidancePaths(B.files),...guidancePaths(O.files),...guidancePaths(T.files)])){
      if(!equal(B.files.get(path),O.files.get(path))||!equal(B.files.get(path),T.files.get(path)))conflict(path,null,'guidance_changed');
    }
    const mergeRecord=(file,id,bv,ov,tv,{ledger=false}={})=>{
      if(bv!==undefined&&(ov===undefined||tv===undefined)){conflict(file,id,'record_removed');return ov??tv;}
      if(ledger){
        if(bv!==undefined){if(!equal(bv,ov)||!equal(bv,tv))conflict(file,id,'ledger_history_changed');return bv;}
        if(ov!==undefined&&tv!==undefined){conflict(file,id,'source_processed_twice');return ov;}
      }
      if(equal(ov,tv))return ov;
      if(equal(bv,ov))return tv;
      if(equal(bv,tv))return ov;
      conflict(file,id,'record_changed_both');return ov;
    };
    for(const [path,keys] of Object.entries(collections)){
      const [bv,ov,tv]=[B,O,T].map(s=>JSON.parse(utf8(s.files.get(path))));
      const value=Object.create(null);
      for(const key of new Set([...Object.keys(bv),...Object.keys(ov),...Object.keys(tv)])){
        if(keys.includes(key)){
          const [bm,om,tm]=[bv,ov,tv].map(v=>new Map(v[key].map(r=>[r.id,r])));
          value[key]=[...new Set([...bm.keys(),...om.keys(),...tm.keys()])].map(id=>mergeRecord(path,id,bm.get(id),om.get(id),tm.get(id),{ledger:key==='observations'}));
        }else if(key==='updated_at')value[key]=Date.parse(ov[key])>=Date.parse(tv[key])?ov[key]:tv[key];
        else value[key]=mergeRecord(path,key,bv[key],ov[key],tv[key]);
      }
      result.set(path,json(value));
    }
    for(const path of new Set([...B.files.keys(),...O.files.keys(),...T.files.keys()])){
      if(Object.hasOwn(collections,path))continue;
      const bv=B.files.get(path),ov=O.files.get(path),tv=T.files.get(path);
      if(bv!==undefined&&(ov===undefined||tv===undefined)){conflict(path,null,'file_removed');continue;}
      if(bv!==undefined&&/^(inbox|evidence|memory\/runs|memory\/events)\//.test(path)&&(!equal(bv,ov)||!equal(bv,tv))){conflict(path,null,'immutable_file_changed');continue;}
      if(bv===undefined&&ov!==undefined&&tv!==undefined&&/^memory\/runs\//.test(path)){conflict(path,null,'run_collision');continue;}
      if(summaries.has(path)&&!equal(bv,ov)&&!equal(bv,tv)){result.set(path,ov);regen.add(path);}
      else if(equal(ov,tv))result.set(path,ov);
      else if(equal(bv,ov))result.set(path,tv);
      else if(equal(bv,tv))result.set(path,ov);
      else conflict(path,null,'file_changed_both');
    }
    // Summaries cannot describe a graph assembled from two independently changed branches reliably.
    if(!equal(b.graph,o.graph)&&!equal(b.graph,t.graph))regen.add('memory/index.md');
    const merged=await state({root:output,files:result});
    if(readableErrors(merged,result).length)regen.add('questions/queue.md');
    for(const [label,s] of [['ours',o],['theirs',t]])for(const error of errors(s,b.graph))conflict(label,null,'invalid_branch_history',error);
    for(const error of errors(merged,o.graph))conflict('merged',null,'invalid_merged_history',error);
    const baseIds=new Set(b.graph.entities.map(e=>e.id)),oursIds=new Set(o.graph.entities.map(e=>e.id));
    const names=new Map(),normalize=e=>JSON.stringify([e.type,e.label.normalize('NFKC').trim().replace(/\s+/g,' ').toLowerCase()]);
    for(const e of o.graph.entities)if(!baseIds.has(e.id)){const key=normalize(e);if(!names.has(key))names.set(key,[]);names.get(key).push(e.id);}
    let warningCount=0;
    for(const e of t.graph.entities)if(!baseIds.has(e.id)&&!oursIds.has(e.id)){
      const ids=names.get(normalize(e))??[];warningCount+=ids.length;
      for(const id of ids.slice(0,1000-report.warnings.length))report.warnings.push({kind:'possible_duplicate_entity',entity_ids:[id,e.id]});
    }
    report.warning_summary={total:warningCount,returned:report.warnings.length,truncated:warningCount>report.warnings.length};
    report.needs_regeneration=[...regen].sort();report.requires_review=regen.size>0;
    report.validation={history_against:'ours',readable_queue_consistent:!readableErrors(merged,result).length,publication_checked:false};
    report.merged={sources:merged.graph.sources.length,entities:merged.graph.entities.length,claims:merged.graph.claims.length,ledger_rows:merged.ledger.observations.length,questions:merged.queue.questions.length,hypotheses:merged.hypotheses.hypotheses.length};
    if(conflictCount)return finish();
    // Detect common accidental mutations. Hosts must still provide coherent immutable snapshots.
    for(const original of [B,O,T])if(!equal(original.files,(await capture(original.root)).files))throw Error('Input snapshot changed during merge');
    // Preflight file/directory collisions before creating anything.
    const portable=new Map();
    for(const path of result.keys()){
      const parts=path.split('/');
      for(let i=1;i<=parts.length;i++){const part=parts.slice(0,i).join('/'),key=part.normalize('NFC').toLowerCase(),kind=i===parts.length?'file':'directory',prior=portable.get(key);
        if(prior&&(prior.path!==part||prior.kind!==kind))throw Error('Portable file/directory collision: '+path);
        portable.set(key,{path:part,kind});
      }
    }
    await mkdir(output);created=true;
    for(const dir of ['inbox','evidence','memory/runs','memory/events','questions','instance'])await mkdir(join(output,dir),{recursive:true});
    for(const [path,bytes] of result){await mkdir(dirname(join(output,path)),{recursive:true});await writeFile(join(output,path),bytes,{flag:'wx'});}
    return finish();
  }catch(e){
    if(created)await rm(output,{recursive:true,force:true,maxRetries:10,retryDelay:100});
    conflict('merge',null,'merge_refused',e.message);return finish();
  }
}
