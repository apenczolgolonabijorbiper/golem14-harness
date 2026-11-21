import {performance} from 'node:perf_hooks';
import {fixture} from '../server/test-fixtures.mjs';
import {createAdapter} from '../adapters/reference-git/adapter.mjs';

// Fresh adapter per operation matches CLI cache lifetime. Fixture construction
// and synthetic analysis are outside adapter timings; no model is benchmarked.
const counts=(process.argv[2]??'5,10,20').split(',').map(Number),repeats=Number(process.argv[3]??3);
if(counts.some(n=>!Number.isInteger(n)||n<1||n>20)||!Number.isInteger(repeats)||repeats<1||repeats>20)throw Error('Expected batch sizes 1..20 and repetitions 1..20');
for(const count of counts)for(let repetition=1;repetition<=repeats;repetition++){
  const cleanups=[],f=fixture({after:fn=>cleanups.push(fn)});
  try{
    const body='Synthetic record.\n'+'x'.repeat(3480);
    for(let i=1;i<=count;i++)f.observe(i,{body});
    const invoke=async(command,options)=>{
      const start=performance.now(),adapter=createAdapter({instance:f.root,timings:true}),result=await adapter[command](options);
      return {result,wall_ms:performance.now()-start};
    };
    const status=await invoke('status'),claim=await invoke('claim',{max:count});f.analyze(claim.result);
    const validation=await invoke('validate',{run:claim.result.run_id}),commit=await invoke('commit',{run:claim.result.run_id});
    console.log(JSON.stringify({platform:process.platform,node:process.version,batch:count,repetition,source_body_bytes:Buffer.byteLength(body)*count,model_ms:null,note:'Synthetic local adapter timing; excludes cognition, tools transport and fixture setup',operations:Object.fromEntries(Object.entries({status,claim,validate:validation,commit}).map(([name,value])=>[name,{wall_ms:value.wall_ms,...value.result.timings}]))}));
  }finally{for(const clean of cleanups.reverse())clean();}
}
