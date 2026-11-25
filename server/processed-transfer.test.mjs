import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {fixture} from './test-fixtures.mjs';
import {createAdapter} from '../adapters/reference-git/adapter.mjs';
import {exportProcessed,inspectProcessed} from './processed-transfer.mjs';
import {digest,evidenceBytes,records} from './memory-contract.mjs';
import {validateSnapshot} from './provider-validation.mjs';
import {createMemory} from './provider-memory.mjs';
import {corpus,changeFor} from '../adapters/conformance/providers/corpus.mjs';
import {recordHost} from '../adapters/conformance/providers/record-provider.mjs';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const seal=b=>{const {sha256,...value}=b;return {...value,sha256:digest(value)};};
const request=(bundle,base,id='transfer-one')=>({bundle,base_snapshot:base,id,at:new Date().toISOString()});
async function host(t,{sources=[],hooks={},profile=false}={}){
  const f=fixture(t,{profile});
  for(const n of sources)f.observe(n,{body:'Synthetic zażółć 😀 record '+n+'.'});
  const adapter=createAdapter({instance:f.root,hooks});
  if(sources.length){const claim=await adapter.claim();f.analyze(claim);await adapter.commit({run:claim.run_id});}
  const provider=await adapter.openMemory({instance_id:'synthetic-'+sources.join('-')});
  return {f,adapter,provider,meta:await provider.open()};
}
async function pair(t,destinationOptions={}){
  const a=await host(t,{sources:[1,2,3]}),b=await host(t,{sources:[9],...destinationOptions});
  const bundle=await exportProcessed(a.provider,a.meta.snapshot_id,[id(2),id(1)]);
  return {a,b,bundle,req:request(bundle,b.meta.snapshot_id)};
}
function tree(f){return f.git('ls-tree','-r','HEAD');}
function untouched(f,before){assert.equal(tree(f),before.tree);assert.equal(f.git('rev-parse','HEAD'),before.head);assert.equal(f.git('status','--porcelain'),before.status);}
function before(f){return {tree:tree(f),head:f.git('rev-parse','HEAD'),status:f.git('status','--porcelain')};}
test('select two processed sources into nonempty B; retain exact analysis, history and source A',async t=>{
  const {a,b,bundle,req}=await pair(t),original=before(a.f),prior=await records(b.provider,b.meta.snapshot_id,'claims');
  assert.deepEqual(bundle.rows.observations.map(r=>r.id),[id(1),id(2)]);
  assert.deepEqual(bundle.selected,[id(1),id(2)]);
  const receipt=await b.provider.importProcessed(req),current=await b.provider.open();
  assert.equal(receipt.snapshot_id,current.snapshot_id);assert.equal(receipt.bundle_sha256,bundle.sha256);
  assert.deepEqual(await validateSnapshot(b.provider,current.snapshot_id,{previous:b.meta.snapshot_id}),[]);
  assert.equal((await b.adapter.validate()).output.valid,true);
  assert.equal((await records(b.provider,current.snapshot_id,'processed')).length,3);
  assert.deepEqual((await records(b.provider,current.snapshot_id,'claims')).filter(r=>prior.some(p=>p.id===r.id)),prior);
  for(const c of ['entities','claims','processed'])for(const row of bundle.rows[c])assert.deepEqual((await b.provider.read({snapshot:current.snapshot_id,collection:c,id:row.id})).record,row);
  for(const row of bundle.rows.observations)assert.deepEqual(await evidenceBytes(b.provider,current.snapshot_id,row.id),Buffer.from(bundle.evidence[row.id],'base64'));
  const report=await b.provider.recoverTransfer({id:req.id});assert.equal(report.bundle_sha256,bundle.sha256);assert.equal('snapshot_id' in report,false);
  const frozen=before(b.f);await assert.rejects(()=>b.provider.importProcessed({...req,id:'second-import',base_snapshot:current.snapshot_id}),new RegExp('Duplicate source ID: '+id(1)));untouched(b.f,frozen);
  const retry=await b.provider.importProcessed(req);assert.deepEqual(retry,report);untouched(b.f,frozen);untouched(a.f,original);
});
test('closure follows corrections, entity provenance, hypotheses, questions and typed journals',async()=>{
  const h=recordHost(corpus()),m=createMemory(h.provider),meta=await m.open(),change=changeFor(meta,corpus().rows.observations);h.reserve(change);await m.publish(await m.prepare(change));
  const current=await m.open(),bundle=await exportProcessed(h.provider,current.snapshot_id,[id(2)]);
  assert.equal(bundle.rows.observations.length,2);assert.equal(bundle.rows.claims.length,2);
  assert.equal(bundle.rows.questions.length,1);assert.equal(bundle.rows.hypotheses.length,1);assert.equal(bundle.rows.journals.length,1);assert.equal(bundle.rows.verification.length,1);
  await inspectProcessed(bundle);
  for(const [collection,key]of [['claims','clm-old'],['entities','ent-alpha'],['journals',change.run_id],['verification',change.attempt_id]]){
    const bad=structuredClone(bundle);bad.rows[collection]=bad.rows[collection].filter(r=>r.id!==key);await assert.rejects(()=>inspectProcessed(seal(bad)),/Missing|Invalid/);
  }
});
test('bundle corruption, edited bytes, absent journal and duplicate records refuse without writes',async t=>{
  const {b,bundle,req}=await pair(t),initial=before(b.f);
  const edits=[
    b=>{b.evidence[id(1)]='Y2hhbmdlZA==';},
    b=>{b.rows.entities.push(structuredClone(b.rows.entities[0]));},
    b=>{b.rows.claims[0].sources[0].quote='Invented assertion';},
    b=>{b.rows.artifacts=b.rows.artifacts.filter(r=>r.origin_locator!==b.rows.processed[0].run);},
    b=>{b.rows.processed[0].outputs.push('missing/output.bin');},
  ];
  for(const edit of edits){const bad=structuredClone(bundle);edit(bad);await assert.rejects(()=>b.provider.importProcessed({...req,bundle:seal(bad)}));untouched(b.f,initial);}
  const bad=structuredClone(bundle);bad.selected.reverse();await assert.rejects(()=>b.provider.importProcessed({...req,bundle:bad}),/checksum/);untouched(b.f,initial);
});
for(const kind of ['entity','claim','cross'])test('refuses '+kind+' ID collision, even identical records',async t=>{
  const {b,bundle,req}=await pair(t),graph=JSON.parse(b.f.read('memory/graph.json'));
  if(kind==='entity')graph.entities[0].id=bundle.rows.entities[0].id;
  if(kind==='claim')graph.claims[0].id=bundle.rows.claims[0].id;
  if(kind==='cross')graph.entities[0].id=bundle.rows.claims[0].id;
  b.f.write('memory/graph.json',graph);b.f.save();const initial=before(b.f);
  await assert.rejects(()=>b.provider.importProcessed({...req,base_snapshot:initial.head}),/collision/);untouched(b.f,initial);
});
test('active lease, dirty source/policy, staged changes and incompatible guidance refuse',async t=>{
  const {b,bundle}=await pair(t);b.f.observe(10);const claim=await b.adapter.claim(),current=await b.provider.open(),initial=before(b.f);
  await assert.rejects(()=>b.provider.importProcessed(request(bundle,current.snapshot_id)),/lease/);untouched(b.f,initial);
  await b.adapter['release-error']({run:claim.run_id});
  for(const path of [id(9), 'instance/purpose.md']){
    const target=path===id(9)?`inbox/${path}.md`:path,original=b.f.read(target);b.f.write(target,original+'Changed');
    const state=before(b.f);await assert.rejects(()=>b.provider.importProcessed(request(bundle,state.head)),/source|Dirty/);untouched(b.f,state);b.f.write(target,original);
  }
  b.f.write('instance/purpose.md',b.f.read('instance/purpose.md')+'Different scope');b.f.save();const state=before(b.f);
  await assert.rejects(()=>b.provider.importProcessed(request(bundle,state.head)),/guidance/);untouched(b.f,state);
});
test('final candidate validation refuses preexisting invalid destination without publication',async t=>{
  const {b,bundle}=await pair(t),graph=JSON.parse(b.f.read('memory/graph.json'));graph.claims[0].sources[0].quote='Not in original';b.f.write('memory/graph.json',graph);b.f.save();const initial=before(b.f);
  await assert.rejects(()=>b.provider.importProcessed(request(bundle,initial.head)),/Invalid combined/);untouched(b.f,initial);
});
for(const point of ['head','bytes','before','after'])test('publication fence / interruption recovery: '+point,async t=>{
  let target,trigger=false;
  const hooks={beforeMemoryPublish(){if(!trigger)return;if(point==='before')throw Error('Interrupted before CAS');if(point==='head'){target.write('concurrent.txt','Keep concurrent intake');target.save();}if(point==='bytes')target.write('instance/purpose.md',target.read('instance/purpose.md')+'Edited after validation');},afterPublish({operation}){if(trigger&&point==='after'&&operation.startsWith('processed-transfer'))throw Error('Response lost after CAS');}};
  const {a,b,bundle,req}=await pair(t,{hooks});target=b.f;trigger=true;const original=before(a.f),initial=before(b.f);
  await assert.rejects(()=>b.provider.importProcessed(req),/snapshot|Dirty|Interrupted|Response lost/);
  if(point==='after'){
    const fresh=await createAdapter({instance:b.f.root}).openMemory({instance_id:b.meta.instance_id}),receipt=await fresh.recoverTransfer({id:req.id});assert.equal(receipt.bundle_sha256,bundle.sha256);
    const head=b.f.git('rev-parse','HEAD');assert.equal((await fresh.importProcessed(req)).bundle_sha256,bundle.sha256);assert.equal(b.f.git('rev-parse','HEAD'),head);
    assert.equal((await records(fresh,head,'processed')).length,3);assert.deepEqual(await validateSnapshot(fresh,head),[]);
  }else{
    assert.equal(await b.provider.recoverTransfer({id:req.id}),null);assert.equal((await records(b.provider,(await b.provider.open()).snapshot_id,'processed')).length,1);
    if(point==='before')untouched(b.f,initial);
    if(point==='head')assert.equal(b.f.read('concurrent.txt'),'Keep concurrent intake');
  }
  untouched(a.f,original);
});
test('source selection refuses unprocessed dependencies and preserves opaque artifact bytes',async t=>{
  const {a,b,bundle,req}=await pair(t),binary=Buffer.from([0,255,13,10,65]);
  a.f.write('memory/runs/opaque.bin',binary);a.f.save();const meta=await a.provider.open(),next=await exportProcessed(a.provider,meta.snapshot_id,[id(1)]);
  const artifact=next.rows.artifacts.find(r=>r.origin_locator==='memory/runs/opaque.bin');assert.deepEqual(Buffer.from(artifact.base64,'base64'),binary);
  await b.provider.importProcessed({...req,bundle:next});
  const path=(await records(b.provider,(await b.provider.open()).snapshot_id,'artifacts')).find(r=>r.origin_locator.startsWith('memory/transfers/')).origin_locator;
  assert.deepEqual(JSON.parse(readFileSync(join(b.f.root,path),'utf8')).bundle.rows.artifacts.find(r=>r.id===artifact.id),artifact);
  a.f.observe(20);a.f.save();const pending=await a.provider.open();await assert.rejects(()=>exportProcessed(a.provider,pending.snapshot_id,[id(20)]),/Missing transfer dependency: sources/);
});

