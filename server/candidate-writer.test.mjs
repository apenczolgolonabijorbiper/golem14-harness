import test from 'node:test';
import assert from 'node:assert/strict';
import {unlinkSync,symlinkSync,mkdirSync,chmodSync,writeFileSync,readFileSync} from 'node:fs';
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
  const pointer=`Completion record: message of the analysis commit containing this journal; instance ${f.root}; run ${claim.run_id}.`;
  changes.review+='\n\n'+pointer;
  const preview=await writeCandidate({root:f.root,changes});assert.equal(preview.mode,'preview');assert.equal(f.read('memory/graph.json'),original);assert.equal(f.read('memory/index.md'),index);assert.throws(()=>f.read(`memory/runs/${claim.run_id}.md`));
  const result=await writeCandidate({root:f.root,changes,apply:true});assert.equal(result.mode,'draft-written');assert.equal(f.git('rev-parse','HEAD'),head);assert.equal(JSON.parse(f.read('memory/processed.json')).observations.length,0);assert.equal((await adapter.status()).lease.status,'processing');
  assert.ok(f.read(`memory/runs/${claim.run_id}.md`).includes('guidance_version: '+claim.guidance_identity));
  const journal=f.read(`memory/runs/${claim.run_id}.md`);
  assert.ok(journal.includes(pointer));
  assert.match(journal,/candidate validation, publication and persisted-state verification are pending/);
  await adapter.validate({run:claim.run_id});assert.equal((await adapter.commit({run:claim.run_id})).status,'committed');assert.equal((await adapter.status()).processed,1);
  assert.equal(f.read(`memory/runs/${claim.run_id}.md`),journal);
  // This adapter supplies a label, not the application host's verification report.
  assert.equal(f.git('log','-1','--format=%B'),`complete ${claim.run_id}`);
});

