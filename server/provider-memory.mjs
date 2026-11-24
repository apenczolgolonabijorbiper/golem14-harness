// Supported public entry point for hosts. Instance authorization is fixed by the
// provider constructor; query selectors never grant access to another scope.
import {assertProvider,records,pages,get,evidenceBytes,digest,changeIdentity,fields,tokens,collections} from './memory-contract.mjs';
import {retrieveContext,collectWarnings,memoryStats} from './memory-model.mjs';
import {validateSnapshot,validateCandidate,snapshotDigest} from './provider-validation.mjs';
import {identifierQueryMatch} from './core-policies.mjs';
import {parseSource} from './observation.mjs';
const unique=xs=>[...new Map(xs.map(x=>[x.id,x])).values()];

export async function semanticWrites(provider,change){
  changeIdentity(change);const base=change.base_snapshot,meta=await provider.open({snapshot:base});
  if(meta.policy_id!==change.policy_id)throw Error('Policy changed');
  const writes=new Map(),key=(c,id)=>c+'/'+id;
  const read=async(c,id)=>writes.get(key(c,id))?.record??await get(provider,base,c,id,{optional:true});
  const put=async(collection,record,{add=false}={})=>{
    if(!record||typeof record.id!=='string')throw Error('Record ID required');
    const old=await get(provider,base,collection,record.id,{optional:true});
    if(add&&(old||writes.has(key(collection,record.id))))throw Error('Record already exists: '+key(collection,record.id));
    writes.set(key(collection,record.id),{collection,id:record.id,before_digest:old?digest(old):null,record:structuredClone(record)});
  };
  const append=async(c,r)=>put(c,r,{add:true});
  for(const op of change.operations){
    const allowed=op.op==='extend_entity'?['op','id','aliases','source_ids','external_ids']:op.op==='set_claim_status'?['op','id','status']:['op','record'];
    fields(op,allowed,'operation');
    switch(op.op){
      case 'add_entity':await append('entities',op.record);break;
      case 'extend_entity':{
        const old=await read('entities',op.id);if(!old)throw Error('Unknown entity: '+op.id);
        const row=structuredClone(old);for(const name of ['aliases','source_ids','external_ids'])if(op[name]!==undefined){if(!Array.isArray(op[name]))throw Error('Expected entity additions');row[name]=[...new Map([...(old[name]??[]),...op[name]].map(x=>[digest(x),x])).values()];}
        await put('entities',row);break;
      }
      case 'add_claim':await append('claims',op.record);break;
      case 'set_claim_status':{
        const old=await read('claims',op.id);if(!old||old.status!=='active'||!['superseded','retracted'].includes(op.status))throw Error('Only active claims may receive a terminal status');
        await put('claims',{...old,status:op.status});break;
      }
      case 'put_question':{
        const old=await read('questions',op.record?.id);
        if(old&&(old.text!==op.record.text||old.source_observation_id!==op.record.source_observation_id||old.status==='closed'&&op.record.status!=='closed'))throw Error('Question identity/history changed');
        await put('questions',op.record);break;
      }
      case 'put_hypothesis':await put('hypotheses',op.record);break;
      case 'append_event':if(!change.sources.some(s=>s.id===op.record?.observation_id))throw Error('Event must reference a reserved observation');await append('events',op.record);break;
      case 'append_journal':await append('journals',op.record);break;
      case 'append_verification':await append('verification',op.record);break;
      default:throw Error('Unknown semantic operation: '+op.op);
    }
  }
  const journal=[...writes.values()].find(w=>w.collection==='journals'&&w.id===change.run_id)?.record;
  const verification=[...writes.values()].find(w=>w.collection==='verification'&&w.id===change.attempt_id)?.record;
  if(!journal||journal.policy_id!==change.policy_id||typeof journal.review!=='string'||!journal.review.trim()||journal.verification_id!==change.attempt_id||!verification||verification.run_id!==change.run_id||typeof verification.result!=='string'||!verification.result.trim())throw Error('Cycle needs a retained journal and resolvable verification pointer');
  for(const s of change.sources){
    const observation=await get(provider,base,'observations',s.id);
    if(observation.sha256!==s.sha256)throw Error('Source changed');
    if(await read('processed',s.id))throw Error('Source already processed');
    const {id,path,sha256,recorded_at}=observation;
    await append('sources',{id,path,sha256,recorded_at});
    await append('processed',{id,source_file:path,source_sha256:sha256,status:'processed',processed_at:change.at,run:change.run_id,verification_id:change.attempt_id});
  }
  return [...writes.values()];
}

