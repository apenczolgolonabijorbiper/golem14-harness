// Independent contract test provider/minimal host. No filesystem, graph object,
// JSON adapter, Git object, checkout, or production database dependency.
import {randomUUID} from 'node:crypto';
import {memoryContract,collections,matches,checkPage,digest,changeIdentity} from '../../../server/memory-contract.mjs';
import {semanticWrites} from '../../../server/provider-memory.mjs';
import {validateSnapshot,validateCandidate,snapshotDigest} from '../../../server/provider-validation.mjs';
const clone=structuredClone;
export function recordHost(initial,{backing={snapshots:new Map(),receipts:new Map()},strict=true}={}){
  let latest=initial?.meta.snapshot_id;
  if(initial)backing.snapshots.set(latest,clone(initial));
  if(!latest)latest=backing.latest;
  const candidates=new Map(),cursors=new Map(),calls=[];
  let lease=null,clock=Date.now(),fault=null,sourceVersions=new Map(),policyVersion=null;
  const at=id=>{const s=backing.snapshots.get(id)??candidates.get(id)?.state;if(!s)throw Error('Snapshot expired');return s;};
  const provider={
    describe:()=>({...memoryContract,implementation:'independent-record-test'}),
    async open({snapshot}={}){return clone(at(snapshot??latest).meta);},
    async counts({snapshot}){const s=at(snapshot);return Object.fromEntries(collections.map(c=>[c,s.rows[c].length]));},
    async read({snapshot,collection,id}){calls.push({op:'read',collection,id});const record=at(snapshot).rows[collection]?.find(r=>r.id===id);return record?{status:'found',record:clone(record)}:{status:'unknown'};},
    async scan({snapshot,collection,selector={},purpose='audit',limit=100,cursor=null}){
      checkPage({limit,cursor});calls.push({op:'scan',collection,selector:clone(selector),purpose});
      if(strict&&purpose==='lookup'&&!Object.keys(selector).length)throw Error('Whole-store loading forbidden on ordinary lookup');
      const signature=digest({snapshot,collection,selector,purpose}),old=cursor?cursors.get(cursor):null;
      if(cursor&&(!old||old.signature!==signature))throw Error('Cursor binding mismatch');
      const rows=at(snapshot).rows[collection].filter(r=>matches(r,selector)).sort((a,b)=>a.id.localeCompare(b.id)),offset=old?.offset??0;
      const items=clone(rows.slice(offset,offset+limit));let next_cursor=null;
      if(offset+items.length<rows.length){next_cursor=randomUUID();cursors.set(next_cursor,{signature,offset:offset+items.length});}
      return {items,next_cursor};
    },
    async evidence({snapshot,id,offset=0,max_bytes=65536}){
      if(!Number.isSafeInteger(offset)||offset<0||!Number.isInteger(max_bytes)||max_bytes<1||max_bytes>65536)throw Error('Invalid evidence range');
      const s=at(snapshot),raw=s.evidence.get(id);if(!raw)return {status:s.rows.observations.some(s=>s.id===id)?'unavailable':'unknown'};
      if(offset>raw.length)throw Error('Invalid evidence offset');return {status:'found',base64:Buffer.from(raw).subarray(offset,offset+max_bytes).toString('base64'),total_bytes:raw.length};
    },
    async prepare({change,writes,change_digest}){
      if(changeIdentity(change)!==change_digest||digest(writes)!==digest(await semanticWrites(provider,change)))throw Error('Semantic writes mismatch');
      const receipt=backing.receipts.get(change.idempotency_key);if(receipt){if(receipt.change_digest!==change_digest)throw Error('Idempotency key conflict');throw Error('Already published; recover receipt');}
      const duplicate=[...candidates].find(([,c])=>c.change.idempotency_key===change.idempotency_key);
      if(duplicate){if(duplicate[1].change_digest!==change_digest)throw Error('Idempotency key conflict');return {candidate_id:duplicate[0],snapshot_id:duplicate[0]};}
      const state=clone(at(change.base_snapshot)),id='candidate:'+randomUUID();state.meta.snapshot_id=id;state.meta.updated_at=change.at;
      for(const w of writes){const rows=state.rows[w.collection],index=rows.findIndex(r=>r.id===w.id);if(index<0)rows.push(clone(w.record));else rows[index]=clone(w.record);}
      candidates.set(id,{state,change:clone(change),change_digest,writes:clone(writes)});return {candidate_id:id,snapshot_id:id};
    },
    async publish({candidate_id,change_digest,candidate_digest}){
      const d=candidates.get(candidate_id);if(!d)throw Error('Candidate expired');
      const c=d.change,receipt=backing.receipts.get(c.idempotency_key);if(receipt){if(receipt.change_digest!==change_digest)throw Error('Idempotency conflict');return clone(receipt);}
      // The minimal host serializes publication and swaps the complete state and
      // receipt as one durable model transition. Faults bracket that transition.
      if(c.base_snapshot!==latest)throw Error('Base snapshot changed');
      if(c.policy_id!==(policyVersion??at(latest).meta.policy_id))throw Error('Policy changed');
      if(!lease||lease.id!==c.lease_id||lease.run_id!==c.run_id||lease.expires_at<=clock)throw Error('Unowned or expired lease');
      if(digest(c.sources)!==digest(lease.sources)||c.sources.some(s=>(sourceVersions.get(s.id)??at(latest).rows.observations.find(r=>r.id===s.id)?.sha256)!==s.sha256))throw Error('Source reservation changed');
      if(digest(c)!==change_digest||d.change_digest!==change_digest||digest(d.writes)!==digest(await semanticWrites(provider,c)))throw Error('Candidate intent changed');
      const errors=await validateCandidate(provider,candidate_id,{change:c,writes:d.writes});if(errors.length)throw Error('Invalid candidate: '+errors.join('\n'));
      if(await snapshotDigest(provider,candidate_id)!==candidate_digest)throw Error('Candidate changed after validation');
      if(fault==='before'){fault=null;throw Error('Interrupted before publication');}
      const next='record:'+randomUUID(),result={id:c.idempotency_key,provider_version:1,run_id:c.run_id,attempt_id:c.attempt_id,base_snapshot:c.base_snapshot,policy_id:c.policy_id,change_digest,candidate_digest,published_at:new Date(clock).toISOString(),verification_id:c.attempt_id};
      const state=clone(d.state);state.meta.snapshot_id=next;state.rows.receipts.push(result);
      backing.snapshots.set(next,state);backing.receipts.set(c.idempotency_key,result);latest=next;backing.latest=next;lease=null;
      if(fault==='after'){fault=null;throw Error('Response lost after publication');}
      return {...clone(result),snapshot_id:next};
    },
    async abort({candidate_id}){candidates.delete(candidate_id);return {status:'aborted'};},
    async recover({idempotency_key}){return clone(backing.receipts.get(idempotency_key)??null);},
  };
  const host={provider,backing,calls,
    reserve(change){lease={id:change.lease_id,run_id:change.run_id,sources:clone(change.sources),expires_at:clock+900000};},
    expire(){clock+=900001;},changePolicy(){policyVersion='changed-policy';},changeSource(id){sourceVersions.set(id,'changed-source');},
    advance({editEntity=false}={}){const s=clone(at(latest));if(editEntity)s.rows.entities[0].label+=' concurrent edit';s.meta.snapshot_id='record:'+randomUUID();backing.snapshots.set(s.meta.snapshot_id,s);latest=s.meta.snapshot_id;backing.latest=latest;},
    interrupt(point){fault=point;},mutateCandidate(id){at(id).rows.entities[0].label+=' changed';},
    state:()=>clone(at(latest)),latest:()=>latest,
    loseEvidence(id){at(latest).evidence.delete(id);},expireSnapshot(id){backing.snapshots.delete(id);},
  };
  return host;
}

