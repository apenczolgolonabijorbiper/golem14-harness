import {readFile,readdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {validateMemory,retrieveContext,memoryStats} from '../server/memory-model.mjs';

export function parseSource(path,text){
  const match=text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);if(!match)throw Error('Incomplete source: '+path);
  const fields={};for(const line of match[1].split('\n')){const m=line.match(/^([a-z_]+):\s*(.*?)\s*$/);if(!m)throw Error('Invalid source header: '+path);if(Object.hasOwn(fields,m[1]))throw Error('Duplicate source field: '+path);let value=m[2];if(value.startsWith('"')){try{value=JSON.parse(value);}catch{throw Error('Invalid quoted header: '+path);}}fields[m[1]]=value;}
  if(!/^[0-9a-f-]{36}$/.test(fields.id)||path!==`inbox/${fields.id}.md`||!match[2].trim()||!Number.isFinite(Date.parse(fields.recorded_at)))throw Error('Invalid source: '+path);
  return {...fields,path,body:match[2],sha256:createHash('sha256').update(text,'utf8').digest('hex')};
}
export async function loadMemory(root){
  const json=async path=>JSON.parse(await readFile(resolve(root,path),'utf8'));
  const [graph,ledger,queue,names]=await Promise.all([json('memory/graph.json'),json('memory/processed.json'),json('questions/queue.json'),readdir(resolve(root,'inbox'))]);
  const sources={};for(const name of names.filter(n=>n.endsWith('.md'))){const path='inbox/'+name;const source=parseSource(path,await readFile(resolve(root,path),'utf8'));sources[source.id]=source;}
  return {graph,ledger,queue,sources};
}
export async function run(args=process.argv.slice(2)){
  const command=args.shift(),options={};for(let i=0;i<args.length;i+=2){if(!args[i]?.startsWith('--')||args[i+1]===undefined)throw Error('Expected --option value');options[args[i].slice(2)]=args[i+1];}
  if(!['validate','context','stats'].includes(command))throw Error('Usage: node processor/memory-tool.mjs validate|context|stats [--root path] [--previous graph.json] [--query text] [--entity id] [--source uuid] [--limit number]');
  const root=resolve(options.root||dirname(fileURLToPath(import.meta.url))+'/..'),state=await loadMemory(root);
  const previous=options.previous?JSON.parse(await readFile(resolve(options.previous),'utf8')):undefined;
  const errors=validateMemory(state.graph,{...state,previous});
  const markdown=await readFile(resolve(root,'questions/queue.md'),'utf8');
  for(const q of state.queue.questions)if(!markdown.includes(q.id)||!markdown.includes(q.text))errors.push('Readable queue missing question: '+q.id);
  if (errors.length) throw Error(`Memory validation failed: ${errors[0]}\n${errors.join('\n')}`);
  if(command==='validate')return {valid:true,entities:state.graph.entities.length,claims:state.graph.claims.length,sources:state.graph.sources.length};
  if(command==='stats')return memoryStats(state.graph,state.sources,state.ledger,state.queue);
  const context=retrieveContext(state.graph,{query:options.query,entity_id:options.entity,source_id:options.source,limit:options.limit});
  context.source_excerpts=context.sources.map(s=>({...s,text:state.sources[s.id].body.slice(0,4000)}));return context;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))run().then(r=>console.log(JSON.stringify(r,null,2))).catch(e=>{console.error(e.message);process.exitCode=1;});
