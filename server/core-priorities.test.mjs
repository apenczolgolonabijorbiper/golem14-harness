import test from 'node:test';
import assert from 'node:assert/strict';
import {syntheticState} from '../tools/benchmark-capacity.mjs';
import {validateMemory,schemaErrors,collectWarnings,retrieveContext,memoryStats,graphLimits} from './memory-model.mjs';
import {validateHypotheses} from './hypotheses.mjs';
import {validateVocabulary,dependencyErrors,temporalSelection,requireCapabilities} from './core-policies.mjs';
import {fixture} from './test-fixtures.mjs';
import {run} from '../processor/memory-tool.mjs';
import {loadProfile} from './application-profile.mjs';
import {createAdapter} from '../adapters/reference-git/adapter.mjs';
const small=()=>syntheticState(1,{entities:1,claims:1});
const at='2026-01-01T00:00:00.000Z';
const hypothesis=(state)=>({schema_version:1,updated_at:at,hypotheses:[{id:'hyp-example',statement:'Synthetic proposition',status:'open',support:[state.graph.claims[0].id],refutation:[],confidence:.35,updated_at:at}]});
const vocab={schema_version:2,single_valued:['describes'],external_id_schemes:[{scheme:'record',prefixes:['REC-']}]};

test('capacity uses schema limits and has exact warning and failure boundaries',()=>{
  const f=syntheticState(graphLimits.sources,{entities:1,claims:1});assert.deepEqual(validateMemory(f.graph,f),[]);
  assert.equal(memoryStats(f.graph,f.sources,f.ledger,f.queue).capacity.sources.limit,graphLimits.sources);
  assert.ok(collectWarnings(f.graph,f).some(w=>w.code==='capacity_near_limit'&&w.object_id==='sources'));
  const n=Math.ceil(graphLimits.sources*.8);f.graph.sources=f.graph.sources.slice(0,n-1);assert.ok(!collectWarnings(f.graph,f).some(w=>w.code==='capacity_near_limit'));
  f.graph.sources.push(((s)=>({id:s.id,path:s.path,sha256:s.sha256,recorded_at:s.recorded_at}))(Object.values(f.sources)[n-1]));assert.ok(collectWarnings(f.graph,f).some(w=>w.code==='capacity_near_limit'));
  f.graph.sources=Array(graphLimits.sources+1).fill(f.graph.sources[0]);assert.ok(schemaErrors(f.graph).some(e=>e==='graph.sources: invalid item count'));
});
test('target policy vocabulary is bounded, strict and independent of JSON field order',()=>{
  validateVocabulary(vocab);
  for(const v of [{schema_version:1},{...vocab,external_id_schemes:[{}]},{...vocab,unknown:[]},{...vocab,single_valued:['bad-name']},{...vocab,external_id_schemes:[{scheme:'record'},{scheme:'record'}]},{...vocab,external_id_schemes:[{scheme:'record',prefixes:['bad prefix']}]}])assert.throws(()=>validateVocabulary(v));
});
test('scoped identifiers are exact, append-only and query aliases require declared prefixes',()=>{
  const f=small(),e=f.graph.entities[0];e.external_ids=[{scheme:'record',namespace:'https://synthetic.invalid/a',value:'1001'}];
  assert.deepEqual(validateMemory(f.graph,f),[]);
  for(const query of ['1001','REC-1001'])assert.equal(retrieveContext(f.graph,{query,vocabulary:vocab}).entities[0].id,e.id);
  assert.equal(retrieveContext(f.graph,{query:'REC-1001'}).entities.length,0);
  const exact={external_id:'1001',scheme:'record',namespace:'https://synthetic.invalid/a'};
  assert.equal(retrieveContext(f.graph,exact).claims.length,1);assert.equal(retrieveContext(f.graph,{...exact,namespace:'other'}).claims.length,0);
  assert.throws(()=>retrieveContext(f.graph,{external_id:'1001'}),/requires/);
  const previous=structuredClone(f.graph);e.external_ids.push({scheme:'record',namespace:'b',value:'1001'});assert.deepEqual(validateMemory(f.graph,{...f,previous}),[]);
  e.external_ids.shift();assert.ok(validateMemory(f.graph,{...f,previous}).some(e=>e.includes('identifier history removed')));
});
test('scoped duplicate warnings name both entities and do not equate another namespace',()=>{
  const f=small(),a=f.graph.entities[0];a.external_ids=[{scheme:'record',namespace:'a',value:'1001'}];
  const b={...a,id:'ent-another',external_ids:[{scheme:'record',namespace:'b',value:'1001'}]};f.graph.entities.push(b);
  assert.ok(!collectWarnings(f.graph).some(w=>w.code==='duplicate_external_id'));
  b.external_ids=[{value:'1001',namespace:'a',scheme:'record'}];const w=collectWarnings(f.graph).find(w=>w.code==='duplicate_external_id');assert.ok(w.message.includes(a.id)&&w.message.includes(b.id));
  a.external_ids.push({...a.external_ids[0]});assert.ok(validateMemory(f.graph,f).some(e=>/duplicate external|duplicate values/.test(e)));
});
function temporalFixture(){const f=small(),c=f.graph.claims[0];f.graph.claims=Array.from({length:150},(_,n)=>({...structuredClone(c),id:'clm-'+String(150-n).padStart(4,'0'),object:{value:n},valid_time:{from:new Date(Date.UTC(2025,0,1+n)).toISOString(),to:null,expression:null,precision:'exact'}}));return f;}
test('current selection precedes truncation and graph-hop expansion',()=>{
  const f=temporalFixture();for(const hops of [undefined,1,3]){const r=retrieveContext(f.graph,{entity_id:f.graph.entities[0].id,predicate:'describes',current:true,vocabulary:vocab,limit:1,hops});assert.equal(r.claims.length,1);assert.equal(r.claims[0].object.value,149);assert.equal(r.current_selection[0].alternatives_truncated,true);}
  assert.ok(collectWarnings(f.graph,{vocabulary:vocab}).some(w=>w.code==='multiple_active_values'));
});
test('as-of selection covers inclusive overlap, open intervals and unknown-time exclusion',()=>{
  const f=small(),c=f.graph.claims[0];c.valid_time={from:'2026-01-01T00:00:00Z',to:'2026-02-01T00:00:00Z',expression:null,precision:'exact'};
  f.graph.claims.push({...structuredClone(c),id:'clm-second',object:{value:'Other'},valid_time:{...c.valid_time,from:c.valid_time.to,to:null}},{...structuredClone(c),id:'clm-unknown',valid_time:{from:null,to:null,expression:null,precision:'unknown'}});
  const get=time=>retrieveContext(f.graph,{entity_id:c.subject_id,valid_at:time});
  assert.equal(get('2025-12-31T00:00:00Z').claims.length,0);assert.equal(get('2026-01-15T00:00:00Z').claims.length,1);assert.equal(get('2026-02-01T00:00:00Z').claims.length,2);assert.equal(get('2026-03-01T00:00:00Z').claims.length,1);assert.equal(get(at).hidden.unknown_time,1);
  assert.throws(()=>get('yesterday'),/Invalid valid-at/);
});
test('current ties and uncertain imported snapshots remain visible without overriding effective time',()=>{
  const f=small(),a=f.graph.claims[0];a.valid_time={from:at,to:null,expression:null,precision:'exact'};
  f.graph.claims.push({...structuredClone(a),id:'clm-tie',object:{value:'Conflict'}},{...structuredClone(a),id:'clm-uncertain',asserted_at:'2026-05-01T00:00:00Z',object:{value:'Old imported snapshot'},valid_time:{from:null,to:null,expression:null,precision:'unknown'}});
  const r=retrieveContext(f.graph,{entity_id:a.subject_id,current:true,vocabulary:vocab});assert.equal(r.claims.length,2);assert.equal(r.current_ties.length,1);assert.ok(r.current_selection[0].alternatives.includes('clm-uncertain'));assert.equal(r.current_selection[0].basis,'valid_time.from');
  assert.throws(()=>retrieveContext(f.graph,{current:true}),/requires/);assert.throws(()=>retrieveContext(f.graph,{current:'yes',vocabulary:vocab}),/Invalid current/);
});
test('supersession clears active-value conflicts; equal active values are not contradictions',()=>{
  const f=small(),a=f.graph.claims[0],b={...structuredClone(a),id:'clm-replacement',object:{value:'Corrected'},supersedes:[a.id]};a.status='superseded';f.graph.claims.push(b);assert.deepEqual(validateMemory(f.graph,f),[]);assert.ok(!collectWarnings(f.graph,{vocabulary:vocab}).some(w=>w.code==='multiple_active_values'));
  a.status='active';a.object=b.object;assert.ok(!collectWarnings(f.graph,{vocabulary:vocab}).some(w=>w.code==='multiple_active_values'));
});
test('hypotheses require a version, bounded confidence and existing support/refutation/source IDs',()=>{
  const f=small(),h=hypothesis(f);assert.deepEqual(validateHypotheses(h,f.graph),[]);
  for(const mutate of [x=>delete x.schema_version,x=>x.schema_version=9,x=>x.hypotheses[0].confidence=7,x=>x.hypotheses[0].support=['clm-missing'],x=>x.hypotheses[0].refutation=['clm-missing'],x=>x.hypotheses[0].observation_ids=['00000000-0000-4000-8000-999999999999']]){const bad=structuredClone(h);mutate(bad);assert.ok(validateHypotheses(bad,f.graph).length);}
});
test('claim dependencies reject missing/self/cyclic links and retained mutation',()=>{
  const f=small(),a=f.graph.claims[0],b={...structuredClone(a),id:'clm-derived',classification:'hypothesis',uncertainty:['Synthetic inference'],depends_on:[a.id]};f.graph.claims.push(b);assert.deepEqual(validateMemory(f.graph,f),[]);
  const previous=structuredClone(f.graph);b.depends_on=[];assert.ok(validateMemory(f.graph,{...f,previous}).some(e=>e.includes('Claim history mutated')));b.depends_on=[b.id];assert.ok(validateMemory(f.graph,f).some(e=>e.includes('Invalid claim dependency')));b.depends_on=[a.id];a.depends_on=[b.id];assert.ok(validateMemory(f.graph,f).some(e=>e.includes('dependency cycle')));a.depends_on=['clm-missing'];assert.ok(validateMemory(f.graph,f).some(e=>e.includes('clm-missing')));
});
test('changed support and refutation flag dependents without altering status/confidence',()=>{
  const f=small(),a=f.graph.claims[0],h=hypothesis(f);h.hypotheses[0].refutation=[a.id];f.graph.claims.push({...structuredClone(a),id:'clm-derived',depends_on:[a.id]});assert.ok(!collectWarnings(f.graph,{hypotheses:h}).some(w=>w.code==='dependency_changed'));
  a.status='retracted';const warnings=collectWarnings(f.graph,{hypotheses:h}).filter(w=>w.code==='dependency_changed');assert.equal(warnings.length,2);assert.ok(warnings.every(w=>w.message.includes(a.id)));assert.equal(h.hypotheses[0].confidence,.35);assert.equal(f.graph.claims[1].status,'active');
});
test('deep shared dependency chains are stack safe and do not expand paths',()=>{
  const rows=Array.from({length:20000},(_,n)=>({id:'clm-'+n,depends_on:n?['clm-'+(n-1)]:[]}));assert.deepEqual(dependencyErrors(rows),[]);rows[0].depends_on=[rows.at(-1).id];assert.ok(dependencyErrors(rows).some(e=>e.includes('cycle')));
});
test('CLI validates hypotheses strictly and refuses malformed candidate without publication',async t=>{
  const f=fixture(t);f.write('memory/hypotheses.json','not JSON {');await assert.rejects(()=>run(['validate','--root',f.root]),/Hypotheses file invalid: memory\/hypotheses.json/);
  f.write('memory/hypotheses.json',{schema_version:1,updated_at:at,hypotheses:[]});f.save();f.observe();const adapter=createAdapter({instance:f.root}),claim=await adapter.claim();f.analyze(claim);const head=f.git('rev-parse','HEAD'),ledger=f.read('memory/processed.json');f.write('memory/hypotheses.json',{updated_at:at,hypotheses:[]});await assert.rejects(()=>adapter.commit({run:claim.run_id}),/validation/i);assert.equal(f.read('memory/processed.json'),ledger);assert.equal(f.git('show','HEAD:memory/graph.json'),f.git('show',head+':memory/graph.json'));
});
test('policy selection is snapshot-versioned and committed policy changes require a new claim',async t=>{
  const f=fixture(t,{profile:true});f.write('profiles/vocab.json',vocab);f.write('golem.config.json',{schema_version:1,profile:{path:'profiles/default.md',vocabulary:'profiles/vocab.json'}});f.save();f.observe();const a=createAdapter({instance:f.root}),c=await a.claim();assert.ok(c.guidance_version.vocabulary_sha256);const original=f.read(c.guidance_path);
  f.write('profiles/vocab.json',{...vocab,single_valued:[]});f.save();f.analyze(c);await assert.rejects(()=>a.commit({run:c.run_id}),/Claimed profile changed/);assert.equal(f.read(c.guidance_path),original);assert.equal((await a.status()).lease.run_id,c.run_id);
  f.write('profiles/vocab.json',{schema_version:1});await assert.rejects(()=>loadProfile(f.root),/vocabulary version/);
});