export function createMemory(provider){
  assertProvider(provider);
  return {
    provider,
    async open(snapshot){return provider.open({snapshot});},
    async read(snapshot,collection,id){return get(provider,snapshot,collection,id,{optional:true});},
    async source(snapshot,id,{offset=0,max_bytes=65536}={}){return provider.evidence({snapshot,id,offset,max_bytes});},
    async audit(snapshot,options){return validateSnapshot(provider,snapshot,options);},
    async context(snapshot,options={}){
      const meta=await provider.open({snapshot}),vocabulary=meta.policy?.vocabulary;
      const query=options.query??'',seeds=new Set([...(options.subject_ids??[]),...(options.entity_id?[options.entity_id]:[])]),foundEntities=[];
      let claims=[],global=false;
      const addEntities=async selector=>{const rows=await records(provider,snapshot,'entities',selector,'lookup');foundEntities.push(...rows);for(const e of rows)seeds.add(e.id);};
      if(options.external_id!==undefined||options.scheme!==undefined||options.namespace!==undefined){
        if(![options.external_id,options.scheme,options.namespace].every(x=>typeof x==='string'&&x.trim()))throw Error('External lookup requires value, scheme and namespace');
        await addEntities({external:{value:options.external_id,scheme:options.scheme,namespace:options.namespace}});
      }else if(query){
        await addEntities({tokens:tokens(query)});
        // Prefix identifiers are policy data; exact identifier candidates are
        // selected physically and identity remains a Harness decision.
        for(const scheme of vocabulary?.external_id_schemes??[])for(const word of query.split(/\s+/))for(const prefix of scheme.prefixes??[])if(word.startsWith(prefix)){
          for await(const e of pages(provider,snapshot,'entities',{tokens:[word.slice(prefix.length)]},'lookup'))if(identifierQueryMatch(e,query,vocabulary)){foundEntities.push(e);seeds.add(e.id);}
        }
        claims.push(...await records(provider,snapshot,'claims',{tokens:tokens(query)},'lookup'));
      }
      if(options.claim_ids!==undefined){
        if(!Array.isArray(options.claim_ids)||options.claim_ids.length>100)throw Error('Invalid exact claim IDs');
        claims.push(...await records(provider,snapshot,'claims',{ids:options.claim_ids},'lookup'));
      }
      if(options.source_id)claims.push(...await records(provider,snapshot,'claims',{refs:[options.source_id]},'lookup'));
      if(!query&&!seeds.size&&!options.source_id&&!options.claim_ids&&options.external_id===undefined){
        global=true;claims=await records(provider,snapshot,'claims',{},'query');
      }
      // Fetch exact adjacency and complete temporal/correction groups before the
      // ranking limit. Providers must not apply top-k to these physical selectors.
      let frontier=new Set(seeds),all=new Set(seeds);
      for(const c of claims)for(const id of [c.subject_id,c.object.entity_id].filter(Boolean))frontier.add(id);
      const hops=Number(options.hops??1);
      if(!Number.isInteger(hops)||hops<1||hops>3)throw Error('Invalid hops');
      for(let hop=0;hop<=hops&&frontier.size;hop++){
        const ids=[...frontier];claims.push(...await records(provider,snapshot,'claims',{refs:ids},'lookup'));claims=unique(claims);
        frontier=new Set();for(const c of claims)for(const id of [c.subject_id,c.object.entity_id].filter(Boolean))if(!all.has(id)){all.add(id);frontier.add(id);}
      }
      for(const c of unique(claims))if(vocabulary?.single_valued?.includes(c.predicate))claims.push(...await records(provider,snapshot,'claims',{group:{subject_id:c.subject_id,predicate:c.predicate}},'lookup'));
      claims=unique(claims).sort((a,b)=>a.id.localeCompare(b.id));
      const entityIds=new Set([...seeds,...claims.flatMap(c=>[c.subject_id,c.object.entity_id,c.attributed_to_id].filter(Boolean))]);
      const entities=unique([...foundEntities,...await records(provider,snapshot,'entities',{ids:[...entityIds]},'lookup')]).sort((a,b)=>a.id.localeCompare(b.id));
      const sources=await records(provider,snapshot,'sources',{ids:[...new Set([...claims.flatMap(c=>c.sources.map(s=>s.observation_id)),...(options.source_id?[options.source_id]:[])])]},'lookup');
      const graph={schema_version:2,updated_at:meta.updated_at,entities,claims,sources};
      const context=retrieveContext(graph,{...options,seed_ids:global||!query&&!seeds.size&&!options.source_id?undefined:[...seeds],now:meta.updated_at,vocabulary});
      const warnings=collectWarnings(graph,{vocabulary});
      return {...context,snapshot_id:snapshot,policy_id:meta.policy_id,warnings:warnings.slice(0,100),warning_summary:{total:warnings.length,truncated:warnings.length>100,scope:global?'snapshot':'retrieval dependency closure'},knowledge:'Zero hits do not establish absence; pending observations are not analyzed memory.'};
    },
    async stats(snapshot){
      const meta=await provider.open({snapshot});
      const [entities,claims,sources,observations,processed,questions]=await Promise.all(['entities','claims','sources','observations','processed','questions'].map(c=>records(provider,snapshot,c)));
      return memoryStats({updated_at:meta.updated_at,entities,claims,sources},Object.fromEntries(observations.map(r=>[r.id,r])),{observations:processed},{questions});
    },
    async warnings(snapshot,{limit=100}={}){
      if(!Number.isInteger(limit)||limit<1||limit>1000)throw Error('Invalid warning limit');
      const meta=await provider.open({snapshot}),[entities,claims,sources,hypotheses]=await Promise.all(['entities','claims','sources','hypotheses'].map(c=>records(provider,snapshot,c)));
      const actual={};for(const s of sources)actual[s.id]=parseSource(s.path,new TextDecoder('utf-8',{fatal:true}).decode(await evidenceBytes(provider,snapshot,s.id)));
      const warnings=collectWarnings({schema_version:2,updated_at:meta.updated_at,entities,claims,sources},{sources:actual,vocabulary:meta.policy?.vocabulary,hypotheses:{hypotheses}});
      return {warnings:warnings.slice(0,limit),total:warnings.length,truncated:warnings.length>limit};
    },
    async prepare(change){
      const change_digest=changeIdentity(change),writes=await semanticWrites(provider,change);
      const prepared=await provider.prepare({change,writes,change_digest});
      try{const errors=await validateCandidate(provider,prepared.snapshot_id,{change,writes});if(errors.length)throw Error('Candidate validation failed: '+errors.join('\n'));
        return {...prepared,change_digest,candidate_digest:await snapshotDigest(provider,prepared.snapshot_id)};
      }catch(e){await provider.abort({candidate_id:prepared.candidate_id});throw e;}
    },
    async publish(candidate){return provider.publish({candidate_id:candidate.candidate_id,change_digest:candidate.change_digest,candidate_digest:candidate.candidate_digest});},
    async abort(candidate_id){return provider.abort({candidate_id});},
    async recover(idempotency_key){return provider.recover({idempotency_key});},
  };
}

// Rebase semantic intent, never merge physical files. CAS/history validation of
// every touched record detects conflicting edits and duplicate source completion.
export async function rebaseChanges(provider,change,new_snapshot){
  const writes=await semanticWrites(provider,change),next=await provider.open({snapshot:new_snapshot});
  if(next.policy_id!==change.policy_id)throw Error('Guidance changed; re-review required');
  for(const w of writes){const now=await get(provider,new_snapshot,w.collection,w.id,{optional:true});if((now?digest(now):null)!==w.before_digest)throw Error('Merge conflict: '+w.collection+'/'+w.id);}
  return {...structuredClone(change),base_snapshot:new_snapshot};
}
