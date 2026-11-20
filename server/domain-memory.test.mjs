import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,symlinkSync} from 'node:fs';
import {join} from 'node:path';
import {fixture,command,harness,python} from './test-fixtures.mjs';
import {loadProfile,sha256} from './application-profile.mjs';
import {schemaErrors,validateMemory,retrieveContext,collectWarnings,warningCodes} from './memory-model.mjs';

function chain(){
  const entities=Array.from({length:5},(_,i)=>({id:'ent-'+i,type:'other',kind:i===2?'file':'record',label:'Node '+i,aliases:[],source_ids:[],created_at:'2026-01-01T00:00:00Z',uncertainty:[]}));
  const claims=Array.from({length:4},(_,i)=>({id:'clm-'+i,subject_id:'ent-'+i,attributed_to_id:'ent-0',predicate:'links',object:{entity_id:'ent-'+(i+1)},classification:'source_assertion',sources:[],status:'active',supersedes:[],uncertainty:[],asserted_at:'2026-01-01T00:00:00Z',created_at:'2026-01-01T00:00:00Z',valid_time:{from:null,to:null,expression:null,precision:'unknown'}}));
  return {schema_version:2,updated_at:'2026-01-01T00:00:00Z',sources:[],entities,claims};
}
test('profile is explicitly selected, supports sudo Markdown, and hashes exact bytes',async t=>{
  const f=fixture(t);f.write('profiles/default.md','Do not activate automatically.');assert.equal(await loadProfile(f.root),null);
  f.write('profiles/profile.sudo.md','Observe(evidence)\n');f.write('golem.config.json',{schema_version:1,profile:{path:'profiles/profile.sudo.md'}});
  const a=await loadProfile(f.root);assert.equal(a.guidance_version.profile_sha256,sha256('Observe(evidence)\n'));
  f.write('profiles/profile.sudo.md','Observe(evidence)\n\n');const b=await loadProfile(f.root);assert.notEqual(a.guidance_version.profile_sha256,b.guidance_version.profile_sha256);
});
test('profile selects only approved sections, validates vocabulary and forbids unsafe paths',async t=>{
  const f=fixture(t,{profile:true});f.write('profiles/core.md','Core');f.write('profiles/one.md','One');f.write('profiles/two.md','Two');
  const config={schema_version:1,profile:{path:'profiles/core.md',sections:[{id:'one',path:'profiles/one.md',kinds:['note']},{id:'two',path:'profiles/two.md',kinds:['digest']}],vocabulary:'profiles/vocabulary.json'}};
  f.write('profiles/vocabulary.json',{schema_version:2,kinds:[],predicates:['links']});f.write('golem.config.json',config);
  const p=await loadProfile(f.root,{kinds:['note','../../malicious']});assert.equal(p.guidance,'Core\n\nOne');assert.deepEqual(p.vocabulary.kinds,[]);const mixed=await loadProfile(f.root,{kinds:['digest','note']});assert.equal(mixed.guidance,'Core\n\nOne\n\nTwo');assert.equal(mixed.guidance_version.delivered_sha256,sha256(mixed.guidance));
  for(const path of ['inbox/input.md','vendor/engine.md','../outside.md','/tmp/file','profiles/../core.md']){f.write('golem.config.json',{schema_version:1,profile:{path}});await assert.rejects(()=>loadProfile(f.root));}
  f.write('golem.config.json',{schema_version:1,profile:{path:'profiles/missing.md'}});await assert.rejects(()=>loadProfile(f.root));
  try{symlinkSync(join(f.root,'profiles/core.md'),join(f.root,'profiles/link.md'));}catch(e){if(['EPERM','EACCES','ENOSYS'].includes(e.code)){t.diagnostic('OS does not grant symlink creation; other path checks ran');return;}throw e;}f.write('golem.config.json',{schema_version:1,profile:{path:'profiles/link.md'}});await assert.rejects(()=>loadProfile(f.root),/Symlink/);
});
test('initializer opt-in never resets or overwrites an existing instance',t=>{
  const f=fixture(t,{profile:true});const before=f.read('profiles/default.md');
  assert.throws(()=>python([join(harness,'processor/init-instance.py'),'--root',f.root,'--profile']),/never reset/);assert.equal(f.read('profiles/default.md'),before);
});
test('kind can be added once and then is protected by previous graph validation',()=>{
  const graph={schema_version:2,updated_at:'2026-01-01T00:00:00Z',sources:[],entities:[{id:'ent-record',type:'other',label:'Record',aliases:[],source_ids:[],created_at:'2026-01-01T00:00:00Z',uncertainty:[]}],claims:[]};
  // Supply source provenance for a schema-valid identity-only fixture.
  const sid='00000000-0000-4000-8000-000000000001',source={id:sid,path:`inbox/${sid}.md`,sha256:'a'.repeat(64),recorded_at:graph.updated_at};
  graph.sources.push(source);graph.entities[0].source_ids=[sid];const state={sources:{[sid]:{...source,body:'Synthetic'}},ledger:{schema_version:1,observations:[{id:sid,status:'processed',source_file:source.path,source_sha256:source.sha256}]},queue:{schema_version:1,questions:[]}};
  const old=structuredClone(graph);graph.entities[0].kind='record';assert.deepEqual(validateMemory(graph,{...state,previous:old}),[]);
  const previous=structuredClone(graph);for(const kind of ['new-kind',undefined]){graph.entities[0].kind=kind;if(kind===undefined)delete graph.entities[0].kind;assert.ok(validateMemory(graph,{...state,previous}).some(e=>e.includes('Entity identity/history removed: ent-record')));}
  graph.entities[0].kind='Bad kind';assert.ok(schemaErrors(graph).some(e=>e.includes('graph.entities[0].kind')));
  graph.entities[0].kind='source-file';assert.equal(retrieveContext(graph,{query:'source-file'}).entities[0].id,'ent-record');
});
test('filters preserve defaults, separate hidden records from truncation, and close endpoints',()=>{
  const graph=chain();const legacy=retrieveContext(graph,{entity_id:'ent-0'});assert.equal(legacy.method,'lexical_exact_tokens_plus_one_graph_hop');assert.deepEqual(legacy.claims.map(c=>c.id),['clm-0','clm-1']);
  graph.claims[0].status='retracted';const all=retrieveContext(graph,{entity_id:'ent-0',status:'all'});assert.equal(all.claims[0].status,'retracted');
  const active=retrieveContext(graph,{entity_id:'ent-0',status:'active'});assert.equal(active.hidden.retracted,1);assert.equal(active.claims.length,0);assert.equal(active.truncated,false);
  const files=retrieveContext(graph,{entity_id:'ent-0',kind:'file',hops:3,predicate:'links'});assert.deepEqual(files.entities.map(e=>e.id),['ent-2']);assert.deepEqual(files.claims.map(c=>c.id),['clm-1','clm-2']);assert.ok(files.supporting_entities.some(e=>e.id==='ent-1'));assert.equal(files.traversal['clm-2'].hop,3);assert.equal(files.claims.some(c=>c.id==='clm-3'),false);
});
test('traversal is bounded, deterministic on cycles and keeps metadata separate from claims',()=>{
  const graph=chain();graph.claims.push({...graph.claims[0],id:'clm-cycle',subject_id:'ent-2',object:{entity_id:'ent-0'}});
  const options={entity_id:'ent-0',hops:3};const a=retrieveContext(graph,options);assert.deepEqual(a,retrieveContext(graph,options));assert.equal(new Set(a.claims.map(c=>c.id)).size,a.claims.length);assert.equal('hop' in a.claims[0],false);
  const b=retrieveContext(graph,{...options,expansion_budget:1});assert.ok(b.truncation_reasons.includes('expansion_budget'));
  assert.ok(retrieveContext(graph,{...options,limit:1}).truncated);
  for(const opt of [{hops:4},{hops:0},{limit:'NaN'},{limit:0},{kind:'Bad'},{type:'artifact'},{status:'invalid'},{predicate:'links,links'}])assert.throws(()=>retrieveContext(graph,opt));
});
test('warnings are deterministic, advisory, documented and account for speaker references',()=>{
  const graph=chain(); // Warnings only operate on structurally valid graphs.
  const sid='00000000-0000-4000-8000-000000000001',second='00000000-0000-4000-8000-000000000002';
  for(const e of graph.entities)e.source_ids=[sid];for(const c of graph.claims)c.sources=[{observation_id:sid,quote:'Synthetic'}];
  graph.claims[0].classification='corroborated';graph.claims[0].sources.push({observation_id:second,quote:'Synthetic'});
  graph.entities.push({...graph.entities[0],id:'ent-speaker',label:'Speaker'});graph.claims[0].attributed_to_id='ent-speaker';
  graph.entities.push({...graph.entities[0],id:'ent-unused'});
  const context={sources:{[sid]:{body:'Synthetic'},[second]:{body:'Synthetic'}},vocabulary:{kinds:[],predicates:[]}};
  const warnings=collectWarnings(graph,context);assert.ok(warnings.some(w=>w.code==='duplicate_corroboration'));assert.ok(warnings.some(w=>w.code==='unused_entity'&&w.object_id==='ent-unused'));assert.ok(!warnings.some(w=>w.code==='unused_entity'&&w.object_id==='ent-speaker'));assert.ok(warnings.some(w=>w.code==='unknown_kind'));assert.ok(warnings.some(w=>w.code==='unknown_predicate'));assert.deepEqual(warnings,collectWarnings(graph,context));
  context.sources[second].body+=' ';assert.ok(!collectWarnings(graph,context).some(w=>w.code==='duplicate_corroboration'));
  assert.deepEqual(collectWarnings({invalid:true}),[]);
  const docs=readFileSync(new URL('../docs/MEMORY_MODEL.md',import.meta.url),'utf8');for(const code of warningCodes)assert.ok(docs.includes('`'+code+'`'),'Undocumented warning '+code);
});

