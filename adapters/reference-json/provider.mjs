// Reference JSON materialization boundary. Only this adapter translates logical
// records to the existing instance layout. Durability is supplied by the host.
import {combineProcessed,transferReceiptPath,inspectProcessed,transferView} from '../../server/processed-transfer.mjs';
import {randomUUID} from 'node:crypto';
import {memoryContract,collections,matches,checkPage,digest,changeIdentity} from '../../server/memory-contract.mjs';
import {semanticWrites} from '../../server/provider-memory.mjs';
import {validateSnapshot,validateCandidate,snapshotDigest} from '../../server/provider-validation.mjs';
import {parseSource} from '../../server/observation.mjs';
import {loadGuidance,guidanceIdentity} from '../../server/guidance.mjs';
import {schemaErrors,validateMemory} from '../../server/memory-model.mjs';
import {validateHypotheses} from '../../server/hypotheses.mjs';
import {instancePath,utf8} from '../../server/application-profile.mjs';
const sidecar='memory/provider-state.json';
const physical={sources:['memory/graph.json','sources'],entities:['memory/graph.json','entities'],claims:['memory/graph.json','claims'],processed:['memory/processed.json','observations'],questions:['questions/queue.json','questions'],hypotheses:['memory/hypotheses.json','hypotheses']};
const json=v=>Buffer.from(JSON.stringify(v,null,2)+'\n');
const aux=['events','journals','verification','receipts'];
export async function decodeJsonSnapshot({snapshot_id,files,instance_id}){
  const read=async path=>{if(!files.has(path))throw Object.assign(Error('Missing JSON instance file: '+path),{code:'ENOENT'});return files.get(path);};
  const parse=async path=>JSON.parse(utf8(await read(path)));
  const graph=await parse('memory/graph.json'),ledger=await parse('memory/processed.json'),queue=await parse('questions/queue.json'),hypotheses=await parse('memory/hypotheses.json');
  if(schemaErrors(graph).length||ledger.schema_version!==1||queue.schema_version!==1||hypotheses.schema_version!==1)throw Error('Unsupported/invalid JSON memory format');
  const lease=files.has('memory/processing-lock.json')?await parse('memory/processing-lock.json'):null;
  const savedState=files.has(sidecar)?await parse(sidecar):null;
  const kinds=lease?.status==='processing'?[...new Set((lease.sources??[]).map(s=>s.kind).filter(Boolean))]:(savedState?.policy_kinds??[]);
  const policy=await loadGuidance(null,{read,kinds}),rows=Object.fromEntries(collections.map(c=>[c,[]])),evidence=new Map();
  for(const [c,[path,key]]of Object.entries(physical))rows[c]=structuredClone((await parse(path))[key]);
  for(const [path,raw]of files)if(/^inbox\/[^/]+\.md$/.test(path)){
    const s=parseSource(path,utf8(raw)),{body,...descriptor}=s;rows.observations.push(descriptor);evidence.set(s.id,Buffer.from(raw));
  }
  if(files.has(sidecar)){
    const saved=await parse(sidecar);if(saved.provider_version!==1)throw Error('Unsupported JSON provider format');
    for(const c of aux)rows[c]=saved[c]??[];
  }
  // Everything not represented by typed records is retained as an opaque
  // artifact, including source metadata, guidance text, old journals and events.
  const typed=new Set([...Object.values(physical).map(([p])=>p),sidecar,'memory/processing-lock.json','memory/index.md','questions/queue.md']);
  for(const [path,bytes]of files)if(!typed.has(path)&&!/^inbox\/[^/]+\.md$/.test(path))rows.artifacts.push({id:'artifact-'+digest(path),origin_locator:path,base64:Buffer.from(bytes).toString('base64')});
  return {policy_kinds:kinds,meta:{instance_id,snapshot_id,logical_version:2,updated_at:graph.updated_at,policy_kinds:kinds,policy_id:guidanceIdentity(policy.guidance_version),policy},rows,evidence,files:new Map(files),lease};
}
export function encodeJsonSnapshot(state){
  const files=new Map(state.files),at=state.meta.updated_at;
  files.set('memory/graph.json',json({schema_version:2,updated_at:at,...Object.fromEntries(['sources','entities','claims'].map(c=>[c,state.rows[c]]))}));
  files.set('memory/processed.json',json({schema_version:1,updated_at:at,observations:state.rows.processed}));
  files.set('questions/queue.json',json({schema_version:1,updated_at:at,questions:state.rows.questions}));
  files.set('memory/hypotheses.json',json({schema_version:1,updated_at:at,hypotheses:state.rows.hypotheses}));
  files.set(sidecar,json({provider_version:1,policy_kinds:state.policy_kinds,...Object.fromEntries(aux.map(c=>[c,state.rows[c]]))}));
  // Rendered summaries are derivative, never canonical transactional records.
  files.set('questions/queue.md',Buffer.from('# Questions\n\n'+state.rows.questions.map(q=>`${q.id} [${q.status}] ${q.text}\n`).join('\n')));
  files.set('memory/index.md',Buffer.from(`# Memory\n\n${state.rows.entities.length} entities; ${state.rows.claims.length} retained claims.\n`));
  return files;
}

