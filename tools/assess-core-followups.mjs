// Reproducible, synthetic decision evidence for #29–#33. No model or private data.
// Assertions are the acceptance oracle; timings are observations, never thresholds.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {validateMemory, schemaErrors, retrieveContext, collectWarnings} from '../server/memory-model.mjs';
import {objectKey, validateVocabulary} from '../server/core-policies.mjs';
import {parseSource} from '../server/observation.mjs';
import {buildIntake} from './intake-example.mjs';
import {fixture} from '../server/test-fixtures.mjs';
import {createAdapter} from '../adapters/reference-git/adapter.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const stamp = '2026-05-06T00:00:00.000Z';
const unknown = expression => ({from:null, to:null, expression:expression ?? null, precision:'unknown'});
const exact = from => ({from, to:null, expression:null, precision:'exact'});
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const clone = structuredClone;
const sorted = xs => [...xs].sort();
const ids = result => sorted(result.claims.map(c => c.id));

function state(bodies, times = bodies.map(() => stamp)) {
  const sources = Object.fromEntries(bodies.map((body,n) => {
    const sourceId=id(n+1), path=`inbox/${sourceId}.md`;
    const text=`---\nid: ${sourceId}\nrecorded_at: ${times[n]}\n---\n${body}\n`;
    const source=parseSource(path,text);
    assert.equal(source.sha256,hash(Buffer.from(text)));
    return [sourceId,source];
  }));
  return {graph:{schema_version:2,updated_at:stamp,sources:Object.values(sources).map(({id,path,sha256,recorded_at})=>({id,path,sha256,recorded_at})),entities:[],claims:[]},sources,
    ledger:{schema_version:1,observations:Object.values(sources).map(s=>({id:s.id,source_file:s.path,source_sha256:s.sha256,status:'processed'}))},queue:{schema_version:1,questions:[]}};
}
function entity(s, name, kind='record') {
  const found=s.graph.entities.find(e=>e.id===name); if(found)return found;
  const e={id:name,type:'other',kind,label:name,aliases:[],source_ids:Object.keys(s.sources),created_at:stamp,uncertainty:[]};
  s.graph.entities.push(e); return e;
}
function claim(s, name, subject, predicate, value, {source=0,attribution='ent-reviewer',time=unknown(),classification='source_assertion',uncertainty=[]}={}) {
  const src=Object.values(s.sources)[source];
  entity(s,subject);entity(s,attribution,'reviewer');if(value?.entity_id)entity(s,value.entity_id);
  const c={id:name,subject_id:subject,attributed_to_id:attribution,predicate,object:value?.entity_id?value:{value},classification,
    sources:[{observation_id:src.id,quote:src.body.trim()}],asserted_at:src.recorded_at,valid_time:time,status:'active',supersedes:[],uncertainty,created_at:stamp};
  s.graph.claims.push(c);return c;
}
function valid(s, previous) {assert.deepEqual(validateMemory(s.graph,{...s,previous}),[]);}
function invalidObject(s, value) {
  const bad=clone(s.graph);bad.claims[0].object=value;
  const errors=schemaErrors(bad);assert.ok(errors.some(e=>e.includes('object: no allowed shape')));return errors;
}
const vocabulary={schema_version:2,single_valued:['has_state'],predicates:['has_state']};

