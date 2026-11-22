import {performance} from 'node:perf_hooks';

// Fixed labels only: never collect arguments, file paths, source text or stderr.
export function operationMetrics(enabled=false) {
  let started, phases, git, counts;
  const reset=()=>{started=performance.now();phases={};counts={};git={calls:0,elapsed_ms:0,commands:{}};};
  reset();
  const add=(name,ms)=>{const row=phases[name]??={calls:0,elapsed_ms:0};row.calls++;row.elapsed_ms+=ms;};
  return {
    reset,
    stage(name){if(!enabled)return ()=>{};const at=performance.now();return ()=>add(name,performance.now()-at);},
    sync(name,fn){if(!enabled)return fn();const at=performance.now();try{return fn();}finally{add(name,performance.now()-at);}},
    async async(name,fn){if(!enabled)return fn();const at=performance.now();try{return await fn();}finally{add(name,performance.now()-at);}},
    git(command,fn){if(!enabled)return fn();const at=performance.now();try{return fn();}finally{const ms=performance.now()-at;git.calls++;git.elapsed_ms+=ms;const row=git.commands[command]??={calls:0,elapsed_ms:0};row.calls++;row.elapsed_ms+=ms;}},
    count(name,value){if(enabled)counts[name]=value;},
    report(){return {elapsed_ms:performance.now()-started,phases,git,counts};}
  };
}
