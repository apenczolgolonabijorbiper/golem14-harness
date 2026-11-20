import test from 'node:test';
import assert from 'node:assert/strict';
import {buildIntake,growthExperiment} from '../tools/intake-example.mjs';
import {parseSource} from '../processor/memory-tool.mjs';
const record={namespace:'https://synthetic.invalid/catalog',record:'REC-1',revision:'1',text:'Synthetic observation.'};
test('incremental intake preserves upstream context, exact bytes and source identity',()=>{
  const a=buildIntake([record]);assert.equal(a.observations.length,1);const note=a.observations[0],source=parseSource(note.path,note.text);assert.equal(source.sha256,note.sha256);assert.ok(source.body.includes('Record: REC-1\nRevision: 1\nAuthor: unknown'));assert.ok(source.origin_ref);
  const retry=buildIntake([record],a.receipts);assert.equal(retry.observations.length,0);assert.deepEqual(retry.receipts,a.receipts);
  assert.throws(()=>buildIntake([{...record,text:'Changed content'}],a.receipts),/revision changed/);
});
test('producer refuses lost upstream identity and mid-record splitting',()=>{
  assert.throws(()=>buildIntake([{text:'No ID'}]),/Missing upstream/);assert.throws(()=>buildIntake([{...record,text:'x'.repeat(5000)}]),/split semantically/);
  const a=buildIntake([record,{...record,namespace:'another'}]);assert.equal(a.observations.length,2);assert.notEqual(a.observations[0].id,a.observations[1].id);
});
test('synthetic full-history vs incremental experiment is reproducible',()=>{
  const result=growthExperiment();assert.equal(result.full_history_observations,8);assert.equal(result.incremental_observations,3);assert.equal(result.unique_revisions,3);assert.deepEqual(result.rounds.map(r=>r.emitted),[2,1,0]);
});
