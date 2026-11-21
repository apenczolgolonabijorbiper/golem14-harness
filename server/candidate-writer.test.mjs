import test from 'node:test';
import assert from 'node:assert/strict';
import {unlinkSync,symlinkSync} from 'node:fs';
import {join} from 'node:path';
import {fixture,command,harness} from './test-fixtures.mjs';
import {sha256} from './application-profile.mjs';
import {createAdapter} from '../adapters/reference-git/adapter.mjs';
import {writeCandidate} from '../processor/write-candidate.mjs';

async function prepared(t,{profile=false}={}){
  const f=fixture(t,{profile});f.observe();
  const adapter=createAdapter({instance:f.root}),claim=await adapter.claim(),original=f.read('memory/graph.json'),index=f.read('memory/index.md');
  f.analyze(claim);const graph=JSON.parse(f.read('memory/graph.json'));
  f.write('memory/graph.json',original);unlinkSync(join(f.root,`memory/runs/${claim.run_id}.md`));
  const changes={schema_version:1,run_id:claim.run_id,base_graph_sha256:sha256(original),base_index_sha256:sha256(index),entities:graph.entities,claims:graph.claims,review:'Reviewed all sources. Declaration only; verification is unresolved. Model identifier unavailable.',model:'unknown'};
  return {f,adapter,claim,changes,original,index};
}

test('candidate writer previews without writes and completes through the adapter with claimed guidance',async t=>{
  const {f,adapter,claim,changes,original,index}=await prepared(t,{profile:true}),head=f.git('rev-parse','HEAD');
  const preview=await writeCandidate({root:f.root,changes});assert.equal(preview.mode,'preview');assert.equal(f.read('memory/graph.json'),original);assert.equal(f.read('memory/index.md'),index);assert.throws(()=>f.read(`memory/runs/${claim.run_id}.md`));
  const result=await writeCandidate({root:f.root,changes,apply:true});assert.equal(result.mode,'draft-written');assert.equal(f.git('rev-parse','HEAD'),head);assert.equal(JSON.parse(f.read('memory/processed.json')).observations.length,0);assert.equal((await adapter.status()).lease.status,'processing');
  assert.ok(f.read(`memory/runs/${claim.run_id}.md`).includes('guidance_version: '+claim.guidance_identity));
  await adapter.validate({run:claim.run_id});assert.equal((await adapter.commit({run:claim.run_id})).status,'committed');assert.equal((await adapter.status()).processed,1);
});

test('candidate writer refuses stale bases, bad quotations, unknown keys and lost ownership before writes',async t=>{
  const {f,adapter,claim,changes,original,index}=await prepared(t);
  for(const patch of [{base_graph_sha256:'0'.repeat(64)},{base_index_sha256:'0'.repeat(64)},{extra:true},{claim_statuses:[{id:'missing',status:'retracted'}]},{claims:[{...changes.claims[0],sources:[{observation_id:claim.sources[0].id,quote:'Missing quotation'}]}]}]){
    await assert.rejects(()=>writeCandidate({root:f.root,changes:{...changes,...patch},apply:true}));assert.equal(f.read('memory/graph.json'),original);assert.equal(f.read('memory/index.md'),index);
  }
  await adapter['release-error']({run:claim.run_id});await assert.rejects(()=>writeCandidate({root:f.root,changes,apply:true}),/lease/);
});

test('candidate writer retains old claims while extending entity provenance and applying corrections',async t=>{
  const {f,adapter,claim,changes}=await prepared(t);await writeCandidate({root:f.root,changes,apply:true});await adapter.commit({run:claim.run_id});
  const original=JSON.parse(f.read('memory/graph.json')),entity=original.entities[0],old=original.claims[0];
  f.observe(2);const next=await adapter.claim(),source=next.sources[0];
  const correction={...old,id:'clm-correction',sources:[{observation_id:source.id,quote:'Synthetic record.'}],asserted_at:source.recorded_at,supersedes:[old.id],created_at:new Date().toISOString()};
  const delta={schema_version:1,run_id:next.run_id,base_graph_sha256:sha256(f.read('memory/graph.json')),base_index_sha256:sha256(f.read('memory/index.md')),entity_additions:[{id:entity.id,source_ids:[source.id]}],claims:[correction],claim_statuses:[{id:old.id,status:'superseded'}],review:'Reviewed a synthetic correction. No independent corroboration.',model:'unknown'};
  await writeCandidate({root:f.root,changes:delta,apply:true});await adapter.commit({run:next.run_id});
  const saved=JSON.parse(f.read('memory/graph.json'));assert.deepEqual(saved.claims[0],{...old,status:'superseded'});assert.deepEqual(saved.entities[0].source_ids,[...entity.source_ids,source.id]);
});

test('candidate writer preserves existing journals and rejects symlink destinations',async t=>{
  const {f,claim,changes,original}=await prepared(t),journal=`memory/runs/${claim.run_id}.md`;
  f.write(journal,'Keep existing draft');await assert.rejects(()=>writeCandidate({root:f.root,changes,apply:true}),/already exists/);assert.equal(f.read(journal),'Keep existing draft');assert.equal(f.read('memory/graph.json'),original);
  unlinkSync(join(f.root,journal));
  try{symlinkSync(join(f.root,'memory/index.md'),join(f.root,journal));}catch(e){if(!['EPERM','EACCES','ENOSYS'].includes(e.code))throw e;t.diagnostic('Symlink privilege unavailable');return;}
  await assert.rejects(()=>writeCandidate({root:f.root,changes,apply:true}),/Unsafe/);assert.equal(f.read('memory/graph.json'),original);
});

test('candidate writer CLI is packaged, previews by default and rejects invalid apply flags',async t=>{
  const {f,changes,original}=await prepared(t);f.write('changes.json',changes);
  const args=[join(harness,'processor/write-candidate.mjs'),'--root',f.root,'--changes',join(f.root,'changes.json')];
  assert.equal(JSON.parse(command(process.execPath,args)).mode,'preview');assert.equal(f.read('memory/graph.json'),original);
  assert.throws(()=>command(process.execPath,[...args,'--apply','yes']),/true\|false/);
});

test('candidate writer refuses mutated source bytes without changing drafts or the lease',async t=>{
  const {f,adapter,claim,changes,original,index}=await prepared(t);f.write(claim.sources[0].path,f.read(claim.sources[0].path)+'Changed');
  await assert.rejects(()=>writeCandidate({root:f.root,changes,apply:true}),/source changed/i);
  assert.equal(f.read('memory/graph.json'),original);assert.equal(f.read('memory/index.md'),index);assert.equal((await adapter.status()).lease.run_id,claim.run_id);
});

test('candidate writer blocks unreadable selected guidance before writing drafts',async t=>{
  const {f,changes,original,index}=await prepared(t,{profile:true});
  unlinkSync(join(f.root,'profiles/default.md'));
  await assert.rejects(()=>writeCandidate({root:f.root,changes,apply:true}));
  assert.equal(f.read('memory/graph.json'),original);assert.equal(f.read('memory/index.md'),index);
});
