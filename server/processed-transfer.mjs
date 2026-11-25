// Selective, immutable logical bundles. Hosts own authorization and atomic commit.
import {collections,records,evidenceBytes,digest,bytesDigest,fields} from './memory-contract.mjs';
import bundleSchema from '../schemas/processed-transfer.schema.json' with {type:'json'};
import {schemaErrors} from './memory-model.mjs';
import {validateSnapshot} from './provider-validation.mjs';
const portable=collections.filter(c=>c!=='artifacts');
const copy=v=>structuredClone(v);
const sorted=rows=>rows.sort((a,b)=>a.id.localeCompare(b.id));
export function transferView(states){
  const state=snapshot=>{const s=states.get(snapshot);if(!s)throw Error('Transfer snapshot unavailable');return s;};
  return {
    async open({snapshot}={}){return copy(state(snapshot).meta);},
    async read({snapshot,collection,id}){const r=state(snapshot).rows[collection].find(r=>r.id===id);return r?{status:'found',record:copy(r)}:{status:'unknown'};},
    async scan({snapshot,collection,selector={},limit=100,cursor=null}){
      // Private audit view; cursors never escape a validation call.
      const rows=state(snapshot).rows[collection].filter(r=>!selector.ids||selector.ids.includes(r.id)).filter(r=>!selector.refs||selector.refs.some(id=>(r.supersedes??[]).includes(id)));
      const offset=cursor===null?0:Number(cursor),items=copy(sorted([...rows]).slice(offset,offset+limit));
      return {items,next_cursor:offset+items.length<rows.length?String(offset+items.length):null};
    },
    async evidence({snapshot,id,offset=0,max_bytes=65536}){const raw=state(snapshot).evidence.get(id);return raw?{status:'found',base64:raw.subarray(offset,offset+max_bytes).toString('base64'),total_bytes:raw.length}:{status:'unavailable'};},
  };
}
async function capture(provider,snapshot){
  const meta=await provider.open({snapshot}),rows={};
  for(const c of collections)rows[c]=await records(provider,snapshot,c,{},'export');
  const evidence=new Map();for(const r of rows.observations)evidence.set(r.id,await evidenceBytes(provider,snapshot,r.id));
  return {meta,rows,evidence};
}
// Fixed point over semantic and provenance references. Selecting a source also
// selects its assertions; entity provenance and correction chains may expand it.
function closure(state,selection){
  const maps=Object.fromEntries(collections.map(c=>[c,new Map(state.rows[c].map(r=>[r.id,r]))]));
  const keep=Object.fromEntries(collections.map(c=>[c,new Set()]));let changed;
  function add(c,id){if(!maps[c].has(id))throw Error('Missing transfer dependency: '+c+'/'+id);if(!keep[c].has(id)){keep[c].add(id);changed=true;}}
  for(const id of selection)add('observations',id);
  do{
    changed=false;
    for(const id of keep.observations){add('sources',id);add('processed',id);const q=maps.observations.get(id).question_id;if(q)add('questions',q);}
    for(const r of state.rows.entities)if(r.source_ids.some(id=>keep.observations.has(id)))add('entities',r.id);
    for(const r of state.rows.claims)if(r.sources.some(s=>keep.observations.has(s.observation_id))||r.supersedes.some(id=>keep.claims.has(id)))add('claims',r.id);
    for(const id of keep.entities)for(const source of maps.entities.get(id).source_ids)add('observations',source);
    for(const id of keep.claims){const r=maps.claims.get(id);
      for(const entity of [r.subject_id,r.attributed_to_id,r.object.entity_id].filter(Boolean))add('entities',entity);
      for(const s of r.sources)add('observations',s.observation_id);
      for(const claim of [...r.supersedes,...(r.depends_on??[])])add('claims',claim);
    }
    for(const r of state.rows.questions)if(keep.observations.has(r.source_observation_id)||(r.analysis?.source_observation_ids??[]).some(id=>keep.observations.has(id)))add('questions',r.id);
    for(const id of keep.questions){const r=maps.questions.get(id);for(const source of [r.source_observation_id,...(r.analysis?.source_observation_ids??[])])add('observations',source);}
    for(const r of state.rows.events)if(keep.observations.has(r.observation_id)||keep.questions.has(r.question_id)){add('events',r.id);add('observations',r.observation_id);add('questions',r.question_id);}
    for(const r of state.rows.hypotheses)if([...r.support,...r.refutation].some(id=>keep.claims.has(id))||(r.observation_ids??[]).some(id=>keep.observations.has(id))){
      add('hypotheses',r.id);for(const id of [...r.support,...r.refutation])add('claims',id);for(const id of r.observation_ids??[])add('observations',id);
    }
  }while(changed);
  // Historic file journals can contain opaque pointers. Conservatively retain
  // all provenance and opaque artifacts from this pinned snapshot, rather than
  // guess their dependencies or rewrite source completion rows.
  for(const c of ['journals','verification','receipts','artifacts'])for(const r of state.rows[c])add(c,r.id);
  return Object.fromEntries(collections.map(c=>[c,sorted(state.rows[c].filter(r=>keep[c].has(r.id)))]));
}
function selectionIds(ids){if(!Array.isArray(ids)||!ids.length||ids.length>10000||ids.some(id=>typeof id!=='string'||!id)||new Set(ids).size!==ids.length)throw Error('Explicit unique observation IDs required');return [...ids].sort();}
export async function exportProcessed(provider,snapshot,observation_ids){
  const selected=selectionIds(observation_ids),state=await capture(provider,snapshot);
  const errors=await validateSnapshot(transferView(new Map([[snapshot,state]])),snapshot);if(errors.length)throw Error('Invalid transfer source: '+errors.join('\n'));
  const rows=closure(state,selected),evidence=Object.fromEntries(rows.observations.map(r=>[r.id,state.evidence.get(r.id).toString('base64')]));
  const value={format:'golem-processed-observations',version:1,logical_version:2,origin:copy(state.meta),selected,rows,evidence};
  const bundle={...value,sha256:digest(value)};await inspectProcessed(bundle);return bundle;
}
export async function inspectProcessed(bundle){
  fields(bundle,['format','version','logical_version','origin','selected','rows','evidence','sha256'],'processed transfer bundle');
  const {sha256,...value}=bundle;
  if(bundle.format!=='golem-processed-observations'||bundle.version!==1||bundle.logical_version!==2)throw Error('Unsupported processed transfer version');
  const shape=schemaErrors(bundle,bundleSchema);if(shape.length)throw Error('Invalid transfer bundle: '+shape.join('\n'));
  if(digest(value)!==sha256)throw Error('Processed transfer checksum mismatch');
  const selected=selectionIds(bundle.selected);if(digest(selected)!==digest(bundle.selected))throw Error('Noncanonical transfer selection');
  fields(bundle.rows,collections,'transfer collections');
  const state={meta:copy(bundle.origin),rows:copy(bundle.rows),evidence:new Map()};
  if(state.meta.logical_version!==2||typeof state.meta.snapshot_id!=='string'||!state.meta.snapshot_id)throw Error('Invalid transfer origin');
  for(const c of collections){const rows=state.rows[c];if(!Array.isArray(rows)||rows.some(r=>typeof r?.id!=='string')||new Set(rows.map(r=>r.id)).size!==rows.length||digest(rows)!==digest(sorted([...rows])))throw Error('Invalid/duplicate transfer records: '+c);}
  const artifactLocators=new Set();
  for(const r of state.rows.artifacts){
    if(typeof r.origin_locator!=='string'||!r.origin_locator||typeof r.base64!=='string'||Buffer.from(r.base64,'base64').toString('base64')!==r.base64)throw Error('Invalid transfer artifact: '+r.id);
    const locator=r.origin_locator.normalize('NFC').toLowerCase();if(artifactLocators.has(locator))throw Error('Duplicate transfer artifact locator: '+r.origin_locator);artifactLocators.add(locator);
  }
  const ids=state.rows.observations.map(r=>r.id);
  fields(bundle.evidence,ids,'transfer evidence');
  for(const r of state.rows.observations){const b64=bundle.evidence[r.id];if(typeof b64!=='string'||Buffer.from(b64,'base64').toString('base64')!==b64)throw Error('Missing/noncanonical transfer bytes: '+r.id);const raw=Buffer.from(b64,'base64');if(bytesDigest(raw)!==r.sha256)throw Error('Changed transfer bytes: '+r.id);state.evidence.set(r.id,raw);}
  const closed=closure(state,selected);if(digest(closed)!==digest(state.rows))throw Error('Transfer has unrelated semantic records');
  const errors=await validateSnapshot(transferView(new Map([[state.meta.snapshot_id,state]])),state.meta.snapshot_id);if(errors.length)throw Error('Invalid processed transfer: '+errors.join('\n'));
  // Every copied ledger pointer must resolve in the original artifact inventory
  // or in the typed provenance inventory retained in this bundle.
  const locators=new Set();
  function retainedArtifacts(artifacts,depth=0){
    if(depth>32)throw Error('Transfer provenance nesting exceeds 32');
    for(const r of artifacts){
      locators.add(r.origin_locator);
      if(/^memory\/transfers\/[^/]+\/transfer\.json$/.test(r.origin_locator)){
        const receipt=JSON.parse(Buffer.from(r.base64,'base64').toString('utf8'));
        if(receipt.format!=='golem-processed-transfer-receipt')throw Error('Invalid retained transfer provenance');
        const {sha256,...value}=receipt.bundle;
        const shape=schemaErrors(bundle,bundleSchema);if(shape.length)throw Error('Invalid transfer bundle: '+shape.join('\n'));
  if(digest(value)!==sha256)throw Error('Retained transfer checksum mismatch');
        retainedArtifacts(receipt.bundle.rows.artifacts,depth+1);
      }
    }
  }
  retainedArtifacts(state.rows.artifacts);
  for(const r of state.rows.processed){
    if(r.run&&!state.rows.journals.some(j=>j.id===r.run)&&!locators.has(r.run))throw Error('Missing transfer journal: '+r.id+' -> '+r.run);
    for(const path of r.outputs??[])if(!locators.has(path)&&!['memory/graph.json','memory/processed.json','memory/hypotheses.json','memory/index.md','questions/queue.json','questions/queue.md','memory/provider-state.json'].includes(path))throw Error('Missing transfer output: '+r.id+' -> '+path);
  }
  return state;
}
export function transferReceiptPath(id){
  if(typeof id!=='string'||!id.trim()||id.length>1000)throw Error('Explicit transfer id required');
  return 'memory/transfers/'+digest(id)+'/transfer.json';
}
export const transferArtifactId=id=>'artifact-'+digest(transferReceiptPath(id));
// A host calls this inside its destination transaction, then validates the exact
// materialized candidate again before its own durable commit/CAS.
export async function combineProcessed(provider,base_snapshot,bundle,{id,at}={}){
  bundle=copy(bundle);
  if(typeof id!=='string'||!id.trim()||id.length>1000||typeof at!=='string'||!/^\d{4}-\d\d-\d\dT.*Z$/.test(at)||!Number.isFinite(Date.parse(at)))throw Error('Explicit transfer id and UTC at required');
  const incoming=await inspectProcessed(bundle),base=await capture(provider,base_snapshot);
  if(digest(base.meta.policy)!==digest(incoming.meta.policy))throw Error('Incompatible destination guidance; no policy is replaced');
  if(Date.parse(at)<Math.max(Date.parse(base.meta.updated_at),Date.parse(incoming.meta.updated_at)))throw Error('Transfer time precedes retained history');
  const state=copy(base);state.evidence=new Map([...base.evidence].map(([id,raw])=>[id,Buffer.from(raw)]));state.meta.snapshot_id='transfer:'+digest([base_snapshot,id,bundle.sha256]);state.meta.updated_at=at;
  for(const c of portable)for(const r of incoming.rows[c]){
    if(base.rows[c].some(old=>old.id===r.id))throw Error((['observations','sources','processed'].includes(c)?'Duplicate source ID: ':'Transfer ID collision: '+c+'/')+r.id);
    if(c==='entities'&&base.rows.claims.some(x=>x.id===r.id)||c==='claims'&&base.rows.entities.some(x=>x.id===r.id))throw Error('Entity/claim ID collision: '+r.id);
    state.rows[c].push(copy(r));
  }
  for(const [source,raw]of incoming.evidence)state.evidence.set(source,Buffer.from(raw));
  const receipt={format:'golem-processed-transfer-receipt',version:1,id,base_snapshot,bundle_sha256:bundle.sha256,at,origin:bundle.origin.snapshot_id,selected:bundle.selected,included:incoming.rows.observations.map(r=>r.id),bundle};
  const artifact={id:transferArtifactId(id),origin_locator:transferReceiptPath(id),base64:Buffer.from(JSON.stringify(receipt,null,2)+'\n').toString('base64')};
  if(base.rows.artifacts.some(r=>r.id===artifact.id||r.origin_locator===artifact.origin_locator))throw Error('Transfer identity already published; recover receipt');
  state.rows.artifacts.push(artifact);for(const c of collections)sorted(state.rows[c]);
  const view=transferView(new Map([[base_snapshot,base],[state.meta.snapshot_id,state]]));
  const errors=await validateSnapshot(view,state.meta.snapshot_id,{previous:base_snapshot});if(errors.length)throw Error('Invalid combined transfer candidate: '+errors.join('\n'));
  return {state,receipt};
}