test('retrieval reports actual output and expansion limits independently of filtering',()=>{
  const graph=chain();for(let i=4;i<135;i++)graph.claims.push({...graph.claims[0],id:'clm-'+String(i).padStart(4,'0')});
  const many=retrieveContext(graph,{entity_id:'ent-0',status:'all',limit:1000});assert.equal(many.claims.length,100);assert.deepEqual(many.truncation_reasons,['claim_limit']);
  const bounded=retrieveContext(graph,{entity_id:'ent-0',hops:3,expansion_budget:1});assert.equal(bounded.claims.length,1);assert.deepEqual(bounded.truncation_reasons,['expansion_budget']);
  const excluded=retrieveContext(graph,{entity_id:'ent-0',predicate:'missing'});assert.equal(excluded.truncated,false);assert.equal(excluded.hidden.predicate,135);
});

test('profile configuration rejects invalid vocabulary, duplicate selectors and all unreadable sections',async t=>{
  const f=fixture(t,{profile:true});await assert.rejects(()=>loadProfile(harness),/outside the engine/);const config={schema_version:1,profile:{path:'profiles/default.md',vocabulary:'profiles/vocab.json'}};
  for(const vocabulary of [{schema_version:3},{schema_version:2,kinds:['record','record']},{schema_version:2,predicates:['bad-name']},{schema_version:1,unknown:[]}]){f.write('profiles/vocab.json',vocabulary);f.write('golem.config.json',config);await assert.rejects(()=>loadProfile(f.root));}
  delete config.profile.vocabulary;config.profile.sections=[{id:'missing',path:'profiles/missing.md',kinds:['not-this-batch']}];f.write('golem.config.json',config);await assert.rejects(()=>loadProfile(f.root,{kinds:['note']}));
});