test('policy-aware scaffold rejects missing capabilities before backend claim',async()=>{
  const {createAdapter}=await import('../adapters/template/adapter.mjs');let claimed=false;
  const a=createAdapter({status:()=>({capabilities:['candidate-validation-v1']}),claim:()=>{claimed=true;}});
  await assert.rejects(()=>a.claim({required_capabilities:['core-policies-v2']}),/missing required capability/);assert.equal(claimed,false);
  assert.throws(()=>requireCapabilities({capabilities:'core-policies-v2 candidate-validation-v1'}),/invalid capability list/);
});

test('capacity failure does not publish a graph or processed ledger',async t=>{
  const f=fixture(t);f.observe();const a=createAdapter({instance:f.root}),c=await a.claim();f.analyze(c);const prior=f.git('show','HEAD:memory/graph.json'),ledger=f.read('memory/processed.json'),g=JSON.parse(f.read('memory/graph.json'));g.sources=Array(graphLimits.sources+1).fill(g.sources[0]);f.write('memory/graph.json',g);
  await assert.rejects(()=>a.commit({run:c.run_id}),/invalid item count/);assert.equal(f.git('show','HEAD:memory/graph.json'),prior);assert.equal(f.read('memory/processed.json'),ledger);assert.equal((await a.status()).lease.status,'error');
});