// store.load(snapshot?) -> {snapshot_id, files}; store.transaction(fn) serializes
// the entire callback. tx.publish(files, label) atomically publishes files and
// receipt, or leaves the old head intact. The Git implementation also recovers
// local reconciliation after a response loss. These are trusted host callbacks.
export function createJsonProvider({instance_id,store,now=()=>Date.now()}){
  if(typeof instance_id!=='string'||!instance_id.trim()||!store?.load||!store?.transaction)throw Error('Explicit instance and transactional JSON store required');
  const snapshots=new Map(),drafts=new Map(),cursors=new Map();
  async function load(snapshot){
    if(snapshot&&snapshots.has(snapshot))return snapshots.get(snapshot);
    if(snapshot?.startsWith('draft:'))throw Error('Snapshot expired');
    const physical=await store.load(snapshot);if(snapshot&&physical.snapshot_id!==snapshot)throw Error('Snapshot unavailable');const state=await decodeJsonSnapshot({...physical,instance_id});snapshots.set(physical.snapshot_id,state);return state;
  }
  const api={
    describe:()=>({...memoryContract,physical_format:'json-v2',implementation:'reference-json'}),
    async open({snapshot}={}){return structuredClone((await load(snapshot)).meta);},
    async counts({snapshot}){if(!snapshot)throw Error('Snapshot required');const s=await load(snapshot);return Object.fromEntries(collections.map(c=>[c,s.rows[c].length]));},
    async read({snapshot,collection,id}){
      if(!snapshot)throw Error('Snapshot required');
      const s=await load(snapshot);if(!collections.includes(collection))throw Error('Unknown collection');
      const record=s.rows[collection].find(r=>r.id===id);return record?{status:'found',record:structuredClone(record)}:{status:'unknown'};
    },
    async scan({snapshot,collection,selector={},purpose='audit',limit=100,cursor=null}){
      checkPage({limit,cursor});if(!snapshot)throw Error('Snapshot required');const s=await load(snapshot);if(!collections.includes(collection))throw Error('Unknown collection');
      const bound=digest({snapshot,collection,selector,purpose}),prior=cursor?cursors.get(cursor):null;
      if(cursor&&(!prior||prior.bound!==bound))throw Error('Cursor scope expired or mismatched');
      const rows=s.rows[collection].filter(r=>matches(r,selector)).sort((a,b)=>a.id.localeCompare(b.id)),offset=prior?.offset??0;
      const items=structuredClone(rows.slice(offset,offset+limit));let next_cursor=null;
      if(offset+items.length<rows.length){next_cursor=randomUUID();cursors.set(next_cursor,{bound,offset:offset+items.length});}
      return {items,next_cursor};
    },
    async evidence({snapshot,id,offset=0,max_bytes=65536}){
      if(!snapshot)throw Error('Snapshot required');
      if(!Number.isSafeInteger(offset)||offset<0||!Number.isInteger(max_bytes)||max_bytes<1||max_bytes>65536)throw Error('Invalid evidence range');
      const s=await load(snapshot),raw=s.evidence.get(id);if(!raw)return {status:s.rows.observations.some(r=>r.id===id)?'unavailable':'unknown'};
      if(offset>raw.length)throw Error('Evidence offset outside source');return {status:'found',base64:raw.subarray(offset,offset+max_bytes).toString('base64'),total_bytes:raw.length};
    },
    async prepare({change,writes,change_digest}){
      if(changeIdentity(change)!==change_digest||digest(await semanticWrites(api,change))!==digest(writes))throw Error('Untrusted candidate writes');
      const receipt=await api.recover({idempotency_key:change.idempotency_key});if(receipt){if(receipt.change_digest!==change_digest)throw Error('Idempotency key conflict');throw Error('Already published; recover the durable receipt');}
      for(const d of drafts.values())if(d.change.idempotency_key===change.idempotency_key){if(d.change_digest!==change_digest)throw Error('Idempotency key conflict');return {candidate_id:d.id,snapshot_id:d.state.meta.snapshot_id};}
      const base=await load(change.base_snapshot),state=structuredClone(base),id=randomUUID();
      state.files=new Map(base.files);state.evidence=new Map(base.evidence);state.meta.snapshot_id='draft:'+id;state.meta.updated_at=change.at;
      for(const w of writes){const list=state.rows[w.collection],at=list.findIndex(r=>r.id===w.id);if(at<0)list.push(structuredClone(w.record));else list[at]=structuredClone(w.record);}
      const d={id,state,change:structuredClone(change),writes:structuredClone(writes),change_digest};drafts.set(id,d);snapshots.set(state.meta.snapshot_id,state);
      return {candidate_id:id,snapshot_id:state.meta.snapshot_id};
    },
    async publish({candidate_id,change_digest,candidate_digest}){
      const d=drafts.get(candidate_id);if(!d)throw Error('Candidate expired; recover by idempotency key');
      return store.transaction(async tx=>{
        const currentPhysical=await tx.load(),current=await decodeJsonSnapshot({...currentPhysical,instance_id});
        const prior=current.rows.receipts.find(r=>r.id===d.change.idempotency_key);
        if(prior){if(prior.change_digest!==change_digest)throw Error('Idempotency key conflict');return structuredClone(prior);}
        const c=d.change,lease=current.lease;
        if(change_digest!==d.change_digest||digest(c)!==d.change_digest)throw Error('Change-set digest changed');
        if(current.meta.snapshot_id!==c.base_snapshot)throw Error('Base snapshot changed');
        if(current.meta.policy_id!==c.policy_id)throw Error('Policy changed');
        if(lease?.status!=='processing'||lease.run_id!==c.run_id||lease.run_id!==c.lease_id||Date.parse(lease.expires_at)<=now())throw Error('Unowned or expired write lease');
        if(digest(c.sources.map(s=>({id:s.id,sha256:s.sha256})))!==digest((lease.sources??[]).map(s=>({id:s.id,sha256:s.sha256}))))throw Error('Source reservation mismatch');
        // Host independently checks current physical bytes and policy under its
        // publication lock, including changes outside the committed snapshot.
        await tx.checkBindings?.(c,current);
        if(digest(await semanticWrites(api,c))!==digest(d.writes))throw Error('Candidate semantic intent changed');
        const errors=await validateCandidate(api,d.state.meta.snapshot_id,{change:c,writes:d.writes});if(errors.length)throw Error('Final candidate invalid: '+errors.join('\n'));
        const actual=await snapshotDigest(api,d.state.meta.snapshot_id);if(actual!==candidate_digest)throw Error('Candidate changed after validation');
        const receipt={id:c.idempotency_key,provider_version:1,run_id:c.run_id,attempt_id:c.attempt_id,base_snapshot:c.base_snapshot,policy_id:c.policy_id,change_digest,candidate_digest,published_at:new Date(now()).toISOString(),verification_id:c.attempt_id};
        const final=structuredClone(d.state);final.files=new Map(d.state.files);final.rows.receipts.push(receipt);
        const files=encodeJsonSnapshot(final);
        files.set('memory/processing-lock.json',json({schema_version:1,status:'idle',observation_ids:[],last_run_id:c.run_id,completed_at:c.at}));
        // Independent legacy semantic oracle for the JSON adapter, sharing the
        // established validators rather than duplicating backend interpretations.
        const graph=JSON.parse(utf8(files.get('memory/graph.json'))),sources={};for(const [id,raw]of final.evidence)sources[id]=parseSource(final.rows.observations.find(s=>s.id===id).path,utf8(raw));
        const issues=[...validateMemory(graph,{sources,ledger:{schema_version:1,observations:final.rows.processed},queue:{schema_version:1,questions:final.rows.questions},previous:JSON.parse(utf8(current.files.get('memory/graph.json')))}),...validateHypotheses({schema_version:1,updated_at:c.at,hypotheses:final.rows.hypotheses},graph)];
        if(issues.length)throw Error('JSON validation failed: '+issues.join('\n'));
        const snapshot_id=await tx.publish(files,'semantic-complete '+c.run_id);return {...receipt,snapshot_id};
      });
    },
    async importProcessed({bundle,base_snapshot,id,at}){
      bundle=structuredClone(bundle);
      transferReceiptPath(id);
      await inspectProcessed(bundle);
      // This operation owns the destination transaction; it never borrows a
      // cognition lease, replaces policy, or publishes a partially staged import.
      return store.transaction(async tx=>{
        if(typeof tx.checkTransfer!=='function')throw Error('Host has no selective-transfer publication binding');
        const physical=await tx.load(),current=await decodeJsonSnapshot({...physical,instance_id});
        const path=transferReceiptPath(id),existing=current.files.get(path);
        if(existing){const {bundle:saved,...receipt}=JSON.parse(utf8(existing));if(saved.sha256!==bundle.sha256)throw Error('Transfer identity conflict');return receipt;}
        if(current.meta.snapshot_id!==base_snapshot)throw Error('Base snapshot changed');
        if(current.lease?.status==='processing')throw Error('Destination processing lease must be released before transfer');
        await tx.checkTransfer({base_snapshot,policy_id:current.meta.policy_id});
        const {state,receipt}=await combineProcessed(api,base_snapshot,bundle,{id,at});
        state.files=new Map(current.files);
        for(const row of bundle.rows.observations){instancePath(row.path);if(state.files.has(row.path))throw Error('Observation path collision: '+row.id);state.files.set(row.path,Buffer.from(bundle.evidence[row.id],'base64'));}
        state.files.set(path,json(receipt));
        const files=encodeJsonSnapshot(state),roundtrip=await decodeJsonSnapshot({files,instance_id,snapshot_id:state.meta.snapshot_id});
        const view=transferView(new Map([[base_snapshot,current],[roundtrip.meta.snapshot_id,roundtrip]]));
        const errors=await validateSnapshot(view,roundtrip.meta.snapshot_id,{previous:base_snapshot});
        if(errors.length)throw Error('Materialized transfer invalid: '+errors.join('\n'));
        // Ensure materialization did not silently drop/alter a requested record.
        for(const c of collections)if(digest([...roundtrip.rows[c]].sort((a,b)=>a.id.localeCompare(b.id)))!==digest([...state.rows[c]].sort((a,b)=>a.id.localeCompare(b.id))))throw Error('Transfer materialization mismatch: '+c);
        const snapshot_id=await tx.publish(files,'processed-transfer '+id);
        const {bundle:retained,...summary}=receipt;return {...summary,snapshot_id};
      });
    },
    async recoverTransfer({id}){
      const physical=await store.load(),raw=physical.files.get(transferReceiptPath(id));
      if(!raw)return null;const {bundle,...summary}=JSON.parse(utf8(raw));return summary;
    },
    async abort({candidate_id}){const d=drafts.get(candidate_id);if(d)snapshots.delete(d.state.meta.snapshot_id);drafts.delete(candidate_id);return {status:'aborted'};},
    async recover({idempotency_key}){const current=await decodeJsonSnapshot({...await store.load(),instance_id});return structuredClone(current.rows.receipts.find(r=>r.id===idempotency_key)??null);},
  };
  return api;
}