test('template fails closed until storage operations are implemented',async()=>{
  const {createAdapter}=await import('../adapters/template/adapter.mjs');const adapter=createAdapter({});for(const command of ['status','claim','renew','validate','commit','release-error'])assert.throws(()=>adapter[command]({}),/not implemented/);
});

test('compound filters and query/source seeds have deterministic endpoint closure',()=>{
  const graph=chain();const sid='00000000-0000-4000-8000-000000000001';graph.sources=[{id:sid}];graph.claims[1].sources=[{observation_id:sid,quote:'Unique quotation'}];
  const options={kind:'file',type:'person,other',predicate:'links',status:'all'};
  const query=retrieveContext(graph,{...options,query:'quotation'});assert.deepEqual(query.entities.map(e=>e.id),['ent-2']);assert.ok(query.claims.some(c=>c.id==='clm-1'));
  const source=retrieveContext(graph,{...options,source_id:sid});assert.ok(source.claims.some(c=>c.id==='clm-1'));assert.equal(source.sources[0].id,sid);
  assert.equal(retrieveContext(graph,{...options,type:'place',query:'quotation'}).entities.length,0);
  for(const c of query.claims)for(const id of [c.subject_id,c.attributed_to_id,c.object.entity_id])assert.ok([...query.entities,...query.supporting_entities].some(e=>e.id===id));
});

test('breadth-first traversal handles equal-length branches and cycles with stable parents',()=>{
  const graph=chain(),make=(id,a,b)=>({...graph.claims[0],id,subject_id:'ent-'+a,object:{entity_id:'ent-'+b}});
  graph.claims=[make('clm-a',0,1),make('clm-b',0,2),make('clm-c',1,3),make('clm-d',2,3),make('clm-e',3,4),make('clm-cycle',1,2)];
  const result=retrieveContext(graph,{entity_id:'ent-0',hops:3});assert.equal(result.traversal['clm-e'].hop,3);assert.equal(result.traversal['clm-e'].parent_entity_id,'ent-3');assert.equal(result.traversal['clm-cycle'].parent_entity_id,'ent-1');assert.equal(new Set(result.claims.map(c=>c.id)).size,6);assert.deepEqual(result,retrieveContext({...graph,claims:[...graph.claims].reverse()},{entity_id:'ent-0',hops:3}));
});