test('processed transfer can be exported again without losing archived journal resolution',async t=>{
  const {b,bundle,req}=await pair(t);await b.provider.importProcessed(req);
  const current=await b.provider.open(),next=await exportProcessed(b.provider,current.snapshot_id,[id(1)]);
  const c=await host(t);await c.provider.importProcessed(request(next,c.meta.snapshot_id,'second-hop'));
  assert.deepEqual(await validateSnapshot(c.provider,(await c.provider.open()).snapshot_id),[]);
  assert.equal((await c.adapter.validate()).output.valid,true);
});

test('staged destination changes and untracked target collisions survive rejection',async t=>{
  const {b,bundle,req}=await pair(t),path='memory/graph.json',original=b.f.read(path);
  b.f.write(path,original+'\n');b.f.git('add',path);b.f.write(path,original);
  let initial=before(b.f);await assert.rejects(()=>b.provider.importProcessed(req),/staged/);untouched(b.f,initial);
  b.f.git('reset','-q','HEAD','--',path);
  b.f.write(bundle.rows.observations[0].path,'Unfinalized local intake');initial=before(b.f);
  await assert.rejects(()=>b.provider.importProcessed(req),/local changes|source changed/);untouched(b.f,initial);
});

test('standalone CLI exports, inspects, imports and recovers the same transfer',async t=>{
  const {a,b,bundle}=await pair(t),{run}=await import('../processor/provider-tool.mjs');
  const args=h=>['--instance',h.f.root,'--instance-id',h.meta.instance_id];
  a.f.write('selection.json',{observation_ids:[id(1),id(2)]});
  const exported=await run(['export-processed',...args(a),'--snapshot',a.meta.snapshot_id,'--request',join(a.f.root,'selection.json')]);assert.deepEqual(exported,bundle);
  b.f.write('bundle.json',bundle);const inspected=await run(['inspect-processed',...args(b),'--request',join(b.f.root,'bundle.json')]);assert.deepEqual(inspected.included,[id(1),id(2)]);
  b.f.write('transfer-request.json',request(bundle,b.meta.snapshot_id,'cli-transfer'));
  const result=await run(['import-processed',...args(b),'--request',join(b.f.root,'transfer-request.json')]);assert.equal(result.id,'cli-transfer');
  assert.equal((await run(['recover-transfer',...args(b),'--key','cli-transfer'])).bundle_sha256,bundle.sha256);
});
