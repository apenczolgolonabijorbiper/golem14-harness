// Copy this scaffold OUTSIDE the installed engine. Implement physical operations
// in the host, then use the documented public Harness API and conformance suite.
import {assertProvider} from '../../server/memory-contract.mjs';
export function createProvider(backend){
  const provider={};
  for(const name of ['describe','open','read','scan','counts','evidence','prepare','publish','abort','recover'])provider[name]=(...args)=>{
    if(typeof backend?.[name]!=='function')throw Error('Memory provider operation not implemented: '+name);
    return backend[name](...args);
  };
  return assertProvider(provider);
}
// publish is a trusted host boundary: acquire the write lock/transaction; recover
// prior receipts; recheck base/source/policy/lease and semantic intent; run public
// validateCandidate + snapshotDigest on the exact candidate; atomically persist
// candidate, source completion, lease release and durable receipt. Fail closed.
