import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createCognitiveSession,validateTask,validateResult,validateLearning} from './cognitive-task.mjs';
import {createAdapter} from '../adapters/reference-git/adapter.mjs';
import {fixture} from './test-fixtures.mjs';
const binding={instance_id:'synthetic',snapshot_id:'opaque-1',guidance_id:'guidance-1'};
const intent=(origin='user')=>({category:'ask',origin,basis:'explicit',description:'Ask for synthetic evidence.',uncertainty:[]});
const message=(id,kind='user_question',author='user',reply_to=[])=>({id,kind,author,reply_to,text:'Where is the synthetic switch?',intent:intent(author)});
export const task=()=>({protocol_version:1,task_id:'task-1',conversation_id:'conversation-1',binding:{...binding},mode:'read_only',messages:[message('u1')],scope:{subject_ids:[],valid_at:null},limits:{rounds:3,context_requests:8,claims:10,source_bytes:4000,expansion_budget:100,elapsed_ms:10000}});
const source={id:'00000000-0000-4000-8000-000000000001',text:'The synthetic switch is in Room A.',start:0,sha256:createHash('sha256').update('immutable-source').digest('hex')};
const claim={id:'clm-one',subject_id:'ent-one',attributed_to_id:'ent-one',predicate:'located_at',object:{value:'Room A'},classification:'source_assertion',sources:[{observation_id:source.id,quote:source.text}],status:'active',asserted_at:'2026-01-01T00:00:00Z',valid_time:{from:null,to:null,expression:null,precision:'unknown'},supersedes:[],uncertainty:[],created_at:'2026-01-01T00:00:00Z'};
// Independent record-based test host. No graph.json, Git, directory layout or named host.
const view=()=>({binding:{...binding},pending_count:2,async context(options){return {protocol_version:1,binding:{...binding},request_id:'r1',claims:options.query==='absent'?[]:[structuredClone(claim)],entities:[],sources:options.query==='absent'?[]:[{id:source.id,sha256:source.sha256,recorded_at:'2026-01-01T00:00:00Z'}],dependencies:[],selection:{current:false,alternatives:[],hidden:{},knowledge:'current snapshot'},warnings:['Pending intake is not analyzed.'],truncated:false,truncation_reasons:[],pending_count:2,valid_at:options.valid_at??null,method:'record-key'};},async source(id,options){return {...source,text:source.text.slice(options.start,options.start+options.length),start:options.start,binding:{...binding},truncated:false};}});
const finding=()=>({id:'f1',classification:'source_assertion',text:source.text,claim_ids:[claim.id],premise_ids:[],evidence:[{source_id:source.id,sha256:source.sha256,quote:source.text,start:0}],uncertainty:[]});
function result(t,trusted){return {protocol_version:1,task_id:t.task_id,binding:t.binding,outcome:'answer',answer:source.text,findings:[finding()],questions:[],uncertainty:[],stop_reason:'complete',coverage:trusted.coverage,usage:trusted.usage,model:{requested:null,observed:null,configuration:'synthetic scripted fixture; no inference',cost:null}};}
async function delivered(t=task(),v=view()){const s=createCognitiveSession(t,v,{now:()=>0});s.beginRound();await s.context();await s.source(source.id);return {s,trusted:s.receipt(),t};}
test('independent record host supports grounded answer, no state mutation and zero hits',async()=>{
  const {s,trusted,t}=await delivered();assert.deepEqual(validateResult(result(t,trusted),t,trusted),[]);s.finish(result(t,trusted));
  const empty=await s.context({query:'absent'});assert.equal(empty.claims.length,0);assert.equal(empty.pending_count,2);
});
test('messages allow question-question-answer-answer and Golem clarification with explicit links',()=>{
  const t=task();t.messages=[message('u1'),message('g1','cognitive_question','golem',['u1']),message('g2','cognitive_question','golem',['u1']),message('u2','question_answer','user',['g2']),message('u3','question_answer','user',['g1','g2'])];assert.deepEqual(validateTask(t),[]);
  t.messages[4].reply_to=['unknown'];assert.ok(validateTask(t).length);
  t.messages[0].intent.basis='inferred';assert.ok(validateTask(t).some(e=>e.includes('uncertainty')));
});
test('integrity rejects forged identity, quote, premise cycles and lost coverage',async()=>{
  const {t,trusted}=await delivered();
  for(const mutate of [r=>r.binding.snapshot_id='other',r=>r.binding.instance_id='other',r=>r.binding.guidance_id='other',r=>r.findings[0].claim_ids=['other'],r=>r.findings[0].evidence[0].quote='forgery',r=>r.findings[0].evidence[0].start=1,r=>r.findings[0].premise_ids=['f1'],r=>r.coverage.pending_count=0,r=>r.usage.context_requests=0,r=>r.findings[0].unexpected=true]){
    const r=structuredClone(result(t,trusted));mutate(r);assert.ok(validateResult(r,t,trusted).length);
  }
  const r=result(t,trusted);r.findings.push({...finding(),id:'f2',classification:'derived_conclusion',premise_ids:['f1'],evidence:[],claim_ids:[]});assert.deepEqual(validateResult(r,t,trusted),[]);
});
test('budgets, cancellation, mixed snapshots, missing sources and hostile options fail closed',async()=>{
  const t=task();t.limits.context_requests=1;const s=createCognitiveSession(t,view(),{now:()=>0});await s.context();await assert.rejects(s.context(),/budget/);
  assert.throws(()=>createCognitiveSession(task(),view(),{cancelled:()=>true}).beginRound(),/cancelled/);
  const changed=view();changed.source=async()=>({...source,binding:{...binding,snapshot_id:'other'}});const x=createCognitiveSession(task(),changed);await x.context();await assert.rejects(x.source(source.id),/binding/);
  const y=createCognitiveSession(task(),view());await assert.rejects(y.context({__proto_option:'exec'}),/Unsupported/);await assert.rejects(y.source('../secrets'),/not retrieved/);
  const u=task();u.limits.rounds=1;const z=createCognitiveSession(u,view());z.beginRound();assert.throws(()=>z.beginRound(),/budget/);
});
const proposal=t=>({protocol_version:1,proposal_id:'learn-1',task_id:t.task_id,binding:t.binding,operation:'add_hypothesis',target_id:null,hypothesis_id:'hyp-synthetic',statement:'The synthetic switch may need inspection.',support:[],refutation:[],uncertainty:['Not checked.'],rationale:'A bounded follow-up.',verification_needed:['Inspect the switch.']});
test('learning remains separate; read-only and dangling premises rejected',async()=>{
  const {t,trusted}=await delivered();assert.ok(validateLearning(proposal(t),t,trusted).length);t.mode='propose_learning';assert.deepEqual(validateLearning(proposal(t),t,trusted),[]);
  const p=proposal(t);p.support=['missing'];assert.ok(validateLearning(p,t,trusted).length);
});
test('reference snapshot ignores dirty files and read-only operations preserve instance tree and HEAD',async t=>{
  const f=fixture(t),a=createAdapter({instance:f.root}),before=f.git('status','--porcelain'),head=f.git('rev-parse','HEAD');
  const v=await a.openCognition({instance_id:'synthetic'});const tsk=task();tsk.binding=v.binding;const s=createCognitiveSession(tsk,v);assert.equal((await s.context()).claims.length,0);assert.equal(f.git('status','--porcelain'),before);assert.equal(f.git('rev-parse','HEAD'),head);
  f.write('instance/purpose.md','Dirty guidance');const old=await a.openCognition({instance_id:'synthetic'});assert.deepEqual(old.binding,v.binding);
});
test('reviewed learning is transactional, idempotent, preserves correction history and rejects stale tasks',async t=>{
  const f=fixture(t),a=createAdapter({instance:f.root}),v=await a.openCognition({instance_id:'synthetic'}),tsk=task();tsk.binding=v.binding;tsk.mode='propose_learning';
  const p=proposal(tsk),auth={allowed:true,task_id:tsk.task_id,proposal_id:p.proposal_id,reference:'existing user authorization'};
  await assert.rejects(a.publishLearning({task:tsk,proposal:p}),/authorized/);
  const graph=f.read('memory/graph.json'),ledger=f.read('memory/processed.json'),lease=f.read('memory/processing-lock.json');
  assert.equal((await a.publishLearning({task:tsk,proposal:p,authorization:auth})).status,'published');assert.equal((await a.publishLearning({task:tsk,proposal:p,authorization:auth})).status,'already_published');
  assert.equal(f.read('memory/graph.json'),graph);assert.equal(f.read('memory/processed.json'),ledger);assert.equal(f.read('memory/processing-lock.json'),lease);
  const stale={...p,proposal_id:'learn-stale',hypothesis_id:'hyp-stale'};await assert.rejects(a.publishLearning({task:tsk,proposal:stale,authorization:{...auth,proposal_id:stale.proposal_id}}),/mismatch/);
  tsk.binding=(await a.openCognition({instance_id:'synthetic'})).binding;const correction={...p,proposal_id:'learn-2',binding:tsk.binding,operation:'correct_hypothesis',target_id:p.hypothesis_id,hypothesis_id:'hyp-correction',statement:'The inspection should be deferred pending access.'};
  await a.publishLearning({task:tsk,proposal:correction,authorization:{...auth,proposal_id:correction.proposal_id}});
  const hs=JSON.parse(f.read('memory/hypotheses.json')).hypotheses;assert.equal(hs[0].statement,p.statement);assert.equal(hs[0].status,'withdrawn');assert.equal(hs[1].confidence,null);
});

