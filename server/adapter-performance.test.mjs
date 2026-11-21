import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,command,harness} from './test-fixtures.mjs';
import {join} from 'node:path';
import {createAdapter} from '../adapters/reference-git/adapter.mjs';

test('adapter metrics are opt-in, cover initialization and errors, and contain only fixed labels',async t=>{
  const f=fixture(t);assert.equal('timings' in await createAdapter({instance:f.root}).status(),false);
  const adapter=createAdapter({instance:f.root,timings:true}),result=await adapter.status();
  assert.ok(result.timings.setup.git.calls>=3);assert.ok(result.timings.git.calls>0);assert.ok(result.timings.phases.scan.calls>0);
  assert.ok(result.timings.elapsed_ms>=0);assert.ok(!JSON.stringify(result.timings).includes(f.root));
  await assert.rejects(()=>adapter.renew({run:'00000000-0000-4000-8000-000000000099'}),error=>{assert.equal(error.timings.operation,'renew');return true;});
  const output=JSON.parse(command(process.execPath,[join(harness,'adapters/reference-git/adapter.mjs'),'status','--instance',f.root,'--timings','true']));assert.equal(output.timings.operation,'status');
  assert.throws(()=>command(process.execPath,[join(harness,'adapters/reference-git/adapter.mjs'),'status','--instance',f.root,'--timings','yes']),/true or false/);
});

test('tree/index metadata and recovery use bounded Git calls for twenty-source completion',async t=>{
  const f=fixture(t);for(let i=1;i<=20;i++)f.observe(i);
  const adapter=createAdapter({instance:f.root,timings:true}),claim=await adapter.claim();f.analyze(claim);
  const validation=await adapter.validate({run:claim.run_id});assert.ok(validation.timings.git.commands['ls-tree'].calls<=2);assert.equal(validation.timings.git.commands['update-index'].calls,1);
  const result=await adapter.commit({run:claim.run_id});assert.equal(result.processed.length,20);
  assert.ok(result.timings.git.commands['ls-tree'].calls<=3);assert.ok(result.timings.git.commands['cat-file'].calls<=3);assert.equal(result.timings.git.commands['update-index'].calls,2);
  assert.equal(result.timings.phases.validator.calls,1);assert.ok(result.timings.phases.recovery.calls>=1);
  assert.equal(result.timings.counts.claimed_sources,20);assert.equal(result.timings.counts.graph_sources,20);assert.ok(result.timings.counts.candidate_tree_bytes>7000);
});

test('recovery refuses staged mode changes and preserves the published completion',async t=>{
  const f=fixture(t);f.observe();
  const adapter=createAdapter({instance:f.root,hooks:{afterPublish({operation}){if(operation.startsWith('complete'))throw Error('Interrupted');}}});
  const claim=await adapter.claim();f.analyze(claim);await assert.rejects(()=>adapter.commit({run:claim.run_id}),/Interrupted/);
  const head=f.git('rev-parse','HEAD');f.git('update-index','--chmod=+x','memory/graph.json');
  await assert.rejects(()=>createAdapter({instance:f.root}).claim(),/Preserve edited index/);
  assert.equal(f.git('rev-parse','HEAD'),head);assert.match(f.git('ls-files','--stage','memory/graph.json'),/^100755 /);
  assert.equal(JSON.parse(f.git('show','HEAD:memory/processed.json')).observations.length,1);
});