export function assessTime(input) {
  validateVocabulary(vocabulary);
  const lines=input.revisions.map(r=>`Revision ${r.revision}; author ${r.author}; upstream ${r.upstream}; effective ${r.effective??'unknown'}; state ${r.value}.`);
  const per=state(lines,input.revisions.map(r=>r.ingested)),digest=state([lines.join('\n')]);
  for(const s of [per,digest])for(const [n,r]of input.revisions.entries()){
    const c=claim(s,'clm-'+r.revision,'ent-item','has_state',r.value,{source:s===per?n:0,attribution:'ent-'+r.author,time:r.effective?exact(r.effective):unknown(r.upstream),uncertainty:r.effective?[]:['Upstream day/zone and effective instant are unknown.']});
    c.sources[0].quote=lines[n];
  }
  // Inspect the pre-correction snapshot before making the only permitted status change.
  valid(per);valid(digest);const previous=clone(per.graph);
  previous.claims=previous.claims.filter(c=>!input.revisions.some(r=>r.corrects&&c.id==='clm-'+r.revision));
  const correctedSource=Object.values(per.sources).at(-1).id;
  previous.sources=previous.sources.filter(s=>s.id!==correctedSource);
  for(const e of previous.entities)e.source_ids=e.source_ids.filter(id=>id!==correctedSource);
  const priorState={...per,sources:Object.fromEntries(Object.entries(per.sources).filter(([id])=>id!==correctedSource)),ledger:{schema_version:1,observations:per.ledger.observations.filter(r=>r.id!==correctedSource)}};
  assert.deepEqual(validateMemory(previous,priorState),[]);
  for(const s of [per,digest])for(const r of input.revisions.filter(r=>r.corrects)){
    s.graph.claims.find(c=>c.id==='clm-'+r.corrects).status='superseded';
    s.graph.claims.find(c=>c.id==='clm-'+r.revision).supersedes=['clm-'+r.corrects];
  }
  valid(per,previous);valid(digest);
  const queries=[];
  for(const {at,value,current_value}of input.queries)for(const [representation,s]of [['revision',per],['digest',digest]]){
    const result=retrieveContext(s.graph,{entity_id:'ent-item',predicate:'has_state',valid_at:at,current:true,vocabulary});
    // current:true uses current status knowledge; all-status valid-at can still show a corrected historical assertion.
    assert.deepEqual(result.claims.map(c=>c.object.value),[current_value]);
    const history=retrieveContext(s.graph,{entity_id:'ent-item',predicate:'has_state',valid_at:at});
    assert.ok(history.claims.some(c=>c.object.value===value));
    assert.match(history.temporal.knowledge,/not a past transaction snapshot/);
    queries.push({representation,valid_at:at,current_values:result.claims.map(c=>c.object.value),all_status_values:history.claims.map(c=>c.object.value),knowledge:history.temporal.knowledge});
  }
  const current=retrieveContext(per.graph,{entity_id:'ent-item',predicate:'has_state',current:true,vocabulary,now:stamp});
  assert.deepEqual(current.claims.map(c=>c.object.value),[input.current]);
  assert.ok(current.current_selection[0].alternatives.includes(input.unknown_alternative));
  assert.equal(current.current_selection[0].unresolved,true);
  for(const [n,r]of input.revisions.entries()){
    assert.equal(per.graph.claims[n].attributed_to_id,'ent-'+r.author);
    assert.equal(per.graph.claims[n].asserted_at,r.ingested);
    assert.ok(Object.values(per.sources)[n].body.includes(r.upstream));
  }
  assert.equal(per.graph.claims[2].valid_time.from,null);
  assert.equal(per.graph.claims[2].valid_time.precision,'unknown');
  const forged=clone(per);forged.graph.claims[0].asserted_at=input.revisions[0].upstream;
  assert.ok(validateMemory(forged.graph,forged).some(e=>e.startsWith('Assertion timestamp must match a source:')));
  return {decision:'retain_existing_fields',queries,current:current.claims.map(c=>c.object.value),uncertain_alternative:input.unknown_alternative,
    per_revision_ingestion_times:per.graph.claims.map(c=>c.asserted_at),digest_ingestion_times:digest.graph.claims.map(c=>c.asserted_at),
    limitation:'Upstream dates remain quoted source data; no typed upstream-time filter or past-knowledge reconstruction. Digest intake loses per-revision ingestion identities/times.'};
}

