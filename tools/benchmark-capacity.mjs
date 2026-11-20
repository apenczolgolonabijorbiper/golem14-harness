import {performance} from 'node:perf_hooks';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {fixture,command,harness} from '../server/test-fixtures.mjs';
import {parseSource} from '../processor/memory-tool.mjs';
import {validateMemory,retrieveContext,memoryStats} from '../server/memory-model.mjs';
import {createAdapter} from '../adapters/reference-git/adapter.mjs';

export function syntheticState(count,{entities=5000,claims=20000,bodyCharacters=256}={}){
  const at='2026-01-01T00:00:00.000Z',sources={},notes=new Map();
  for(let n=1;n<=count;n++){
    const id=`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,path=`inbox/${id}.md`,text=`---\nid: ${id}\nrecorded_at: ${at}\nkind: synthetic\n---\nSynthetic record.\n${'x'.repeat(Math.max(0,bodyCharacters-18))}\n`;
    notes.set(path,text);sources[id]=parseSource(path,text);
  }
  const first=Object.values(sources)[0],entityRows=Array.from({length:entities},(_,n)=>({id:'ent-'+String(n).padStart(6,'0'),type:'other',label:'Synthetic '+n,aliases:[],source_ids:[first.id],created_at:at,uncertainty:[]}));
  const claimRows=Array.from({length:claims},(_,n)=>({id:'clm-'+String(n).padStart(6,'0'),subject_id:entityRows[0].id,attributed_to_id:entityRows[0].id,predicate:'describes',object:{value:'Synthetic'},classification:'source_assertion',sources:[{observation_id:first.id,quote:'Synthetic record.'}],asserted_at:at,valid_time:{from:null,to:null,expression:null,precision:'unknown'},status:'active',supersedes:[],uncertainty:[],created_at:at}));
  return {graph:{schema_version:2,updated_at:at,sources:Object.values(sources).map(({id,path,sha256,recorded_at})=>({id,path,sha256,recorded_at})),entities:entityRows,claims:claimRows},sources,notes,ledger:{schema_version:1,updated_at:at,observations:Object.values(sources).map(s=>({id:s.id,status:'processed',source_file:s.path,source_sha256:s.sha256,processed_at:at,outputs:['memory/graph.json'],run:'memory/runs/baseline.md'}))},queue:{schema_version:1,updated_at:at,questions:[]}};
}
function timed(fn){const at=performance.now(),value=fn();return {ms:Math.round(performance.now()-at),value};}
export async function benchmark(count,bodyCharacters=256){
  const full=syntheticState(count,{bodyCharacters}),base=syntheticState(count-1,{bodyCharacters}),cleanups=[];
  const out={sources:count,body_characters:bodyCharacters,baseline_sources:count-1,entities:5000,claims:20000,node:process.version,platform:process.platform};
  try{
    const v=timed(()=>validateMemory(full.graph,{...full,previous:full.graph}));out.in_memory_validate_ms=v.ms;out.in_memory_errors=v.value;
    out.in_memory_context_ms=timed(()=>retrieveContext(full.graph,{query:'Synthetic',limit:100})).ms;
    const f=fixture({after:fn=>cleanups.push(fn)});for(const [path,text]of base.notes)f.write(path,text);
    f.write('memory/graph.json',base.graph);f.write('memory/processed.json',base.ledger);f.write('memory/runs/baseline.md','Synthetic baseline');f.save();
    for(const operation of ['validate','stats','context'])for(const temperature of ['cold','warm']){
      const r=timed(()=>command(process.execPath,[join(harness,'processor/memory-tool.mjs'),operation,'--root',f.root,...(operation==='context'?['--query','Synthetic']:[])],{maxBuffer:32*1024*1024}));
      out[operation+'_'+temperature+'_ms']=r.ms;out[operation+'_output_bytes']=Buffer.byteLength(r.value);
    }
    const source=f.observe(count,{body:'Synthetic record.'});full.graph.sources[full.graph.sources.length-1]={id:source.id,path:source.path,sha256:source.sha256,recorded_at:source.recorded_at};full.graph.updated_at=new Date().toISOString();
    const adapter=createAdapter({instance:f.root}),claim=await adapter.claim();f.write('memory/graph.json',full.graph);f.write(`memory/runs/${claim.run_id}.md`,'Synthetic benchmark review');
    let at=performance.now();await adapter.validate({run:claim.run_id});out.candidate_validate_ms=Math.round(performance.now()-at);
    at=performance.now();await adapter.commit({run:claim.run_id});out.candidate_commit_ms=Math.round(performance.now()-at);
    at=performance.now();await adapter.validate();out.working_tree_validate_ms=Math.round(performance.now()-at);
    out.parent_peak_rss_mib=Math.round(process.resourceUsage().maxRSS/1024);out.child_peak_memory='not exposed by portable Node spawn; parent peak only';
    return out;
  }finally{for(const clean of cleanups.reverse())clean();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const counts=(process.argv[2]??'500,2000,5000,10000').split(',').map(Number);
  for(const n of counts){if(!Number.isInteger(n)||n<2||n>10000)throw Error('Invalid benchmark size');console.log(JSON.stringify(await benchmark(n,Number(process.argv[3]??256))));}
}
