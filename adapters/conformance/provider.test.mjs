import test from 'node:test';
import assert from 'node:assert/strict';
import {providerConformance} from './provider-suite.mjs';
import {corpus,run,at} from './providers/corpus.mjs';
import {recordHost} from './providers/record-provider.mjs';
import {fixture} from '../../server/test-fixtures.mjs';
import {createAdapter} from '../reference-git/adapter.mjs';
import {createMemory} from '../../server/provider-memory.mjs';
import {records} from '../../server/memory-contract.mjs';
import {changeFor} from './providers/corpus.mjs';
providerConformance('independent record host',async()=>{
  const h=recordHost(corpus());
  return {...h,changeSource:()=>h.changeSource(corpus().rows.observations[1].id),reopen:()=>recordHost(null,{backing:h.backing}).provider};
});
async function jsonHost(t){
  const f=fixture(t,{profile:true}),s=corpus();let clock=Date.now(),fault=null;
  f.write('profiles/vocabulary.json',s.meta.policy.vocabulary);
  f.write('golem.config.json',{schema_version:1,profile:{path:'profiles/default.md',vocabulary:'profiles/vocabulary.json'}});
  f.write('memory/graph.json',{schema_version:2,updated_at:at,sources:s.rows.sources,entities:s.rows.entities,claims:s.rows.claims});
  f.write('memory/processed.json',{schema_version:1,updated_at:at,observations:s.rows.processed});
  f.write('questions/queue.json',{schema_version:1,updated_at:at,questions:[]});
  f.write('memory/hypotheses.json',{schema_version:1,updated_at:at,hypotheses:[]});
  for(const row of s.rows.observations)f.write(row.path,s.evidence.get(row.id));
  const pending=s.rows.observations[1];
  f.write('memory/processing-lock.json',{schema_version:1,status:'processing',run_id:run,observation_ids:[pending.id],sources:[{id:pending.id,path:pending.path,sha256:pending.sha256}],expires_at:new Date(clock+900000).toISOString()});
  f.save();
  const adapter=createAdapter({instance:f.root,now:()=>clock,hooks:{
    beforeMemoryPublish(){if(fault==='before'){fault=null;throw Error('Interrupted before publication');}},
    afterPublish({operation}){if(fault==='after'&&operation.startsWith('semantic-complete')){fault=null;throw Error('Response lost after publication');}},
  }});
  const provider=await adapter.openMemory({instance_id:'synthetic-instance'});
  return {provider,f,reserve(){},expire(){clock+=900001;},changeSource(){f.write(pending.path,f.read(pending.path)+'Changed source');},changePolicy(){f.write('instance/purpose.md',f.read('instance/purpose.md')+'Changed policy');},advance(){f.write('advance.txt','Concurrent host artifact');f.save();},interrupt(point){fault=point;},reopen:()=>createAdapter({instance:f.root,now:()=>clock}).openMemory({instance_id:'synthetic-instance'})};
}
providerConformance('JSON/Git reference host',jsonHost);

test('independent ordinary lookup never enumerates unfiltered collections',async()=>{
  const h=recordHost(corpus()),m=createMemory(h.provider),meta=await m.open();h.calls.length=0;
  await m.context(meta.snapshot_id,{entity_id:'ent-alpha',current:true});
  assert.ok(h.calls.length);assert.equal(h.calls.filter(c=>c.op==='scan'&&(!Object.keys(c.selector).length||c.purpose!=='lookup')).length,0);
});

test('missing retained evidence is unavailable, never an empty successful source',async()=>{
  const h=recordHost(corpus()),id=corpus().rows.observations[0].id;h.loseEvidence(id);
  const meta=await h.provider.open();assert.equal((await h.provider.evidence({snapshot:meta.snapshot_id,id})).status,'unavailable');
  assert.ok((await createMemory(h.provider).audit(meta.snapshot_id)).some(s=>s.includes('unavailable')));
  h.expireSnapshot(meta.snapshot_id);await assert.rejects(()=>h.provider.open({snapshot:meta.snapshot_id}),/expired/);
});