export async function assessGroups(input) {
  const cleanups=[],f=fixture({after:fn=>cleanups.push(fn)});
  try{
    const sourceRows=Array.from({length:input.parts},(_,n)=>f.observe(n+1,{body:`Group revision one; part ${n+1} of ${input.parts}; synthetic content.`}));
    const adapter=createAdapter({instance:f.root}),before=await adapter.status();
    assert.equal(before.ready.length,input.parts);
    const head=f.git('rev-parse','HEAD');
    await assert.rejects(()=>adapter.claim({max:input.parts}),/1\.\.20/);
    assert.equal(f.git('rev-parse','HEAD'),head);
    const first=await adapter.claim({max:input.max_claim});assert.equal(first.sources.length,input.max_claim);
    f.analyze(first);await adapter.validate({run:first.run_id});await adapter.commit({run:first.run_id});
    const mid=await adapter.status();assert.equal(mid.processed,input.max_claim);assert.equal(mid.ready.length,input.parts-input.max_claim);
    const second=await adapter.claim({max:input.max_claim});assert.equal(second.sources.length,input.parts-input.max_claim);
    f.analyze(second);await adapter.commit({run:second.run_id});assert.equal((await adapter.status()).processed,input.parts);
    const rows=JSON.parse(f.read('memory/processed.json')).observations;assert.equal(new Set(rows.map(r=>r.id)).size,input.parts);
    for(const src of sourceRows)assert.equal(hash(Buffer.from(f.read(src.path))),src.sha256);
    // Ordinary semantic records do not need a core group or a whole-group transaction.
    const records=Array.from({length:input.semantic_records},(_,n)=>({namespace:'synthetic:catalog',record:'part-'+n,revision:'r1',text:'Independent record '+n}));
    const intake=buildIntake(records),again=buildIntake(records,intake.receipts);assert.equal(intake.observations.length,input.semantic_records);assert.equal(again.observations.length,0);
    // Intentionally NOT a parser, schema, or implementation of proposed group metadata.
    // Opaque original context can be read under existing host byte/item bounds.
    let bytes=0;const included=[];
    for(const src of sourceRows){const size=Buffer.byteLength(src.body);if(included.length>=input.item_budget||bytes+size>input.byte_budget)break;included.push(src.id);bytes+=size;}
    assert.ok(included.length>0&&included.length<input.parts);assert.ok(bytes<=input.byte_budget);
    assert.ok(included.length<=input.item_budget);
    const one=state(['One relevant part states a fact.']);claim(one,'clm-one','ent-one','describes','fact');valid(one);
    return {decision:'defer_core_group_metadata',all_input_present:input.parts,ready_before:before.ready.length,first_batch:first.sources.length,
      processed_after_first:mid.processed,remaining_after_first:mid.ready.length,second_batch:second.sources.length,final_processed:rows.length,
      semantic_records:intake.observations.length,repeated_intake_emitted:again.observations.length,
      context:{included:included.length,omitted:input.parts-included.length,bytes,byte_limit:input.byte_budget,item_limit:input.item_budget},
      limitation:'Input manifest/completeness belongs to the producer/host; readiness is not completion. No group scheduler, metadata validation or whole-group atomicity is added.'};
  }finally{for(const cleanup of cleanups.reverse())cleanup();}
}

export function assessHistory(input) {
  const s=state(input.map(row=>'Artifact ent-artifact: '+JSON.stringify(row)));
  for(const [n,row]of input.entries()){
    const event='ent-change-'+row.id;entity(s,event,'change');
    claim(s,'clm-'+row.id+'-target',event,'changes',{entity_id:'ent-artifact'},{source:n});
    for(const [key,value]of Object.entries(row).filter(([key])=>key!=='id'))claim(s,'clm-'+row.id+'-'+key,event,key,value,{source:n});
  }
  valid(s);
  const context=retrieveContext(s.graph,{entity_id:'ent-artifact',hops:2,limit:100,expansion_budget:100});
  assert.equal(context.truncated,false);assert.deepEqual(ids(context),sorted(s.graph.claims.map(c=>c.id)));
  const reconstructed=input.map(row=>Object.fromEntries([['id',row.id],...context.claims.filter(c=>c.subject_id==='ent-change-'+row.id&&c.predicate!=='changes').map(c=>[c.predicate,c.object.entity_id?c.object:c.object.value])]));
  assert.deepEqual(reconstructed,input);
  const bounded=retrieveContext(s.graph,{entity_id:'ent-artifact',hops:2,limit:2,expansion_budget:3});
  assert.equal(bounded.truncated,true);assert.ok(bounded.claims.length<=2);
  // Design-only comparison, not an accepted graph or a new execution path.
  const proposal=input.map((row,n)=>({id:'edge-'+row.id,subject_id:'ent-reviewer',predicate:'changes',object:{entity_id:'ent-artifact'},attributes:Object.fromEntries(Object.entries(row).filter(([key])=>key!=='id')),sources:s.graph.claims.find(c=>c.subject_id==='ent-change-'+row.id).sources}));
  const proposed=clone(s.graph);proposed.claims[0].attributes=proposal[0].attributes;
  assert.ok(schemaErrors(proposed).some(e=>e.includes('attributes: unexpected field')));
  // Example profile/host policy; deliberately outside core warnings and validation.
  const hostWarnings=input.filter(row=>row.operation==='test').map(row=>({code:'host.reported_test_only',change_id:row.id,message:'A reported test result is not independent verification of code intent.'}));
  assert.equal(hostWarnings.length,1);
  const before=clone(s.graph);s.graph.claims[0].object={entity_id:'ent-other'};entity(s,'ent-other');
  assert.ok(validateMemory(s.graph,{...s,previous:before}).some(e=>e.startsWith('Claim history mutated:')));
  s.graph=before;
  const samples=[];for(let n=0;n<7;n++){const start=performance.now();valid(s);samples.push(performance.now()-start);}samples.sort((a,b)=>a-b);
  return {decision:'retain_change_entities',operations:input.map(r=>r.operation),entities:s.graph.entities.length,claims:s.graph.claims.length,
    query:{hops:2,returned:context.claims.length,truncated:context.truncated,round_trip_fields_equal:true},
    compact_graph_bytes:Buffer.byteLength(JSON.stringify(s.graph)),design_only_edge_bytes:Buffer.byteLength(JSON.stringify(proposal)),
    canonical_validation_median_ms:Number(samples[3].toFixed(3)),
    host_warnings:hostWarnings,
    limitation:'The edge sketch omits canonical entity/history machinery and fails current schema; byte counts are illustrative, not equivalent implementation/performance claims. Source-reported tests do not prove code correctness.'};
}

