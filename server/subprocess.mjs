import {spawnSync} from 'node:child_process';

// No shell; bounded, non-interactive children. Trace is opt-in because arguments
// and stderr may contain private data in a real instance.
export function boundedSpawn(executable,args,options={}) {
  const {timeout=60000,...rest}=options;
  const env={...process.env,...rest.env,GIT_TERMINAL_PROMPT:'0',GCM_INTERACTIVE:'Never'};
  if(env.GOLEM_TRACE_COMMANDS==='1')process.stderr.write('[golem child] '+JSON.stringify([executable,...args])+'\n');
  const result=spawnSync(executable,args,{...rest,env,timeout,stdio:[rest.input===undefined?'ignore':'pipe','pipe','pipe']});
  if(result.error) {
    const detail=String(result.stderr??'').slice(0,2000);
    throw Error('Child '+(result.error.code==='ETIMEDOUT'?'timed out after '+timeout+'ms':'failed')+': '+JSON.stringify([executable,...args])+' ('+result.error.code+')'+(detail?'\n'+detail:''));
  }
  return result;
}
