import {validateHypotheses} from '../server/hypotheses.mjs';
import {resolveLayout} from '../server/instance-layout.mjs';
import {readFile,readdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {loadProfile,utf8,readInstanceFile} from '../server/application-profile.mjs';
import {validateMemory,retrieveContext,memoryStats,collectWarnings} from '../server/memory-model.mjs';

export function parseSource(path,text){
  const match=text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);if(!match)throw Error('Incomplete source: '+path);
  const fields=Object.create(null);for(const line of match[1].split('\n')){const m=line.match(/^([a-z_]+):\s*(.*?)\s*$/);if(!m)throw Error('Invalid source header: '+path);if(Object.hasOwn(fields,m[1]))throw Error('Duplicate source field: '+path);let value=m[2];if(value.startsWith('"')){try{value=JSON.parse(value);}catch{throw Error('Invalid quoted header: '+path);}}fields[m[1]]=value;}
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(fields.id)||path!==`inbox/${fields.id}.md`||!match[2].trim()||!Number.isFinite(Date.parse(fields.recorded_at)))throw Error('Invalid source: '+path);
  return {...fields,path,body:match[2],sha256:createHash('sha256').update(text,'utf8').digest('hex')};
}
export async function loadMemory(root){
  const layout=await resolveLayout(root);
  const json=async path=>JSON.parse(utf8(await readInstanceFile(root,path)));
  const [graph,ledger,queue,names]=await Promise.all([json('memory/graph.json'),json('memory/processed.json'),json('questions/queue.json'),readdir(resolve(root,'inbox'))]);
  const sources={};for(const name of names.filter(n=>n.endsWith('.md'))){const path='inbox/'+name;const source=parseSource(path,utf8(await readInstanceFile(root,path)));sources[source.id]=source;}
  let hypotheses;try{hypotheses=await json(layout.hypotheses_path);}catch(e){throw Error('Hypotheses file invalid: '+layout.hypotheses_path+': '+(e instanceof SyntaxError?'malformed JSON':e.message));}
  return {graph,ledger,queue,sources,layout,hypotheses};
}
export async function run(args=process.argv.slice(2)){
  const command=args.shift(),options={};
  if(command==='merge'){
    for(let i=0;i<args.length;i+=2){const key=args[i]?.slice(2);if(!args[i]?.startsWith('--')||!['base','ours','theirs','out'].includes(key)||args[i+1]===undefined||Object.hasOwn(options,key))throw Error('Expected unique --base/--ours/--theirs/--out paths');options[key]=args[i+1];}
    const {mergeSnapshots}=await import('../server/candidate-merge.mjs');return mergeSnapshots(options);
  }
  for(let i=0;i<args.length;i+=2){if(!args[i]?.startsWith('--')||args[i+1]===undefined)throw Error('Expected --option value');const key=args[i].slice(2);if(!['root','previous','query','entity','source','limit','predicate','type','kind','status','hops','expansion-budget','current','valid-at','external-id','scheme','namespace'].includes(key)||Object.hasOwn(options,key))throw Error('Unknown or duplicate option: '+key);options[key]=args[i+1];}
  if(!['validate','context','stats'].includes(command))throw Error('Usage: node processor/memory-tool.mjs merge --base BASE --ours OURS --theirs THEIRS --out OUT; or validate|context|stats [--root path] [--previous graph.json] [--query text] [--entity id] [--source uuid] [--limit number] [--predicate list] [--type list] [--kind list] [--status active|all] [--hops 1..3] [--expansion-budget 1..20000] [--current true|false] [--valid-at UTC-ISO] [--external-id value --scheme slug --namespace scope]');
  const root=resolve(options.root||dirname(fileURLToPath(import.meta.url))+'/..'),state=await loadMemory(root);
  const profile=await loadProfile(root);
  const previous=options.previous?JSON.parse(await readFile(resolve(options.previous),'utf8')):undefined;
  const errors=validateMemory(state.graph,{...state,previous});
  if(!errors.length)errors.push(...validateHypotheses(state.hypotheses,state.graph,{path:state.layout.hypotheses_path}));
  const markdown=utf8(await readInstanceFile(root,'questions/queue.md'));
  for(const q of state.queue.questions)if(!markdown.includes(q.id)||!markdown.includes(q.text))errors.push('Readable queue missing question: '+q.id);
  if (errors.length) throw Error(`Memory validation failed: ${errors[0]}\n${errors.join('\n')}`);
  if(command==='validate'){const warnings=collectWarnings(state.graph,{...state,vocabulary:profile?.vocabulary});return {valid:true,layout:state.layout,warnings:warnings.slice(0,1000),warning_summary:{total:warnings.length,returned:Math.min(1000,warnings.length),truncated:warnings.length>1000},entities:state.graph.entities.length,claims:state.graph.claims.length,sources:state.graph.sources.length};}
  if(command==='stats')return memoryStats(state.graph,state.sources,state.ledger,state.queue);
  const context=retrieveContext(state.graph,{vocabulary:profile?.vocabulary,current:options.current,valid_at:options['valid-at'],external_id:options['external-id'],scheme:options.scheme,namespace:options.namespace,query:options.query,entity_id:options.entity,source_id:options.source,limit:options.limit,predicate:options.predicate,type:options.type,kind:options.kind,status:options.status,hops:options.hops,expansion_budget:options['expansion-budget']});
  let remaining=64000;context.source_excerpts=context.sources.map(s=>{const body=state.sources[s.id].body,text=body.slice(0,Math.min(4000,remaining));remaining-=text.length;return {...s,text,truncated:text.length<body.length};});
  context.limits.excerpt_characters=64000;if(context.source_excerpts.some(s=>s.truncated)){context.truncated=true;context.truncation_reasons=[...(context.truncation_reasons??[]),'excerpt_limit'];}return context;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))run().then(r=>{console.log(JSON.stringify(r,null,2));if(r.conflicts?.length)process.exitCode=1;}).catch(e=>{console.error(e.message);process.exitCode=1;});