export function assessValues(input) {
  const s=state([`Synthetic input: ${JSON.stringify(input)}. Effort reports ${input.units.map(unit=>input.amount+' '+unit).join(' and ')}. Revision r2 removes the assignment previously referencing ${input.assignment}. Explicit null is source text, not a supported object value.`]);
  claim(s,'clm-assignment','ent-item','assigned_to',{entity_id:input.assignment});
  for(const unit of input.units){
    const measurement='ent-measure-'+unit;entity(s,measurement,'measurement');
    claim(s,'clm-effort-'+unit,'ent-item','has_effort',{entity_id:measurement},{time:exact(stamp)});
    claim(s,'clm-amount-'+unit,measurement,'amount',input.amount);
    claim(s,'clm-unit-'+unit,measurement,'unit',unit);
  }
  for(const status of input.states)claim(s,'clm-state-'+status,'ent-item-'+status,'assignment_state',status);
  // Source-provided null/removal is represented explicitly by a profile state, not by coercing null into a scalar.
  claim(s,'clm-null-state','ent-item-null','assignment_state','explicit_null');
  entity(s,'ent-assignment-change','change');
  claim(s,'clm-change-subject','ent-assignment-change','changes',{entity_id:'ent-item'});
  claim(s,'clm-change-before','ent-assignment-change','before_value',{entity_id:input.assignment});
  claim(s,'clm-change-after','ent-assignment-change','after_state','removed');
  claim(s,'clm-change-revision','ent-assignment-change','revision','r2');
  valid(s);
  const policy={schema_version:2,predicates:['has_effort'],single_valued:['has_effort']};validateVocabulary(policy);
  const result=retrieveContext(s.graph,{entity_id:'ent-item',predicate:'has_effort',current:true,vocabulary:policy,now:stamp});
  assert.equal(result.claims.length,2);assert.equal(result.current_ties.length,1);
  assert.notEqual(objectKey(result.claims[0].object),objectKey(result.claims[1].object));
  for(const unit of input.units){const r=retrieveContext(s.graph,{entity_id:'ent-measure-'+unit,predicate:'amount,unit'});assert.deepEqual(r.claims.map(c=>c.object.value).sort(),[input.amount,unit].sort());}
  const before=clone(s.graph);s.graph.claims.find(c=>c.id==='clm-assignment').status='retracted';valid(s,before);
  assert.equal(retrieveContext(s.graph,{entity_id:'ent-item',predicate:'assigned_to',status:'active'}).claims.length,0);
  assert.equal(retrieveContext(s.graph,{entity_id:'ent-item',predicate:'assigned_to',status:'all'}).claims.length,1);
  assert.equal(retrieveContext(s.graph,{entity_id:'ent-absent',predicate:'assignment_state',status:'active'}).claims.length,0);
  const rejected=[{}, {value:null}, {value:{field:'owner',from:'a',to:'b'}}, {value:input.amount,unit:input.units[0]}, {entity_id:'ent-missing',revision:'r1'}].map(value=>({object:value,errors:invalidObject(s,value)}));
  const changed=retrieveContext(s.graph,{entity_id:'ent-assignment-change',predicate:'before_value,after_state,revision'});
  assert.equal(changed.claims.length,3);
  assert.equal(changed.claims.find(c=>c.predicate==='before_value').object.entity_id,input.assignment);
  assert.equal(changed.claims.find(c=>c.predicate==='after_state').object.value,'removed');
  const bad=clone(s);bad.graph.claims.find(c=>c.id==='clm-effort-hour').object={entity_id:'ent-missing'};
  assert.ok(validateMemory(bad.graph,bad).some(e=>e.startsWith('Claim entity not found:')));
  const badHistory=clone(s);badHistory.graph.claims.find(c=>c.id==='clm-amount-hour').object.value=9;
  assert.ok(validateMemory(badHistory.graph,{...badHistory,previous:s.graph}).some(e=>e.startsWith('Claim history mutated:')));
  return {decision:'retain_scalar_entity_values',unit_values:input.units,amounts:input.units.map(()=>input.amount),unit_bearing_tie:result.current_ties.length,
    states:['missing','removed','unknown','explicit_null'],rejected,
    limitation:'Units and explicit value states are profile conventions represented by ordinary claims/entities. No automatic conversion, unit arithmetic, structured endpoint object or first-class null is added.'};
}

