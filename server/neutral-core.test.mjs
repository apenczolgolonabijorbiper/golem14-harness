import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,renameSync,unlinkSync} from 'node:fs';
import {join} from 'node:path';
import {fixture,python,pythonCommand,harness} from './test-fixtures.mjs';
import {resolveLayout} from './instance-layout.mjs';
import {loadMemory,run} from '../processor/memory-tool.mjs';
import {validateMemory,schemaErrors,retrieveContext,collectWarnings} from './memory-model.mjs';
import {createAdapter} from '../adapters/reference-git/adapter.mjs';

test('new instances have neutral purpose, hypothesis and selected profile defaults',async t=>{
  const f=fixture(t,{profile:true});const layout=await resolveLayout(f.root);
  assert.deepEqual(layout,{purpose_path:'instance/purpose.md',hypotheses_path:'memory/hypotheses.json'});
  assert.ok(!existsSync(join(f.root,'persona')));assert.ok(!f.read(layout.purpose_path).includes('biography'));
  assert.equal(JSON.parse(f.read('golem.config.json')).profile.path,'profiles/default.md');
  assert.deepEqual((await run(['validate','--root',f.root])).layout,layout);
});

test('legacy instances process without rewriting original claims, purpose or hypotheses',async t=>{
  const f=fixture(t,{legacy:true});f.observe();const adapter=createAdapter({instance:f.root});let claim=await adapter.claim();f.analyze(claim);await adapter.commit({run:claim.run_id,outputs:'persona/hypotheses.json'});
  const original=JSON.parse(f.read('memory/graph.json')).claims[0],purpose=f.read('persona/identity.md'),hypotheses=f.read('persona/hypotheses.json');
  assert.equal(original.classification,'user_declaration');assert.ok(original.speaker_id);assert.ok(!original.attributed_to_id);
  f.observe(2);claim=await adapter.claim();f.analyze(claim);const graph=JSON.parse(f.read('memory/graph.json')),next=graph.claims.at(-1);next.attributed_to_id=next.speaker_id;delete next.speaker_id;next.classification='source_assertion';f.write('memory/graph.json',graph);
  await adapter.commit({run:claim.run_id});assert.deepEqual(JSON.parse(f.read('memory/graph.json')).claims[0],original);assert.equal(f.read('persona/identity.md'),purpose);assert.equal(f.read('persona/hypotheses.json'),hypotheses);assert.ok(!existsSync(join(f.root,'memory/hypotheses.json')));
  const state=await loadMemory(f.root);assert.deepEqual(validateMemory(state.graph,state),[]);const context=retrieveContext(state.graph,{kind:'record',hops:1});assert.equal(context.claims.length,2);assert.ok(context.entities.every(e=>e.id));
});

test('duplicate layout files fail closed; explicit committed relocation preserves graph/history',async t=>{
  const f=fixture(t,{legacy:true});const original=f.read('memory/graph.json');f.write('instance/purpose.md',f.read('persona/identity.md'));await assert.rejects(()=>resolveLayout(f.root),/Conflicting instance purpose/);
  // Explicit operator migration, never an implicit runtime move.
  unlinkSync(join(f.root,'instance/purpose.md'));
  renameSync(join(f.root,'persona/identity.md'),join(f.root,'instance/purpose.md'));
  renameSync(join(f.root,'persona/hypotheses.json'),join(f.root,'memory/hypotheses.json'));f.save();
  assert.equal(f.read('memory/graph.json'),original);assert.equal((await resolveLayout(f.root)).hypotheses_path,'memory/hypotheses.json');
  f.write('persona/hypotheses.json',f.read('memory/hypotheses.json'));await assert.rejects(()=>resolveLayout(f.root),/Conflicting instance hypotheses/);
});

test('neutral attribution/classification names preserve integrity and legacy aliases',async t=>{
  const f=fixture(t);f.observe();const adapter=createAdapter({instance:f.root}),claim=await adapter.claim();f.analyze(claim);await adapter.commit({run:claim.run_id});const state=await loadMemory(f.root),c=state.graph.claims[0];
  for(const classification of ['source_assertion','user_declaration','hypothesis','corroborated','independently_confirmed']){
    c.classification=classification;c.uncertainty=classification==='hypothesis'?['Synthetic uncertainty']:[];assert.deepEqual(validateMemory(state.graph,state),[]);
  }
  c.classification='source_assertion';c.attributed_to_id='ent-missing';assert.ok(validateMemory(state.graph,state).some(x=>x.includes('(attributed_to_id ent-missing)')));
  c.attributed_to_id=c.subject_id;c.speaker_id='ent-other';state.graph.entities.push({...state.graph.entities[0],id:'ent-other'});assert.ok(validateMemory(state.graph,state).some(x=>x.startsWith('Conflicting claim attribution:')));
  delete c.speaker_id;const prior=structuredClone(state.graph);c.speaker_id=c.attributed_to_id;assert.ok(validateMemory(state.graph,{...state,previous:prior}).some(x=>x.startsWith('Claim history mutated:')));
  delete c.speaker_id;delete c.attributed_to_id;assert.ok(schemaErrors(state.graph).length);
});

test('Python launcher selection is explicit, portable and reports the attempted executable',()=>{
  assert.deepEqual(pythonCommand({env:{},platform:'win32'}),['py','-3']);assert.deepEqual(pythonCommand({env:{},platform:'linux'}),['python3']);assert.deepEqual(pythonCommand({env:{GOLEM_PYTHON:'C:/Program Files/Python/python.exe'},platform:'win32'}),['C:/Program Files/Python/python.exe']);
  assert.match(python(['-c','import sys; print(sys.version_info.major)']),/^3$/);
  assert.throws(()=>python(['-V'],{env:{...process.env,GOLEM_PYTHON:'missing-golem-interpreter'}}),/missing-golem-interpreter/);
});