test('standalone public cycle starts with a provider-capable claim and no graph edits',async t=>{
  const f=fixture(t),s=f.observe(),adapter=createAdapter({instance:f.root});
  const {run:launch}=await import('../../processor/provider-tool.mjs');
  const cli=['--instance',f.root,'--instance-id','standalone'];
  const claim=await launch(['claim',...cli]);
  const provider=await adapter.openMemory({instance_id:'standalone'}),memory=createMemory(provider),meta=await memory.open();
  const change={provider_version:1,base_snapshot:meta.snapshot_id,policy_id:meta.policy_id,lease_id:claim.run_id,run_id:claim.run_id,attempt_id:'standalone-attempt',idempotency_key:'standalone-cycle',sources:[{id:s.id,sha256:s.sha256}],at:new Date().toISOString(),operations:[
    {op:'add_entity',record:{id:'ent-standalone',type:'other',label:'Synthetic',aliases:[],source_ids:[s.id],created_at:s.recorded_at,uncertainty:[]}},
    {op:'add_claim',record:{id:'clm-standalone',subject_id:'ent-standalone',attributed_to_id:'ent-standalone',predicate:'describes',object:{value:'Synthetic'},classification:'source_assertion',sources:[{observation_id:s.id,quote:s.body.trim()}],asserted_at:s.recorded_at,valid_time:{from:null,to:null,expression:null,precision:'unknown'},status:'active',supersedes:[],uncertainty:[],created_at:s.recorded_at}},
    {op:'append_journal',record:{id:claim.run_id,policy_id:meta.policy_id,review:'Exact source reviewed.',verification_id:'standalone-attempt',model:'unknown'}},
    {op:'append_verification',record:{id:'standalone-attempt',run_id:claim.run_id,result:'Synthetic deterministic test',observed_at:new Date().toISOString()}},
  ]};
  f.write('cycle-changes.json',change);
  const result=await launch(['apply',...cli,'--request',f.root+'/cycle-changes.json']);assert.equal(result.verification_id,'standalone-attempt');
  assert.equal((await launch(['recover',...cli,'--key','standalone-cycle'])).id,'standalone-cycle');
  assert.equal((await adapter.status()).processed,1);assert.deepEqual(await memory.audit((await memory.open()).snapshot_id),[]);
  assert.equal((await adapter.openCognition({instance_id:'standalone'})).pending_count,0);
});

test('record export imports into JSON with exact sources, history, policy and pointers',async t=>{
  const {exportMemory,importMemory}=await import('../../server/memory-transfer.mjs');
  const {recordReceiver}=await import('./providers/record-provider.mjs');
  const {createJsonTransferReceiver,createJsonProvider}=await import('../reference-json/provider.mjs');
  const {snapshotDigest}=await import('../../server/provider-validation.mjs');
  // JSON-origin artifacts retain the exact guidance bytes needed to reconstruct
  // a standalone JSON instance; the intermediate record backend has no layout.
  const h=await jsonHost(t),memory=createMemory(h.provider),initial=await memory.open();
  const change=changeFor(initial,await records(h.provider,initial.snapshot_id,'observations'));
  await memory.publish(await memory.prepare(change));const current=await memory.open();
  const portable=recordReceiver();await importMemory(exportMemory(h.provider,[initial.snapshot_id,current.snapshot_id]),portable);
  const restored=recordHost(portable.result().get(current.snapshot_id));let received;
  const json=createJsonTransferReceiver({publish:async result=>{received=result.snapshots;return {snapshot_aliases:Object.fromEntries([...received].map(([old,s])=>[old,s.snapshot_id]))};}});
  await importMemory(exportMemory(restored.provider,[(await restored.provider.open()).snapshot_id]),json);
  const stage=[...received.values()][0],provider=createJsonProvider({instance_id:'synthetic-instance',store:{load:async()=>stage,transaction:async()=>{throw Error('Read-only staged fixture');}}});
  assert.equal(await snapshotDigest(provider,stage.snapshot_id),await snapshotDigest(restored.provider,(await restored.provider.open()).snapshot_id));
  assert.deepEqual(await createMemory(provider).audit(stage.snapshot_id),[]);
});