export function assessIdentity(input) {
  const s=state(['Synthetic identity input: '+JSON.stringify(input)+'. Assertions: alpha same_as beta; alpha distinct_from beta; beta same_as reused. Identical labels and co-occurring identifiers do not settle identity.']);
  for(const row of input.entities){const e=entity(s,row.id);e.label='Same label';e.external_ids=[{scheme:'record',namespace:row.namespace,value:row.value}];}
  const lookup=namespace=>retrieveContext(s.graph,{external_id:'42',scheme:'record',namespace,limit:100}).entities.map(e=>e.id).sort();
  // Lookup is deliberately checked before relationship graph expansion.
  assert.deepEqual(lookup('catalog-a'),input.ambiguous_lookup);assert.deepEqual(lookup('catalog-b'),input.scoped_lookup);
  assert.equal(s.graph.claims.length,0);assert.equal(s.graph.entities.length,input.entities.length);
  claim(s,'clm-equivalence','ent-alpha','same_as',{entity_id:'ent-beta'},{classification:'hypothesis',uncertainty:['Analyst interpretation remains contested.']});
  claim(s,'clm-distinction','ent-alpha','distinct_from',{entity_id:'ent-beta'});
  claim(s,'clm-chain','ent-beta','same_as',{entity_id:'ent-reused'},{classification:'hypothesis',uncertainty:['Does not establish transitive identity.']});
  valid(s);
  const warnings=collectWarnings(s.graph).filter(w=>w.code==='duplicate_external_id');assert.equal(warnings.length,1);
  assert.ok(warnings[0].message.includes('ent-alpha')&&warnings[0].message.includes('ent-reused'));
  const context=retrieveContext(s.graph,{entity_id:'ent-alpha',predicate:'same_as,distinct_from',status:'active',hops:2,limit:10});
  assert.deepEqual(ids(context),['clm-chain','clm-distinction','clm-equivalence']);
  assert.equal(s.graph.claims.filter(c=>c.subject_id==='ent-alpha'&&c.object.entity_id==='ent-reused').length,0);
  const before=clone(s.graph),identityIds=sorted(s.graph.entities.map(e=>e.id));
  s.graph.claims.find(c=>c.id==='clm-equivalence').status='retracted';valid(s,before);
  const active=retrieveContext(s.graph,{entity_id:'ent-alpha',predicate:'same_as,distinct_from',status:'active',hops:1,limit:10});
  assert.deepEqual(ids(active),['clm-distinction']);
  const history=retrieveContext(s.graph,{claim_ids:['clm-equivalence'],status:'all'});assert.equal(history.claims[0].status,'retracted');
  assert.deepEqual(sorted(s.graph.entities.map(e=>e.id)),identityIds);
  for(const e of before.entities)assert.deepEqual(s.graph.entities.find(row=>row.id===e.id),e);
  const bounded=retrieveContext(before,{entity_id:'ent-alpha',hops:3,limit:1,expansion_budget:1});assert.equal(bounded.truncated,true);
  return {decision:'retain_explicit_relation_claims',scoped_lookup:input.scoped_lookup,ambiguous_lookup:input.ambiguous_lookup,
    warnings:warnings.map(w=>w.message),contradictory_claims:ids(context),after_retraction:ids(active),preserved_entity_ids:identityIds,
    limitation:'No equivalence closure, unique-identifier enforcement or canonical merge is implied. Contradictions remain explicit claims; the host/model must review them. Traversal is graph context, not identity inference.'};
}

export async function assessCoreFollowups() {
  const raw=readFileSync(new URL('../cognition/assessments/core-followups/input.json',import.meta.url));
  const input=JSON.parse(raw);assert.equal(input.schema_version,1);
  return {schema_version:1,baseline:input.baseline,fixture_sha256:hash(raw),runtime:{node:process.version,platform:process.platform},
    results:{'29':assessTime(input.time),'30':await assessGroups(input.groups),'31':assessHistory(input.history),'32':assessValues(input.values),'33':assessIdentity(input.identity)}};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(await assessCoreFollowups(),null,2));
