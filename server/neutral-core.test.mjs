import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,renameSync,unlinkSync} from 'node:fs';
import {join} from 'node:path';
import {fixture,python,pythonCommand,harness} from './test-fixtures.mjs';
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

test('Python launcher selection is explicit, portable and reports the attempted executable',()=>{
  assert.deepEqual(pythonCommand({env:{},platform:'win32'}),['py','-3']);assert.deepEqual(pythonCommand({env:{},platform:'linux'}),['python3']);assert.deepEqual(pythonCommand({env:{GOLEM_PYTHON:'C:/Program Files/Python/python.exe'},platform:'win32'}),['C:/Program Files/Python/python.exe']);
  assert.match(python(['-c','import sys; print(sys.version_info.major)']),/^3$/);
  assert.throws(()=>python(['-V'],{env:{...process.env,GOLEM_PYTHON:'missing-golem-interpreter'}}),/missing-golem-interpreter/);
});
