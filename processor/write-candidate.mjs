import {loadGuidance,guidanceIdentity,assertRetainedGuidance} from '../server/guidance.mjs';
import {readFileSync,writeFileSync,lstatSync,existsSync,unlinkSync,realpathSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createAdapter} from '../adapters/reference-git/adapter.mjs';
import {loadMemory} from './memory-tool.mjs';
import {validateMemory} from '../server/memory-model.mjs';
import {validateHypotheses} from '../server/hypotheses.mjs';
import {readInstanceFile,sha256,utf8,instancePath,loadProfile} from '../server/application-profile.mjs';

const json=value=>JSON.stringify(value,null,2)+'\n';
function keys(value,allowed,label){
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!allowed.includes(key)))throw Error('Invalid '+label);
}
function rows(value,label){if(!Array.isArray(value)||value.length>20000)throw Error('Invalid '+label);return value;}
function optionalStat(path){try{return lstatSync(path);}catch(error){if(error.code==='ENOENT')return null;throw error;}}
function appendUnique(old,added){return [...new Map([...old,...added].map(value=>[JSON.stringify(value),value])).values()];}

// The agent supplies semantics. This helper only assembles and preflights drafts;
// the selected adapter must still validate and atomically publish completion.
export async function writeCandidate({root,changes,apply=false}) {
  keys(changes,['schema_version','run_id','base_graph_sha256','base_index_sha256','entities','entity_additions','claims','claim_statuses','review','model'],'change set');
  if(changes.schema_version!==1||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(changes.run_id??'')||
    !/^[0-9a-f]{64}$/.test(changes.base_graph_sha256??'')||!/^[0-9a-f]{64}$/.test(changes.base_index_sha256??''))throw Error('Invalid change set identity or base hashes');
  if(typeof changes.review!=='string'||!changes.review.trim()||changes.review.length>64000||typeof changes.model!=='string'||!changes.model.trim()||changes.model.length>200||/[\r\n]/.test(changes.model))throw Error('Provide a semantic review and a single-line model value (unknown if unavailable)');
  const base=realpathSync(resolve(root)),adapter=createAdapter({instance:base}),status=await adapter.status();
  if(status.recovery_required||status.malformed.length||!status.lease.held||status.lease.run_id!==changes.run_id)throw Error('An owned healthy processing lease is required');
  const graphBytes=await readInstanceFile(base,'memory/graph.json'),indexBytes=await readInstanceFile(base,'memory/index.md');
  if(sha256(graphBytes)!==changes.base_graph_sha256||sha256(indexBytes)!==changes.base_index_sha256)throw Error('Draft base changed; reread and regenerate the change set');
  await loadProfile(base);
  const guidance=await loadGuidance(base,{kinds:[...new Set(status.lease.sources.map(s=>s.kind).filter(Boolean))]});
  if(JSON.stringify(guidance.guidance_version)!==JSON.stringify(status.lease.guidance_version))throw Error('Claimed guidance changed; release and reclaim');
  assertRetainedGuidance(JSON.parse(utf8(await readInstanceFile(base,`memory/runs/${changes.run_id}.guidance.json`))),status.lease.guidance_version);
  const state=await loadMemory(base),previous=JSON.parse(utf8(graphBytes)),graph=structuredClone(previous),at=new Date().toISOString();
  // Reject a draft already changed between the initial read and loadMemory.
  if(JSON.stringify(state.graph)!==JSON.stringify(previous))throw Error('Draft base changed during loading');
  for(const source of status.lease.sources){
    if(state.sources[source.id]?.sha256!==source.sha256)throw Error('Claimed source changed');
    if(graph.sources.some(row=>row.id===source.id)||state.ledger.observations.some(row=>row.id===source.id))throw Error('Claimed source already represented; start from the unmodified graph');
    graph.sources.push({id:source.id,path:source.path,sha256:source.sha256,recorded_at:state.sources[source.id].recorded_at});
  }
  graph.entities.push(...structuredClone(rows(changes.entities??[],'entities')));
  const entities=new Map(graph.entities.map(row=>[row.id,row])),claims=new Map(graph.claims.map(row=>[row.id,row]));
  const changedEntities=new Set();
  for(const addition of rows(changes.entity_additions??[],'entity additions')){
    keys(addition,['id','source_ids','aliases','external_ids'],'entity addition');
    const entity=entities.get(addition.id);
    if(!entity||changedEntities.has(addition.id))throw Error('Unknown or repeated entity addition');
    changedEntities.add(addition.id);
    for(const field of ['source_ids','aliases','external_ids'])if(addition[field]!==undefined)entity[field]=appendUnique(entity[field]??[],rows(addition[field],field));
  }
  const changedClaims=new Set();
  for(const update of rows(changes.claim_statuses??[],'claim statuses')){
    keys(update,['id','status'],'claim status');
    const claim=claims.get(update.id);
    if(!claim||claim.status!=='active'||!['superseded','retracted'].includes(update.status)||changedClaims.has(update.id))throw Error('Only retained active claims may receive one terminal status');
    changedClaims.add(update.id);claim.status=update.status;
  }
  graph.claims.push(...structuredClone(rows(changes.claims??[],'claims')));graph.updated_at=at;
  const journal=`memory/runs/${changes.run_id}.md`;
  const ledger={...state.ledger,observations:[...state.ledger.observations,...status.lease.sources.map(source=>({id:source.id,source_file:source.path,source_sha256:source.sha256,status:'processed'}))]};
  const errors=validateMemory(graph,{...state,ledger,previous});
  errors.push(...validateHypotheses(state.hypotheses,graph,{path:state.layout.hypotheses_path}));
  const queueMarkdown=utf8(await readInstanceFile(base,'questions/queue.md'));
  for(const q of state.queue.questions)if(!queueMarkdown.includes(q.id)||!queueMarkdown.includes(q.text))errors.push('Readable queue missing question: '+q.id);
  if(errors.length)throw Error('Candidate preflight failed: '+errors[0]);
  const sourceLines=status.lease.sources.map(source=>`- ${source.id} (${source.sha256})`).join('\n');
  const guidanceLine=status.lease.guidance_version?`guidance_version: ${sha256(json(status.lease.guidance_version))}\n`:'';
  const report=`# Analysis cycle ${changes.run_id}\n\nModel: ${changes.model}\n${guidanceLine}\n## Sources\n\n${sourceLines}\n\n## Semantic review\n\n${changes.review.trim()}\n\n## Verification\n\nLocal structural preflight passed. Adapter candidate validation and commit remain required.\n`;
  const index=`${utf8(indexBytes).trimEnd()}\n\n## Cycle ${changes.run_id}\n\n${changes.review.trim()}\n\nSources: ${status.lease.sources.length}; entities added: ${(changes.entities??[]).length}; claims added: ${(changes.claims??[]).length}. See ${journal}.\n`;
  const writes=new Map([['memory/graph.json',json(graph)],['memory/index.md',index],[journal,report]]),before=new Map();
  // Preflight every destination, including parents, before the first write.
  for(const path of writes.keys()){
    instancePath(path);let current=base;
    for(const part of path.split('/').slice(0,-1)){
      current=join(current,part);if(!existsSync(current))throw Error('Create the private run directory before drafting');
      const st=lstatSync(current);if(st.isSymbolicLink()||!st.isDirectory())throw Error('Unsafe draft directory');
    }
    const full=join(base,path),st=optionalStat(full);
    if(st){
      if(st.isSymbolicLink()||!st.isFile())throw Error('Unsafe draft file');
      if(path===journal)throw Error('Run journal already exists; preserve it and review drafts manually');
      before.set(path,readFileSync(full));
    }else before.set(path,null);
  }
  if(sha256(before.get('memory/graph.json'))!==changes.base_graph_sha256||sha256(before.get('memory/index.md'))!==changes.base_index_sha256)throw Error('Draft base changed before writing');
  if(apply){
    const fresh=await adapter.status();
    if(fresh.head!==status.head||fresh.recovery_required||!fresh.lease.held||fresh.lease.run_id!==changes.run_id||fresh.malformed.length)throw Error('Committed state changed; reread before drafting');
    for(const source of status.lease.sources)if(sha256(await readInstanceFile(base,source.path))!==source.sha256)throw Error('Claimed source changed');
    const written=[];
    try{
      for(const [path,text]of writes){
        const full=join(base,path),old=before.get(path);
        if(old===null){writeFileSync(full,text,{flag:'wx'});}else{
          if(sha256(await readInstanceFile(base,path))!==sha256(old))throw Error('Draft changed before writing');
          writeFileSync(full,text);
        }
        written.push(path);
      }
    }catch(error){
      for(const path of written.reverse()){
        const full=join(base,path);
        if(sha256(await readInstanceFile(base,path))!==sha256(writes.get(path)))continue;
        if(before.get(path)===null)unlinkSync(full);else writeFileSync(full,before.get(path));
      }
      throw error;
    }
  }
  return {mode:apply?'draft-written':'preview',run_id:changes.run_id,files:[...writes.keys()],entities_added:(changes.entities??[]).length,claims_added:(changes.claims??[]).length,requires:'adapter candidate validation and commit'};
}

export async function run(args=process.argv.slice(2)){
  const options={};
  for(let i=0;i<args.length;i+=2){const key=args[i]?.slice(2);if(!args[i]?.startsWith('--')||!['root','changes','apply'].includes(key)||args[i+1]===undefined||Object.hasOwn(options,key))throw Error('Expected unique --root PATH --changes JSON_FILE [--apply true|false]');options[key]=args[i+1];}
  if(!options.root||!options.changes||options.apply!==undefined&&!['true','false'].includes(options.apply))throw Error('Expected --root PATH --changes JSON_FILE [--apply true|false]');
  const bytes=readFileSync(resolve(options.changes));if(bytes.length>8*1024*1024)throw Error('Change set exceeds 8 MiB');
  return writeCandidate({root:options.root,changes:JSON.parse(utf8(bytes)),apply:options.apply==='true'});
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))run().then(value=>console.log(JSON.stringify(value,null,2))).catch(error=>{console.error(error.message);process.exitCode=1;});