// Explicit, isolated import fixture/reference receiver. The host must supply an
// atomic archive sink; this never selects a live provider or performs a cutover.
export function createJsonTransferReceiver({publish,abort=async()=>{}}={}){
  if(typeof publish!=='function')throw Error('Host-owned atomic transfer sink required');
  const staged=new Map(),seen=new Set();let committed=false;
  return {
    async begin(){},
    async snapshot({origin_snapshot,meta}){
      staged.set(origin_snapshot,{meta:{...structuredClone(meta),snapshot_id:'json-import:'+randomUUID()},policy_kinds:meta.policy_kinds??[],rows:Object.fromEntries(collections.map(c=>[c,[]])),evidence:new Map(),files:new Map()});
    },
    async record({origin_snapshot,collection,record}){
      const key=digest([origin_snapshot,collection,record.id]);if(seen.has(key))throw Error('Duplicate imported record');seen.add(key);
      const state=staged.get(origin_snapshot);state.rows[collection].push(structuredClone(record));
      if(collection==='artifacts'){
        instancePath(record.origin_locator);if(state.files.has(record.origin_locator))throw Error('Duplicate artifact locator');
        state.files.set(record.origin_locator,Buffer.from(record.base64,'base64'));
      }
    },
    async evidence({origin_snapshot,id,base64}){const s=staged.get(origin_snapshot);s.evidence.set(id,Buffer.concat([s.evidence.get(id)??Buffer.alloc(0),Buffer.from(base64,'base64')]));},
    async seal(origin_snapshot){
      const s=staged.get(origin_snapshot);
      for(const row of s.rows.observations){instancePath(row.path);if(!s.evidence.has(row.id))throw Error('Imported source bytes missing');s.files.set(row.path,s.evidence.get(row.id));}
      s.files=encodeJsonSnapshot(s);
      const store={load:async()=>({snapshot_id:s.meta.snapshot_id,files:s.files}),transaction:async()=>{throw Error('Import stage is read-only');}};
      return {provider:createJsonProvider({instance_id:s.meta.instance_id,store}),snapshot_id:s.meta.snapshot_id};
    },
    async publish(summary){
      const result=await publish({snapshots:new Map([...staged].map(([origin,s])=>[origin,{snapshot_id:s.meta.snapshot_id,files:new Map(s.files)}])),...summary});committed=true;return result;
    },
    async abort(){if(!committed){staged.clear();await abort();}},
  };
}
