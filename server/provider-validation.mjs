// Harness-owned audit over paged records and point reads. No whole-store object.
import graphSchema from '../schemas/memory-graph.schema.json' with {type:'json'};
import hypothesisSchema from '../schemas/hypotheses.schema.json' with {type:'json'};
import {schemaErrors,graphLimits} from './memory-model.mjs';
import {externalKey,dependencyErrors} from './core-policies.mjs';
import {pages,get,evidenceBytes,digest,bytesDigest,collections} from './memory-contract.mjs';
import {parseSource} from './observation.mjs';
const same=(a,b)=>digest(a)===digest(b);
export async function validateSnapshot(provider,snapshot,{previous}={}){
  const errors=[],fail=s=>errors.push(s),meta=await provider.open({snapshot});
  const dateErrors=schemaErrors({schema_version:2,updated_at:meta.updated_at,sources:[],entities:[],claims:[]});errors.push(...dateErrors);
  if(meta.logical_version!==2)fail('Unsupported logical memory version');
  const counts={},dependencies=[],corrections=[];
  const read=(c,id)=>get(provider,snapshot,c,id,{optional:true});
  const source=async id=>{
    const s=await read('observations',id);if(!s)return null;
    try{const raw=await evidenceBytes(provider,snapshot,id),actual=parseSource(s.path,new TextDecoder('utf-8',{fatal:true}).decode(raw));
      const {body,...descriptor}=actual;if(!same(descriptor,s))fail('Observation bytes/identity mismatch: '+id);
      return actual;
    }catch(e){fail(e.message);return null;}
  };
  for(const collection of collections){
    counts[collection]=0;const seen=new Set();
    for await(const row of pages(provider,snapshot,collection)){
      counts[collection]++;
      if(typeof row.id!=='string'||seen.has(row.id)){fail(collection+': duplicate/invalid ID');continue;}seen.add(row.id);
      if(['sources','entities','claims'].includes(collection)){
        const singular={sources:'source',entities:'entity',claims:'claim'}[collection];
        const issues=schemaErrors(row,{$defs:graphSchema.$defs,$ref:'#/$defs/'+singular});
        if(issues.length){errors.push(...issues.map(s=>collection+'/'+row.id+': '+s));continue;}
      }
      if(collection==='observations'){
        const actual=await source(row.id);if(!actual)continue;
        if(actual.question_id&&!await read('questions',actual.question_id))fail('Unknown source question: '+row.id);
      }
      if(collection==='processed'){
        const actual=await read('observations',row.id);
        if(row.status!=='processed'||!actual||row.source_file!==actual.path||row.source_sha256!==actual.sha256)fail('Ledger source mismatch: '+row.id);
        if(!await read('sources',row.id))fail('Processed source missing from memory: '+row.id);
      }
      if(collection==='sources'){
        const actual=await read('observations',row.id);
        if(!actual||actual.path!==row.path||actual.sha256!==row.sha256||actual.recorded_at!==row.recorded_at)fail('Graph source mismatch: '+row.id);
        if(!await read('processed',row.id))fail('Graph source is not processed: '+row.id);
      }
      if(collection==='entities'){
        if(await read('claims',row.id))fail('Entity/claim ID collision: '+row.id);
        const keys=new Set();for(const id of row.external_ids??[]){const key=externalKey(id);if(keys.has(key)||id.namespace.trim()!==id.namespace||id.value.trim()!==id.value)fail('Invalid/duplicate external identifier: '+row.id);keys.add(key);}
        for(const id of row.source_ids)if(!await read('sources',id))fail('Entity source missing: '+row.id);
        if(Date.parse(row.created_at)>Date.parse(meta.updated_at))fail('Entity created after graph update: '+row.id);
      }
      if(collection==='claims'){
        const refs=[];
        for(const [field,id]of [['subject_id',row.subject_id],['attributed_to_id',row.attributed_to_id],['object.entity_id',row.object.entity_id]])if(id!==undefined){const e=await read('entities',id);if(e)refs.push(e);else fail(`Claim entity not found: ${row.id} (${field} ${id})`);}
        for(const ref of row.sources){const actual=await source(ref.observation_id);
          if(!await read('sources',ref.observation_id)||!actual?.body.includes(ref.quote))fail('Claim source/quote mismatch: '+row.id);
          for(const entity of refs)if(!entity.source_ids.includes(ref.observation_id))fail('Entity provenance does not include claim source: '+row.id);
        }
        if(row.classification==='hypothesis'&&!row.uncertainty.length)fail('Hypothesis requires uncertainty: '+row.id);
        const time=row.valid_time;
        if(time.from&&time.to&&Date.parse(time.from)>Date.parse(time.to))fail('Invalid time range: '+row.id);
        if(time.precision==='unknown'&&(time.from||time.to))fail('Unknown time cannot assert bounds: '+row.id);
        if(time.precision==='exact'&&!time.from)fail('Exact time needs a bound: '+row.id);
        if(Date.parse(row.created_at)>Date.parse(meta.updated_at))fail('Claim created after update: '+row.id);
        let assertion=false;for(const r of row.sources)if((await read('observations',r.observation_id))?.recorded_at===row.asserted_at)assertion=true;
        if(!assertion)fail('Assertion timestamp must match a source: '+row.id);
        for(const id of row.supersedes){const old=await read('claims',id);if(!old||id===row.id||old.subject_id!==row.subject_id||old.predicate!==row.predicate||!['superseded','retracted'].includes(old.status))fail('Invalid correction: '+row.id);}
        if(row.status==='superseded'){
          let replacement=false;for await(const c of pages(provider,snapshot,'claims',{refs:[row.id]},'validation'))if(c.supersedes.includes(row.id))replacement=true;
          if(!replacement)fail('Missing replacement claim: '+row.id);
        }
        // Global topology checks retain IDs/edges only, never entire claim records.
        dependencies.push({id:row.id,depends_on:row.depends_on??[]});corrections.push({id:row.id,depends_on:row.supersedes});
      }
      if(collection==='questions'){
        if(!/^[a-zA-Z0-9_-]{1,80}$/.test(row.id)||!['open','closed'].includes(row.status)||typeof row.text!=='string'||!row.text.trim()||row.text.length>2000)fail('Invalid/duplicate question');
        if(!await read('observations',row.source_observation_id))fail('Question source missing: '+row.id);
        for(const id of row.analysis?.source_observation_ids??[])if(!await read('observations',id))fail('Question analysis source missing: '+row.id);
        if(row.status==='closed'&&(!row.analysis?.source_observation_ids?.length||row.analysis.status!=='answered'))fail('Closed question needs an analyzed answer: '+row.id);
      }
      if(collection==='events'){
        if(typeof row.observation_id!=='string'||!await read('observations',row.observation_id)||!await read('questions',row.question_id)||typeof row.answer!=='string'||!row.answer.trim()||row.answer.length>64000||!Number.isFinite(Date.parse(row.answered_at)))fail('Invalid event provenance: '+row.id);
      }
      if(collection==='journals'){
        if(typeof row.review!=='string'||!row.review.trim()||!row.policy_id||!await read('verification',row.verification_id))fail('Journal verification pointer missing: '+row.id);
      }
      if(collection==='verification'){
        const journal=await read('journals',row.run_id);
        if(!journal||journal.verification_id!==row.id||typeof row.result!=='string'||!row.result.trim())fail('Invalid durable verification record: '+row.id);
      }
      if(collection==='receipts'){
        const verification=await read('verification',row.verification_id);
        if(row.provider_version!==1||!verification||verification.run_id!==row.run_id||typeof row.change_digest!=='string'||!/^[0-9a-f]{64}$/.test(row.change_digest)||typeof row.candidate_digest!=='string'||!/^[0-9a-f]{64}$/.test(row.candidate_digest))fail('Invalid durable receipt: '+row.id);
      }
      if(collection==='hypotheses'){
        const issues=schemaErrors(row,hypothesisSchema.properties.hypotheses.items);
        if(issues.length){errors.push(...issues);continue;}
        if(Date.parse(row.updated_at)>Date.parse(meta.updated_at))fail('Hypothesis updated after collection '+row.id);
        for(const id of [...row.support,...row.refutation])if(!await read('claims',id))fail('Hypothesis claim not found: '+row.id+' -> '+id);
        for(const id of row.observation_ids??[])if(!await read('sources',id))fail('Hypothesis source not found: '+row.id+' -> '+id);
        if(row.status==='supported'&&!row.support.length||row.status==='refuted'&&!row.refutation.length)fail('Hypothesis status needs evidence: '+row.id);
      }
    }
    if(graphLimits[collection]&&counts[collection]>graphLimits[collection])fail('Memory capacity exceeded: '+collection);
    if(collection==='hypotheses'&&counts[collection]>5000)fail('Hypothesis capacity exceeded');
  }
  errors.push(...dependencyErrors(dependencies),...dependencyErrors(corrections).map(s=>s.replace('Claim dependency cycle:','Correction cycle:')));
  if(previous){
    const oldMeta=await provider.open({snapshot:previous});
    if(Date.parse(meta.updated_at)<Date.parse(oldMeta.updated_at))fail('Graph update timestamp went backwards');
    for(const collection of collections)for await(const old of pages(provider,previous,collection)){
      const now=await read(collection,old.id);if(!now){fail('Retained history removed: '+collection+'/'+old.id);continue;}
      if(collection==='entities'){
        if(now.type!==old.type||old.kind!==undefined&&now.kind!==old.kind||now.created_at!==old.created_at||old.source_ids.some(id=>!now.source_ids.includes(id))||(old.external_ids??[]).some(id=>!now.external_ids?.some(x=>externalKey(x)===externalKey(id))))fail('Entity identity/history removed: '+old.id);
      }else if(collection==='claims'){
        if(!same({...old,status:now.status},now))fail('Claim history mutated: '+old.id);
        if(old.status!=='active'&&now.status!==old.status)fail('Claim status history reversed: '+old.id);
      }else if(collection==='questions'){
        if(old.text!==now.text||old.source_observation_id!==now.source_observation_id||old.created_at!==now.created_at||old.status==='closed'&&now.status!=='closed')fail('Question identity/history changed: '+old.id);
      }else if(collection!=='hypotheses'&&!same(old,now))fail('Retained history changed: '+collection+'/'+old.id);
    }
  }
  return [...new Set(errors)];
}
// Hashes all canonical logical state and exact source bytes. Used for candidate seals
// and portable transfers, never for ordinary record/context lookup.
export async function snapshotDigest(provider,snapshot){
  const meta=await provider.open({snapshot}),parts=[digest({logical_version:meta.logical_version,updated_at:meta.updated_at,policy_id:meta.policy_id,policy:meta.policy})];
  for(const collection of collections){const rows=[];for await(const row of pages(provider,snapshot,collection))rows.push([row.id,digest(row)]);rows.sort((a,b)=>a[0].localeCompare(b[0]));parts.push([collection,rows]);}
  for await(const row of pages(provider,snapshot,'observations'))parts.push(['evidence',row.id,bytesDigest(await evidenceBytes(provider,snapshot,row.id))]);
  return digest(parts);
}

