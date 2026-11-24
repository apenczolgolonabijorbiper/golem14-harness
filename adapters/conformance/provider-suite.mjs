// Reusable suite: vendors supply an isolated factory implementing the host fault
// controls described in docs/MEMORY_PROVIDERS.md. This is deterministic evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createMemory,rebaseChanges} from '../../server/provider-memory.mjs';
import {records,evidenceBytes,digest} from '../../server/memory-contract.mjs';
import {exportMemory,importMemory} from '../../server/memory-transfer.mjs';
import {recordReceiver} from './providers/record-provider.mjs';
import {changeFor} from './providers/corpus.mjs';
export function providerConformance(name,factory){
  const setup=async t=>{const h=await factory(t),m=createMemory(h.provider),meta=await m.open(),observations=await records(h.provider,meta.snapshot_id,'observations');return {h,m,meta,change:changeFor(meta,observations)};};
  test(name+': record reads, missing IDs, evidence paging, exact and scoped lookup',async t=>{
    const {h,m,meta}=await setup(t),s=meta.snapshot_id;
    assert.deepEqual(await m.audit(s),[]);assert.equal(await m.read(s,'claims','missing'),null);
    const context=await m.context(s,{entity_id:'ent-alpha',limit:1,current:true});assert.equal(context.claims[0].id,'clm-old');
    const exact=await m.context(s,{external_id:'42',scheme:'work',namespace:'team-a'});assert.equal(exact.entities[0].id,'ent-alpha');
    assert.equal((await m.context(s,{external_id:'42',scheme:'work',namespace:'elsewhere'})).claims.length,0);
    assert.equal((await m.context(s,{query:'First'})).claims[0].id,'clm-old');
    assert.equal((await m.context(s,{claim_ids:['clm-old']})).claims[0].id,'clm-old');
    const id=(await records(h.provider,s,'observations'))[1].id,full=await evidenceBytes(h.provider,s,id);
    const part=await m.source(s,id,{offset:3,max_bytes:7});assert.deepEqual(Buffer.from(part.base64,'base64'),full.subarray(3,10));
    await assert.rejects(()=>m.source(s,id,{max_bytes:65537}),/range/);
    assert.equal((await m.source(s,'missing')).status,'unknown');
    assert.equal((await m.stats(s)).totals.pending,1);
  });
  test(name+': cursors bind snapshot, selector and collection; deterministic pages',async t=>{
    const {h,meta}=await setup(t),p=h.provider,s=meta.snapshot_id;
    const a=await p.scan({snapshot:s,collection:'observations',limit:1});assert.ok(a.next_cursor);
    const b=await p.scan({snapshot:s,collection:'observations',limit:1,cursor:a.next_cursor});assert.notEqual(a.items[0].id,b.items[0].id);assert.equal(b.next_cursor,null);
    await assert.rejects(()=>p.scan({snapshot:s,collection:'claims',cursor:a.next_cursor}),/Cursor/);
    await assert.rejects(()=>p.scan({snapshot:s,collection:'observations',selector:{ids:['none']},cursor:a.next_cursor}),/Cursor/);
  });
  test(name+': identical prepared retries, conflicting keys and cross-snapshot cursors',async t=>{
    const {h,m,meta,change}=await setup(t);h.reserve(change);
    const page=await h.provider.scan({snapshot:meta.snapshot_id,collection:'observations',limit:1});
    const one=await m.prepare(change),two=await m.prepare(change);assert.equal(one.candidate_id,two.candidate_id);
    await assert.rejects(()=>m.prepare({...change,at:'2026-01-02T12:00:01.000Z'}),/Idempotency/);
    await assert.rejects(()=>h.provider.scan({snapshot:one.snapshot_id,collection:'observations',limit:1,cursor:page.next_cursor}),/Cursor/);
    await m.abort(one.candidate_id);assert.equal(await m.recover(change.idempotency_key),null);
  });
  test(name+': complete isolated cycle, history, artifacts, receipt recovery and idempotency',async t=>{
    const {h,m,meta,change}=await setup(t);h.reserve(change);
    const before=await m.stats(meta.snapshot_id),candidate=await m.prepare(change);
    assert.equal((await m.read(meta.snapshot_id,'claims','clm-old')).status,'active');
    assert.equal((await m.read(meta.snapshot_id,'claims','clm-new')),null);
    assert.equal((await m.read(candidate.snapshot_id,'claims','clm-new')).object.value,'B');
    const published=await m.publish(candidate),current=await m.open();assert.notEqual(current.snapshot_id,meta.snapshot_id);
    assert.equal(published.candidate_digest,candidate.candidate_digest);assert.equal((await m.read(current.snapshot_id,'claims','clm-old')).status,'superseded');
    assert.equal((await m.read(current.snapshot_id,'claims','clm-new')).object.value,'B');
    assert.deepEqual(await m.audit(current.snapshot_id,{previous:meta.snapshot_id}),[]);
    assert.equal((await m.stats(current.snapshot_id)).totals.processed,before.totals.processed+1);
    assert.equal((await m.read(current.snapshot_id,'journals',change.run_id)).verification_id,change.attempt_id);
    assert.equal((await m.read(current.snapshot_id,'verification',change.attempt_id)).run_id,change.run_id);
    assert.equal((await m.recover(change.idempotency_key)).change_digest,candidate.change_digest);
    assert.equal((await m.publish(candidate)).change_digest,candidate.change_digest);
    await assert.rejects(()=>m.prepare({...change,at:'2026-01-02T12:00:01.000Z'}),/Idempotency/);
  });
  for(const [label,mutate,pattern]of [
    ['source changed',h=>h.changeSource(),/Source|source/],
    ['policy changed',h=>h.changePolicy(),/Policy|policy|Base/],
    ['lease expiry',h=>h.expire(),/lease/],
    ['base changed',h=>h.advance(),/Base|snapshot/],
    ['interruption before publish',h=>h.interrupt('before'),/Interrupted/],
  ])test(name+': refuses '+label+' without partial completion',async t=>{
    const {h,m,meta,change}=await setup(t);h.reserve(change);const c=await m.prepare(change);await mutate(h);
    await assert.rejects(()=>m.publish(c),pattern);assert.equal(await m.recover(change.idempotency_key),null);
    const current=await m.open();assert.equal(await m.read(current.snapshot_id,'claims','clm-new'),null);assert.equal((await m.stats(current.snapshot_id)).totals.processed,1);
  });
  test(name+': response loss recovers durable receipt and does not process twice',async t=>{
    const {h,m,change}=await setup(t);h.reserve(change);const c=await m.prepare(change);h.interrupt('after');
    await assert.rejects(()=>m.publish(c),/Response lost|Interrupted/);
    const fresh=await h.reopen(),memory=createMemory(fresh);assert.equal((await memory.recover(change.idempotency_key)).candidate_digest,c.candidate_digest);
    assert.equal((await memory.stats((await memory.open()).snapshot_id)).totals.processed,2);
  });
  test(name+': candidate mutation and forged writes cannot publish',async t=>{
    const {h,m,change}=await setup(t);h.reserve(change);const c=await m.prepare(change);
    const read=h.provider.read.bind(h.provider),scan=h.provider.scan.bind(h.provider);let changed=false;
    h.provider.scan=async args=>{const r=await scan(args);if(changed&&args.snapshot===c.snapshot_id&&args.collection==='entities')for(const e of r.items)e.label+=' forged';return r;};
    h.provider.read=async args=>{const r=await read(args);if(changed&&args.snapshot===c.snapshot_id&&args.collection==='entities'&&r.status==='found')r.record.label+=' forged';return r;};
    // Altering the candidate seal is independently refused even with a perfectly
    // valid candidate; the adversarial read then proves revalidation is live.
    await assert.rejects(()=>m.publish({...c,candidate_digest:'0'.repeat(64)}),/Candidate changed/);
    changed=true;await assert.rejects(()=>m.publish(c),/Candidate|candidate/);
    assert.equal(await m.recover(change.idempotency_key),null);
    await assert.rejects(()=>h.provider.prepare({change,writes:[],change_digest:c.change_digest}),/writes/i);
  });
  for(const [label,edit]of [
    ['exact quotes',c=>{c.operations.find(o=>o.op==='add_claim').record.sources[0].quote='Fabricated';}],
    ['attribution',c=>{c.operations.find(o=>o.op==='add_claim').record.attributed_to_id='ent-missing';}],
    ['dependency cycle',c=>{const r=c.operations.find(o=>o.op==='add_claim').record;r.depends_on=[r.id];}],
    ['missing replacement',c=>{c.operations=c.operations.filter(o=>o.op!=='add_claim');}],
    ['question closure',c=>{delete c.operations.find(o=>o.op==='put_question').record.analysis;}],
    ['hypothesis evidence',c=>{c.operations.find(o=>o.op==='put_hypothesis').record.support=['clm-missing'];}],
    ['verification pointer',c=>{c.operations=c.operations.filter(o=>o.op!=='append_verification');}],
  ])test(name+': semantic validator rejects '+label,async t=>{
    const {h,m,meta,change}=await setup(t);edit(change);h.reserve(change);await assert.rejects(()=>m.prepare(change));assert.equal((await m.open()).snapshot_id,meta.snapshot_id);
  });
  test(name+': semantic rebase and abort retain the committed snapshot',async t=>{
    const {h,m,meta,change}=await setup(t);h.reserve(change);const c=await m.prepare(change);await m.abort(c.candidate_id);
    await assert.rejects(()=>m.open(c.snapshot_id),/expired|unavailable/i);await assert.rejects(()=>m.publish(c),/expired/i);
    h.advance();const current=await m.open(),rebased=await rebaseChanges(h.provider,change,current.snapshot_id);assert.equal(rebased.base_snapshot,current.snapshot_id);
    assert.equal((await m.read(current.snapshot_id,'claims','clm-old')).status,'active');
  });
  test(name+': logical transfer preserves two snapshots, byte identities and receipts',async t=>{
    const {h,m,meta,change}=await setup(t);h.reserve(change);await m.publish(await m.prepare(change));
    const next=await m.open(),entries=[];for await(const e of exportMemory(h.provider,[meta.snapshot_id,next.snapshot_id]))entries.push(e);
    const receiver=recordReceiver(),result=await importMemory(entries,receiver);assert.equal(Object.keys(result.snapshot_aliases).length,2);
    assert.notEqual(result.snapshot_aliases[meta.snapshot_id],meta.snapshot_id);
    const restored=receiver.result().get(next.snapshot_id);assert.equal(restored.rows.receipts[0].id,change.idempotency_key);assert.equal(restored.rows.claims.length,2);
    const damaged=structuredClone(entries);damaged.find(e=>e.type==='evidence').base64='YQ==';const rejected=recordReceiver();await assert.rejects(()=>importMemory(damaged,rejected),/checksum/);assert.equal(rejected.result(),null);assert.equal(rejected.wasAborted(),true);
    const truncated=recordReceiver();await assert.rejects(()=>importMemory(entries.slice(0,-1),truncated),/Truncated/);assert.equal(truncated.result(),null);
  });
}