import {readFileSync} from 'node:fs';
import {createMemoryReadView} from './cognitive-reference.mjs';
import {prepare,evaluate} from '../tools/evaluate-cognition.mjs';
function referenceState(){
  const at='2026-01-02T12:00:00Z';
  const sources=Object.fromEntries([1,2,3].map(n=>{const id=`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,text=n===3?'Żółć synthetic evidence.':`Room capacity is ${n===1?12:15}.`;return [id,{id,path:`inbox/${id}.md`,body:text,sha256:createHash('sha256').update(text).digest('hex'),recorded_at:at}];}));
  const ids=Object.keys(sources),graph={schema_version:2,updated_at:at,sources:Object.values(sources).map(({id,path,sha256,recorded_at})=>({id,path,sha256,recorded_at})),entities:[{id:'ent-one',type:'other',label:'Alpha',aliases:[],source_ids:ids,created_at:at,uncertainty:[]}],claims:ids.map((id,i)=>({...structuredClone(claim),id:'clm-'+(i+1),subject_id:'ent-one',attributed_to_id:'ent-one',object:{value:i===0?12:i===1?15:'note'},predicate:i===2?'note':'capacity',sources:[{observation_id:id,quote:sources[id].body}],asserted_at:at,created_at:at,valid_time:{from:i===0?'2026-01-01T00:00:00Z':'2026-01-02T00:00:00Z',to:null,expression:null,precision:'exact'},...(i===0?{depends_on:['clm-3']}:{})}))};
  return {graph,sources,ledger:{schema_version:1,observations:ids.map(id=>({id,status:'processed',source_file:sources[id].path,source_sha256:sources[id].sha256}))},queue:{schema_version:1,questions:[]},hypotheses:{schema_version:1,updated_at:at,hypotheses:[]}};
}
test('JSON reference reuses exact IDs, dependency follow-up, scoped/as-of retrieval and immutable UTF-8 ranges',async()=>{
  const state=referenceState(),v=createMemoryReadView({binding,state,guidance:{vocabulary:{schema_version:2,single_valued:['capacity']}}});
  const base={limit:10,expansion_budget:100};
  const limited=await v.context({...base,claim_ids:['clm-1'],limit:1});assert.equal(limited.claims.length,1);assert.equal(limited.truncated,true);assert.deepEqual(limited.dependencies[0].premise_ids,['clm-3']);
  assert.equal((await v.context({...base,claim_ids:['clm-3']})).claims[0].id,'clm-3');
  assert.equal((await v.context({...base,claim_ids:['clm-1'],current:true})).claims.length,0);
  assert.equal((await v.context({...base,claim_ids:['clm-1'],current:false})).claims.length,1);
  const current=await v.context({...base,entity_id:'ent-one',current:true});assert.equal(current.claims.find(c=>c.predicate==='capacity').object.value,15);assert.ok(current.selection.alternatives.some(a=>a.alternatives.includes('clm-1')));
  const past=await v.context({...base,valid_at:'2026-01-01T12:00:00Z'});assert.equal(past.claims[0].object.value,12);
  assert.equal((await v.context({...base,subject_ids:['ent-unknown']})).claims.length,0);
  limited.claims[0].object.value='mutated';state.graph.claims[0].object.value='outside mutation';assert.equal((await v.context({...base,claim_ids:['clm-1']})).claims[0].object.value,12);
  const sid=Object.keys(state.sources)[2],source=await v.source(sid,{start:0,length:100,max_bytes:3});assert.equal(source.text,'Ż');assert.equal(source.truncated,true);assert.equal(source.sha256,state.sources[sid].sha256);
  const broken=referenceState();broken.sources[Object.keys(broken.sources)[0]].body='changed';assert.throws(()=>createMemoryReadView({binding,state:broken,guidance:{}}),/Invalid committed/);
});
test('context schema preserves canonical record definitions and evaluation cannot certify missing model results',()=>{
  const context=JSON.parse(readFileSync(new URL('../schemas/cognitive-context.schema.json',import.meta.url))),graph=JSON.parse(readFileSync(new URL('../schemas/memory-graph.schema.json',import.meta.url)));assert.deepEqual(context.$defs,graph.$defs);
  const input=prepare(),report=evaluate(input,{results:[]});assert.equal(input.cases.length,18);assert.equal(report.verified,false);assert.equal(report.reports.length,18);assert.ok(report.reports.every(r=>r.semantic_verdict==='not_run'));
});

test('committed reference answer path retains exact sources and separates pending intake without consuming it',async t=>{
  const f=fixture(t),a=createAdapter({instance:f.root});const observed=f.observe(1,{body:'The synthetic room has 12 seats.'});
  const batch=await a.claim();f.analyze(batch);await a.commit({run:batch.run_id});
  f.observe(2,{body:'Unprocessed room inspection draft.'});f.save();
  const head=f.git('rev-parse','HEAD'),ledger=f.read('memory/processed.json'),lease=f.read('memory/processing-lock.json'),queue=f.read('questions/queue.json'),status=f.git('status','--porcelain');
  const v=await a.openCognition({instance_id:'synthetic'}),tsk=task();tsk.binding=v.binding;const s=createCognitiveSession(tsk,v,{now:()=>0});s.beginRound();const c=await s.context({query:'seats'});
  assert.equal(c.claims.length,1);assert.equal(c.pending_count,1);const original=await s.source(observed.id);assert.equal(original.sha256,observed.sha256);assert.equal(original.text,observed.body);
  assert.equal(f.git('rev-parse','HEAD'),head);assert.equal(f.git('status','--porcelain'),status);assert.equal(f.read('memory/processed.json'),ledger);assert.equal(f.read('memory/processing-lock.json'),lease);assert.equal(f.read('questions/queue.json'),queue);
});
test('multiple independent premises remain distinct in a derived finding and result questions carry Golem intent',async()=>{
  const {t,trusted}=await delivered();trusted.claims.push({...structuredClone(claim),id:'clm-two'});const r=result(t,trusted);r.findings.push({...finding(),id:'f2',claim_ids:['clm-two']},{id:'f3',classification:'derived_conclusion',text:'A conclusion from both premises.',claim_ids:[],premise_ids:['f1','f2'],evidence:[],uncertainty:['Premise independence still needs semantic review.']});
  r.questions=[{id:'g1',kind:'cognitive_question',origin:'golem',text:'Can this premise be independently checked?',reply_to:['u1'],premise_ids:['f3'],intent:{...intent('golem'),category:'verify'}}];assert.deepEqual(validateResult(r,t,trusted),[]);
  r.findings[0].premise_ids=['f3'];assert.ok(validateResult(r,t,trusted).some(e=>e.includes('cycle')));
});

test('Golem can propose a hypothesis-driven check without an initial user question',()=>{
  const t=task();t.messages=[message('h1','hypothesis','golem'),message('g1','cognitive_question','golem',['h1'])];t.messages[1].intent.category='verify';assert.deepEqual(validateTask(t),[]);
});

import {command,harness} from './test-fixtures.mjs';
import {join} from 'node:path';
test('packaged JSON-lines reference host discovers guidance and supports a bound read-only invocation',async t=>{
  const f=fixture(t),a=createAdapter({instance:f.root}),v=await a.openCognition({instance_id:'synthetic'}),tsk=task();tsk.binding=v.binding;
  const input=[{instance_id:'synthetic'},{task:tsk},{operation:'round'},{operation:'context',options:{query:'absent'}},{operation:'receipt'}].map(x=>JSON.stringify(x)).join('\n')+'\n';
  const head=f.git('rev-parse','HEAD'),rows=command(process.execPath,[join(harness,'processor/cognitive-tool.mjs'),'--instance',f.root],{input}).split('\n').map(x=>JSON.parse(x));
  assert.deepEqual(rows[0].result.binding,v.binding);assert.ok(rows[0].result.guidance.guidance);assert.equal(rows[3].result.claims.length,0);assert.equal(rows[4].result.usage.context_requests,1);assert.equal(f.git('rev-parse','HEAD'),head);assert.equal(f.git('status','--porcelain'),'');
});

test('cognitive retrieval keeps ambiguous labels distinct and bounds ordered multi-hop expansion', async () => {
  const state = referenceState();
  const {graph} = state;
  const alpha = graph.entities[0];
  graph.entities.push(
    {...alpha, id: 'ent-other-alpha'},
    {...alpha, id: 'ent-intermediate', label: 'Intermediate'},
    {...alpha, id: 'ent-destination', label: 'Destination'},
  );
  delete graph.claims[0].depends_on;
  graph.claims[0].object = {entity_id: 'ent-intermediate'};
  graph.claims[1].subject_id = 'ent-intermediate';
  graph.claims[1].object = {entity_id: 'ent-destination'};
  graph.claims[2].subject_id = 'ent-other-alpha';
  const view = createMemoryReadView({binding, state, guidance: {}});
  const session = createCognitiveSession(task(), view, {now: () => 0});
  session.beginRound();

  const ambiguous = await session.context({query: 'Alpha', hops: 1});
  assert.deepEqual(ambiguous.entities.filter(entity => entity.label === 'Alpha').map(entity => entity.id).sort(),
    ['ent-one', 'ent-other-alpha']);
  const scoped = {entity_id: 'ent-one', hops: 2};
  const oneHop = await session.context({...scoped, hops: 1});
  assert.deepEqual(oneHop.claims.map(claim => claim.id), ['clm-1']);
  const twoHops = await session.context(scoped);
  assert.deepEqual(twoHops.claims.map(claim => claim.id), ['clm-1', 'clm-2']);
  assert.equal(twoHops.truncated, false);

  const bounded = await session.context({...scoped, limit: 1});
  assert.deepEqual(bounded.claims.map(claim => claim.id), ['clm-1']);
  assert.deepEqual(bounded.truncation_reasons, ['claim_limit']);
  assert.deepEqual(await session.context({...scoped, limit: 1}), bounded);
});