test('CLI wires scoped lookup and policy-driven temporal retrieval to persisted data',async t=>{
  const f=fixture(t,{profile:true});f.write('profiles/vocab.json',vocab);f.write('golem.config.json',{schema_version:1,profile:{path:'profiles/default.md',vocabulary:'profiles/vocab.json'}});f.save();f.observe();const a=createAdapter({instance:f.root}),c=await a.claim();f.analyze(c);const g=JSON.parse(f.read('memory/graph.json'));g.entities[0].external_ids=[{scheme:'record',namespace:'https://synthetic.invalid/catalog',value:'1001'}];g.claims[0].valid_time={from:at,to:null,expression:null,precision:'exact'};f.write('memory/graph.json',g);await a.commit({run:c.run_id});
  const result=await run(['context','--root',f.root,'--external-id','1001','--scheme','record','--namespace','https://synthetic.invalid/catalog','--current','true','--valid-at','2026-02-01T00:00:00Z']);assert.equal(result.claims.length,1);assert.equal(result.current_selection[0].basis,'valid_time.from');assert.ok(result.entities[0].external_ids);assert.ok(result.source_excerpts[0].text);
});

test('bad profile version refuses acquisition without changing HEAD or lease',async t=>{
  const f=fixture(t,{profile:true});f.write('profiles/vocab.json',{schema_version:1});f.write('golem.config.json',{schema_version:1,profile:{path:'profiles/default.md',vocabulary:'profiles/vocab.json'}});f.save();f.observe();const head=f.git('rev-parse','HEAD');await assert.rejects(()=>createAdapter({instance:f.root}).claim(),/vocabulary version/);assert.equal(f.git('rev-parse','HEAD'),head);assert.equal(JSON.parse(f.read('memory/processing-lock.json')).status,'idle');
});