// Verifies that the overlay is EXACTLY the semantic write set, including absence
// of unrelated, otherwise-valid changes. Public host publication must call this
// in addition to checking its physical source/policy/lease/freshness fences.
export async function validateCandidate(provider,snapshot,{change,writes}){
  const errors=await validateSnapshot(provider,snapshot,{previous:change.base_snapshot});
  const meta=await provider.open({snapshot}),base=await provider.open({snapshot:change.base_snapshot});
  if(meta.instance_id!==base.instance_id||meta.policy_id!==change.policy_id||digest(meta.policy)!==digest(base.policy)||meta.updated_at!==change.at)errors.push('Candidate metadata differs from semantic intent');
  const byKey=new Map(writes.map(w=>[w.collection+'/'+w.id,w]));
  for(const collection of collections)for await(const row of pages(provider,snapshot,collection)){
    const write=byKey.get(collection+'/'+row.id),old=await get(provider,change.base_snapshot,collection,row.id,{optional:true});
    if(write){if((old?digest(old):null)!==write.before_digest||digest(row)!==digest(write.record))errors.push('Candidate writes mismatch: '+collection+'/'+row.id);}
    else if(!old||digest(row)!==digest(old))errors.push('Candidate has an unrequested change: '+collection+'/'+row.id);
  }
  for(const w of writes){const row=await get(provider,snapshot,w.collection,w.id,{optional:true});if(!row||digest(row)!==digest(w.record))errors.push('Candidate write missing: '+w.collection+'/'+w.id);}
  return [...new Set(errors)];
}
