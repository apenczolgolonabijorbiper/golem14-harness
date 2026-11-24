// Standalone reference host launcher. Physical selection lives here; the public
// memory API receives a provider handle and never interprets these CLI paths.
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createAdapter} from '../adapters/reference-git/adapter.mjs';
import {createMemory,rebaseChanges} from '../server/provider-memory.mjs';
import {exportMemory} from '../server/memory-transfer.mjs';
export async function run(args=process.argv.slice(2)){
  const command=args.shift(),options={};
  if(!['claim','open','context','stats','warnings','audit','apply','recover','rebase','export'].includes(command))throw Error('Expected claim|open|context|stats|warnings|audit|apply|recover|rebase|export');
  for(let i=0;i<args.length;i+=2){const key=args[i]?.slice(2);if(!args[i]?.startsWith('--')||!['instance','instance-id','snapshot','request','key','snapshots'].includes(key)||args[i+1]===undefined||Object.hasOwn(options,key))throw Error('Unknown/duplicate/incomplete option');options[key]=args[i+1];}
  if(!options.instance||!options['instance-id'])throw Error('Explicit --instance and --instance-id required');
  const adapter=createAdapter({instance:resolve(options.instance)});
  if(command==='claim'){
    const claim=await adapter.claim({required_capabilities:['memory-provider-v1']});
    const memory=createMemory(await adapter.openMemory({instance_id:options['instance-id']}));return {...claim,memory:await memory.open()};
  }
  const provider=await adapter.openMemory({instance_id:options['instance-id']}),memory=createMemory(provider),meta=await memory.open(options.snapshot);
  const request=options.request?JSON.parse(await readFile(resolve(options.request),'utf8')):undefined;
  if(command==='open')return meta;
  if(command==='context')return memory.context(meta.snapshot_id,request??{});
  if(command==='stats')return memory.stats(meta.snapshot_id);
  if(command==='warnings')return memory.warnings(meta.snapshot_id,request);
  if(command==='audit')return {snapshot_id:meta.snapshot_id,errors:await memory.audit(meta.snapshot_id,request)};
  if(command==='recover'){if(!options.key)throw Error('--key required');return memory.recover(options.key);}
  if(command==='rebase'){if(!request?.change||!request.new_snapshot)throw Error('Request needs change and new_snapshot');return rebaseChanges(provider,request.change,request.new_snapshot);}
  if(command==='apply'){if(!request)throw Error('--request required');return memory.publish(await memory.prepare(request));}
  const snapshots=options.snapshots?.split(',')??[meta.snapshot_id];
  for await(const entry of exportMemory(provider,snapshots))process.stdout.write(JSON.stringify(entry)+'\n');
  return undefined;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))run().then(r=>{if(r!==undefined)console.log(JSON.stringify(r,null,2));if(r?.errors?.length)process.exitCode=1;}).catch(e=>{console.error(e.message);process.exitCode=1;});