// Host-owned isolated receiver for conformance/migration fixtures. Production
// hosts choose their own durable stage/publish mechanism and retain alias maps.
export function recordReceiver(){
  const staged=new Map(),seen=new Map();let published=null,aborted=false;
  return {
    async begin(){},
    async snapshot({origin_snapshot,meta}){staged.set(origin_snapshot,{meta:{...clone(meta),snapshot_id:'import:'+randomUUID()},rows:Object.fromEntries(collections.map(c=>[c,[]])),evidence:new Map()});},
    async record({origin_snapshot,collection,record}){const s=staged.get(origin_snapshot),key=origin_snapshot+'/'+collection+'/'+record.id;if(seen.has(key))throw Error('Duplicate imported record');seen.set(key,true);s.rows[collection].push(clone(record));},
    async evidence({origin_snapshot,id,base64}){const s=staged.get(origin_snapshot);s.evidence.set(id,Buffer.concat([s.evidence.get(id)??Buffer.alloc(0),Buffer.from(base64,'base64')]));},
    async seal(origin){const s=staged.get(origin),host=recordHost(s);return {provider:host.provider,snapshot_id:s.meta.snapshot_id};},
    async publish(){published=new Map(staged);return {snapshot_aliases:Object.fromEntries([...staged].map(([old,s])=>[old,s.meta.snapshot_id]))};},
    async abort(){aborted=true;staged.clear();},
    result:()=>published,wasAborted:()=>aborted,
  };
}
