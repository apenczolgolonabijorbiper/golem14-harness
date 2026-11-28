import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,renameSync,unlinkSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {fixture,node,harness} from './test-fixtures.mjs';
import {physicallyWithin} from './application-profile.mjs';
import {resolveLayout} from './instance-layout.mjs';
import {loadMemory,run} from '../processor/memory-tool.mjs';
import {validateMemory,schemaErrors,retrieveContext,collectWarnings} from './memory-model.mjs';
import {createAdapter} from '../adapters/reference-git/adapter.mjs';

test('new instances have neutral purpose, hypothesis and selected profile defaults',async t=>{
  const f=fixture(t,{profile:true});assert.equal(physicallyWithin(f.root,join(f.root,'instance')),true);assert.equal(physicallyWithin(f.root,harness),false);const layout=await resolveLayout(f.root);
  assert.deepEqual(layout,{purpose_path:'instance/purpose.md',hypotheses_path:'memory/hypotheses.json'});
  assert.ok(!existsSync(join(f.root,'persona')));assert.ok(!f.read(layout.purpose_path).includes('biography'));
  assert.equal(JSON.parse(f.read('golem.config.json')).profile.path,'profiles/default.md');
  assert.deepEqual((await run(['validate','--root',f.root])).layout,layout);
});

test('unsupported graph formats and historical field aliases fail clearly',async t=>{
  const f=fixture(t);f.observe();const adapter=createAdapter({instance:f.root}),claim=await adapter.claim();f.analyze(claim);await adapter.commit({run:claim.run_id});const state=await loadMemory(f.root);
  const old=structuredClone(state.graph);old.schema_version=1;assert.ok(schemaErrors(old).some(e=>e.includes('invalid constant')));
  const bad=structuredClone(state.graph);bad.claims[0].speaker_id=bad.claims[0].attributed_to_id;delete bad.claims[0].attributed_to_id;assert.ok(schemaErrors(bad).length);
  assert.deepEqual(validateMemory(state.graph,state),[]);
});




test('historical persona paths cannot substitute for required canonical JSON files',async t=>{
  const f=fixture(t);mkdirSync(join(f.root,'persona'));
  renameSync(join(f.root,'instance/purpose.md'),join(f.root,'persona/identity.md'));
  await assert.rejects(()=>resolveLayout(f.root),/Missing instance purpose: instance\/purpose.md/);
  renameSync(join(f.root,'persona/identity.md'),join(f.root,'instance/purpose.md'));
  renameSync(join(f.root,'memory/hypotheses.json'),join(f.root,'persona/hypotheses.json'));
  await assert.rejects(()=>resolveLayout(f.root),/Missing instance hypotheses: memory\/hypotheses.json/);
});

test('legacy classification aliases and coexisting speaker_id fail canonical graph schema',async t=>{
  const f=fixture(t);f.observe();const adapter=createAdapter({instance:f.root}),claim=await adapter.claim();
  f.analyze(claim);await adapter.commit({run:claim.run_id});const {graph}=await loadMemory(f.root);
  for(const classification of ['user_declaration','independently_confirmed']){
    const bad=structuredClone(graph);bad.claims[0].classification=classification;
    assert.ok(schemaErrors(bad).some(e=>e.includes('classification: invalid enum')));
  }
  const bad=structuredClone(graph);bad.claims[0].speaker_id=bad.claims[0].attributed_to_id;
  assert.ok(schemaErrors(bad).some(e=>e.includes('speaker_id: unexpected field')));
  assert.deepEqual(schemaErrors(graph),[]);
});