test('host retains actual validation, publication and saved-state results outside the unchanged journal',async t=>{
  const {f,adapter,claim,changes}=await prepared(t),journalPath=`memory/runs/${claim.run_id}.md`;
  const reportPath=join(f.root,'..','verification',`${claim.run_id}.json`);
  changes.review+=`\n\nCompletion record: ${reportPath}; instance ${f.root}; run ${claim.run_id}.`;
  const draft=await writeCandidate({root:f.root,changes,apply:true}),journal=f.read(journalPath);
  assert.ok(journal.includes(reportPath));
  const validation=await adapter.validate({run:claim.run_id,outputs:draft.files});
  assert.equal(validation.ok,true);assert.equal(validation.mode,'candidate');
  assert.equal(f.read(journalPath),journal);
  const receipt=await adapter.commit({run:claim.run_id,outputs:draft.files});
  assert.equal(receipt.status,'committed');
  const persisted=JSON.parse(command(process.execPath,[join(harness,'processor/memory-tool.mjs'),'validate','--root',f.root]));
  assert.equal(persisted.valid,true);
  assert.equal(f.git('rev-parse',`${receipt.head}:${journalPath}`),f.git('hash-object',journalPath));
  const record={instance:f.root,run_id:claim.run_id,head:receipt.head,
    checks:{candidate_validation:validation,saved_state:persisted,publication:{status:receipt.status}},
    warnings:receipt.warnings,warning_summary:receipt.warning_summary};
  mkdirSync(join(f.root,'..','verification'),{recursive:true});
  writeFileSync(reportPath,JSON.stringify(record,null,2)+'\n');
  assert.deepEqual(JSON.parse(readFileSync(reportPath,'utf8')),record);
  assert.equal(f.git('rev-parse','HEAD'),receipt.head);
  assert.equal(f.read(journalPath),journal);
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

test('complete cycle renders queues, hypotheses and chat event and publishes every declared output',async t=>{
  const {f,adapter,claim,changes}=await prepared(t),source=claim.sources[0].id;
  f.write('questions/queue.json',{schema_version:1,questions:[{id:'q-old',text:'Was it checked?',status:'open',source_observation_id:source}]});
  const at=new Date().toISOString();
  const delta={...changes,at,questions:[{id:'q-old',text:'Was it checked?',status:'closed',source_observation_id:source,analysis:{status:'answered',source_observation_ids:[source]}},{id:'q-next',text:'Żółć | <tag>\nWhat next?',status:'open',source_observation_id:source}],hypotheses:{schema_version:1,updated_at:at,hypotheses:[{id:'hyp-test',statement:'Still uncertain',status:'open',support:[],refutation:[],confidence:0.2,updated_at:at}]},events:[{observation_id:source,question_id:'q-old',answer:'The declaration was reviewed.',answered_at:at}],base_files_sha256:{}};
  for(const path of ['questions/queue.json','questions/queue.md','memory/hypotheses.json'])delta.base_files_sha256[path]=sha256(f.read(path));
  delta.base_files_sha256[`memory/events/chat/${source}.json`]=null;
  const preview=await writeCandidate({root:f.root,changes:delta});assert.equal(preview.files.length,7);
  const written=await writeCandidate({root:f.root,changes:delta,apply:true});assert.deepEqual(written.files,preview.files);
  assert.equal(f.read('questions/queue.md'),'# Questions\n\n## q-old (closed)\n\n```text\nWas it checked?\n```\n\n## q-next (open)\n\n```text\nŻółć | <tag>\nWhat next?\n```\n');
  assert.match(f.read('memory/index.md'),/- Graph: 1 entities, 1 claims/);
  await adapter.validate({run:claim.run_id,outputs:written.files});await adapter.commit({run:claim.run_id,outputs:written.files});
  const checked=JSON.parse(command(process.execPath,[join(harness,'processor/memory-tool.mjs'),'validate','--root',f.root]));assert.equal(checked.valid,true);
});

test('complete writer aggregates invalid references/hypotheses and refuses stale auxiliary bases without writes',async t=>{
  const {f,changes,original}=await prepared(t),at=new Date().toISOString();
  await assert.rejects(()=>writeCandidate({root:f.root,changes:{...changes,questions:[1,2].map(n=>({id:'q-'+n,status:'open',text:'Question '+n,source_observation_id:'missing-'+n})),hypotheses:{schema_version:1,updated_at:at,hypotheses:[{id:'hyp-bad',statement:'No',status:'open',support:[],refutation:[],confidence:0,updated_at:at,uncertainty:[]}]}}}),e=>e.message.includes('missing-1')&&e.message.includes('missing-2')&&e.message.includes('uncertainty'));
  const delta={...changes,questions:[{id:'q-one',status:'open',text:'Next?',source_observation_id:'00000000-0000-4000-8000-000000000001'}],base_files_sha256:{'questions/queue.json':sha256(f.read('questions/queue.json')),'questions/queue.md':sha256(f.read('questions/queue.md'))}};
  f.write('questions/queue.md','Concurrent draft');
  await assert.rejects(()=>writeCandidate({root:f.root,changes:delta,apply:true}),/stale base_files/);assert.equal(f.read('memory/graph.json'),original);assert.equal(f.read('questions/queue.md'),'Concurrent draft');
});


test('failed late artifact write restores the earlier draft bytes and leaves the lease owned',async t=>{
 const {f,adapter,claim,changes,original,index}=await prepared(t),source=claim.sources[0].id;
 const dir=join(f.root,'memory/events/chat');mkdirSync(dir,{recursive:true});chmodSync(dir,0o500);
 try {
 try{writeFileSync(join(dir,'probe'),'x');t.skip('Filesystem does not enforce directory write permissions');return;}catch(error){assert.equal(error.code,'EACCES');}
 const event=`memory/events/chat/${source}.json`,delta={...changes,questions:[{id:'q-one',text:'What next?',status:'open',source_observation_id:source}],events:[{observation_id:source,question_id:'q-one',answer:'Reviewed.',answered_at:new Date().toISOString()}],base_files_sha256:{'questions/queue.json':sha256(f.read('questions/queue.json')),'questions/queue.md':sha256(f.read('questions/queue.md')),[event]:null}};
 const queue=f.read('questions/queue.json'),markdown=f.read('questions/queue.md');
 await assert.rejects(writeCandidate({root:f.root,changes:delta,apply:true}),{code:'EACCES'});
 assert.equal(f.read('memory/graph.json'),original);assert.equal(f.read('memory/index.md'),index);assert.equal(f.read('questions/queue.json'),queue);assert.equal(f.read('questions/queue.md'),markdown);assert.throws(()=>f.read(`memory/runs/${claim.run_id}.md`));assert.equal((await adapter.status()).lease.run_id,claim.run_id);
 }finally{chmodSync(dir,0o700);}
});