test('normal provider modules have no filesystem, process, adapter or host dependency',async()=>{
  const {readFileSync}=await import('node:fs');
  for(const name of ['memory-contract','provider-memory','provider-validation','memory-transfer']){
    const code=readFileSync(new URL('../../server/'+name+'.mjs',import.meta.url),'utf8');
    assert.doesNotMatch(code,/from ['"](?:node:(?:fs|path|child_process)|[^'"]*adapters\/)/);
    assert.doesNotMatch(code,/graph\.json|git (?:show|commit)|chelm/i);
  }
});

test('record provider preserves current ties, ambiguity, warnings and exact historical reads before output bounds',async()=>{
  const s=corpus(),old=s.rows.claims[0];
  s.rows.entities.push({...structuredClone(s.rows.entities[0]),id:'ent-other'});
  s.rows.claims.push({...structuredClone(old),id:'clm-tie',object:{value:'other'}});
  const h=recordHost(s),m=createMemory(h.provider),snapshot=s.meta.snapshot_id;
  const c=await m.context(snapshot,{entity_id:'ent-alpha',current:true,limit:1});
  assert.equal(c.claims.length,1);assert.equal(c.current_ties[0].tied,true);assert.equal(c.current_ties[0].selected.length,2);assert.equal(c.truncated,true);
  const exact=await m.context(snapshot,{claim_ids:['clm-old'],current:true});assert.equal(exact.current_ties[0].selected.length,2);
  assert.ok((await m.warnings(snapshot)).warnings.some(w=>w.code==='duplicate_external_id'));
  assert.equal((await m.context(snapshot,{query:'Alpha'})).entities.length,2);
});

test('paged provider results match the established JSON semantics for unchanged memory',async t=>{
  const {loadMemory}=await import('../../processor/memory-tool.mjs');
  const {retrieveContext,collectWarnings,memoryStats,validateMemory}=await import('../../server/memory-model.mjs');
  const h=await jsonHost(t),m=createMemory(h.provider),meta=await m.open(),state=await loadMemory(h.f.root);
  for(const key of ['claims','entities','sources'])state.graph[key].sort((a,b)=>a.id.localeCompare(b.id));
  for(const options of [{query:'Alpha'},{query:'First'},{entity_id:'ent-alpha',current:true},{source_id:state.graph.sources[0].id},{entity_id:'ent-alpha',predicate:'location',hops:1},{external_id:'42',scheme:'work',namespace:'team-a'},{valid_at:'2026-01-01T11:00:00.000Z',current:true}]){
    const expected=retrieveContext(state.graph,{...options,now:meta.updated_at,vocabulary:meta.policy.vocabulary}),actual=await m.context(meta.snapshot_id,options);
    for(const key of ['claims','entities','sources','truncated','method','current_selection','current_ties'])assert.deepEqual(actual[key],expected[key],JSON.stringify(options)+' '+key);
  }
  assert.deepEqual(await m.stats(meta.snapshot_id),memoryStats(state.graph,state.sources,state.ledger,state.queue));
  assert.deepEqual((await m.warnings(meta.snapshot_id)).warnings,collectWarnings(state.graph,{...state,vocabulary:meta.policy.vocabulary}));
  assert.deepEqual(await m.audit(meta.snapshot_id),validateMemory(state.graph,state));
});

test('independent provider supplies the cognition read view using bounded host counts',async()=>{
  const {createProviderReadView}=await import('../../server/cognitive-reference.mjs');
  const h=recordHost(corpus()),meta=await h.provider.open();
  const view=await createProviderReadView(h.provider,meta.snapshot_id);assert.equal(view.pending_count,1);
  assert.equal((await view.context({entity_id:'ent-alpha',current:true})).claims[0].id,'clm-old');
  assert.ok(h.calls.every(c=>c.op!=='scan'||Object.keys(c.selector).length));
});

test('semantic merge refuses conflicting entity changes and publication never reuses a read lease',async()=>{
  const {rebaseChanges}=await import('../../server/provider-memory.mjs');
  const h=recordHost(corpus()),m=createMemory(h.provider),meta=await m.open(),change=changeFor(meta,corpus().rows.observations);
  const c=await m.prepare(change);await assert.rejects(()=>m.publish(c),/lease/);
  h.advance({editEntity:true});await assert.rejects(async()=>rebaseChanges(h.provider,change,(await m.open()).snapshot_id),/Merge conflict/);
});

test('provider audit distinguishes duplicate processed IDs from integrity failures',async()=>{
  const initial=corpus(),id=initial.rows.processed[0].id;
  const good=recordHost(initial);assert.deepEqual(await createMemory(good.provider).audit(initial.meta.snapshot_id),[]);
  const duplicate=structuredClone(initial);duplicate.rows.processed.push(structuredClone(duplicate.rows.processed[0]));
  const errors=await createMemory(recordHost(duplicate).provider).audit(duplicate.meta.snapshot_id);
  assert.deepEqual(errors,['processed: duplicate/invalid ID']);
  for(const [field,value]of [['status','pending'],['source_file','inbox/wrong.md'],['source_sha256','b'.repeat(64)]]){
    const bad=structuredClone(initial);bad.rows.processed[0][field]=value;
    assert.deepEqual(await createMemory(recordHost(bad).provider).audit(bad.meta.snapshot_id),['Ledger source mismatch: '+id]);
  }
});
