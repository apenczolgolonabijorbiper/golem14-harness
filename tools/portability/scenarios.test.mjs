import test from 'node:test';
import assert from 'node:assert/strict';
import {cpSync,mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {command,python,harness} from '../../server/test-fixtures.mjs';
import {createAdapter} from '../../adapters/reference-git/adapter.mjs';
import {writeCandidate} from '../../processor/write-candidate.mjs';
import {run as memoryTool,loadMemory} from '../../processor/memory-tool.mjs';
import {mergeSnapshots} from '../../server/candidate-merge.mjs';
import {createMemory,rebaseChanges} from '../../server/provider-memory.mjs';
import {createJsonTransferReceiver} from '../../adapters/reference-json/provider.mjs';
import {exportMemory,importMemory} from '../../server/memory-transfer.mjs';
import {createCognitiveSession,validateTask,validateResult,validateLearning} from '../../server/cognitive-task.mjs';
import {verify} from './conformance.mjs';
const base=resolve(dirname(fileURLToPath(import.meta.url)),'../../portability/fixtures');
const scenarios=JSON.parse(readFileSync(join(base,'scenarios.json'))).scenarios;
const ids=new Set(scenarios.map(s=>s.id)),executed=new Set();
function scenario(id,fn){assert.ok(ids.has(id),'Missing portable scenario description: '+id);executed.add(id);test(id,fn);}
const json=v=>JSON.stringify(v,null,2)+'\n',hash=v=>createHash('sha256').update(v).digest('hex');
function template(path,bindings){let text=readFileSync(join(base,path),'utf8');for(const [key,value]of Object.entries(bindings))text=text.replaceAll('{{'+key+'}}',value);return JSON.parse(text);}
const sourceId='22222222-2222-4222-8222-222222222222';
function setup(t,mode='empty'){
  const temporary=mkdtempSync(join(tmpdir(),'golem-portable-')),root=join(temporary,'instance');
  t.after(()=>rmSync(temporary,{recursive:true,force:true,maxRetries:10,retryDelay:100}));
  cpSync(join(base,mode),root,{recursive:true});
  for(const p of ['inbox','evidence','memory/runs','memory/events','profiles'])mkdirSync(join(root,p),{recursive:true});
  const read=p=>readFileSync(join(root,p));
  const write=(p,v)=>{mkdirSync(dirname(join(root,p)),{recursive:true});writeFileSync(join(root,p),typeof v==='object'&&!Buffer.isBuffer(v)?json(v):v);};
  const git=(...args)=>command('git',['-C',root,...args]);
  git('init','-q');for(const [key,value]of Object.entries({'user.name':'Portable fixtures','user.email':'fixtures@localhost','core.autocrlf':'false','commit.gpgsign':'false','core.hooksPath':join(temporary,'no-hooks')}))git('config',key,value);
  const save=()=>{git('add','.');git('commit','-qm','Portable fixture');};save();
  const observe=()=>{const path=`inbox/${sourceId}.md`,text=readFileSync(join(base,`pending/${sourceId}.md`),'utf8');write(path,text);return {path,text,sha256:hash(text),id:sourceId};};
  return {temporary,root,read,write,git,save,observe};
}
scenario('portable-goldens',async()=>{const r=await verify();assert.ok(r.cases.length>=35);});
scenario('init-index',t=>{
  const f=setup(t),destination=join(f.temporary,'fresh');
  python([join(harness,'processor/init-instance.py'),'--root',destination]);
  for(const p of ['instance/purpose.md','memory/index.md','questions/queue.md','memory/processing-lock.json'])assert.deepEqual(readFileSync(join(destination,p)),f.read(p));
  assert.throws(()=>python([join(harness,'processor/init-instance.py'),'--root',destination]),/absent or empty/);
  const original=f.observe(),lease=f.read('memory/processing-lock.json'),ledger=f.read('memory/processed.json');
  for(const vector of JSON.parse(readFileSync(join(base,'index-cases.json')))){
    f.write(original.path,vector.source_utf8);
    const output=python([join(harness,'processor/process.py'),'--root',f.root]);assert.equal(output,vector.expected_stdout.trim());
    assert.equal(f.read(`evidence/${sourceId}.json`).toString(),vector.expected_evidence_utf8);
    rmSync(join(f.root,`evidence/${sourceId}.json`));
  }
  python([join(harness,'processor/process.py'),'--root',f.root]);
  const output=f.read(`evidence/${sourceId}.json`),e=JSON.parse(output);
  assert.equal(e.sha256,hash(f.read(original.path)));assert.equal(e.text,'Beta ships.');assert.equal(e.interpretation,'not_inferred');
  f.write('evidence/.golem-index-orphan.tmp','unfinished');
  python([join(harness,'processor/process.py'),'--root',f.root]);
  assert.deepEqual(f.read(`evidence/${sourceId}.json`),output);assert.equal(existsSync(join(f.root,'evidence/.golem-index-orphan.tmp')),false);
  assert.deepEqual(f.read('memory/processing-lock.json'),lease);assert.deepEqual(f.read('memory/processed.json'),ledger);
});
function changeFor(f,batch){return template('writer/change.json.tpl',{RUN:batch.run_id,GRAPH_SHA256:hash(f.read('memory/graph.json')),INDEX_SHA256:hash(f.read('memory/index.md'))});}
scenario('draft-transaction',async t=>{
  const f=setup(t);f.observe();const a=createAdapter({instance:f.root}),batch=await a.claim();
  const lease=(await a.status()).lease;assert.equal(lease.run_id,batch.run_id);await a.renew({run:batch.run_id});
  const change=changeFor(f,batch),head=f.git('rev-parse','HEAD'),ledger=f.read('memory/processed.json');
  assert.equal((await writeCandidate({root:f.root,changes:change})).mode,'preview');assert.equal(f.git('status','--porcelain').includes('memory/graph.json'),false);
  const draft=await writeCandidate({root:f.root,changes:change,apply:true});assert.equal(draft.mode,'draft-written');
  const render=name=>readFileSync(join(base,'writer',name),'utf8').replaceAll('{{RUN}}',batch.run_id).replaceAll('{{STARTED}}',lease.claimed_at).replaceAll('{{GUIDANCE}}',batch.guidance_identity);
  assert.equal(f.read(`memory/runs/${batch.run_id}.md`).toString(),render('journal.md.tpl'));
  assert.equal(f.read('memory/index.md').toString(),render('index.md.tpl'));
  assert.deepEqual(f.read('memory/graph.json'),readFileSync(join(base,'writer/graph.json')));
  const checked=await a.validate({run:batch.run_id,outputs:[]});assert.equal(checked.output.valid,true);assert.equal(f.git('rev-parse','HEAD'),head);assert.deepEqual(f.read('memory/processed.json'),ledger);
  const completed=await a.commit({run:batch.run_id,outputs:[]});assert.equal(completed.status,'committed');
  assert.equal((await memoryTool(['stats','--root',f.root])).totals.processed,1);assert.equal((await a.claim()).status,'no-work');
  assert.equal((await a.validate()).output.valid,true);
});
scenario('recovery-and-ownership',async t=>{
  const f=setup(t);f.observe();let interrupted=false;
  const a=createAdapter({instance:f.root,hooks:{afterPublish({operation}){if(operation.startsWith('complete')){interrupted=true;throw Error('response lost after CAS');}}}}),batch=await a.claim();
  await assert.rejects(a.renew({run:'00000000-0000-4000-8000-000000000000'}),/own/);
  await writeCandidate({root:f.root,changes:changeFor(f,batch),apply:true});
  await assert.rejects(a.commit({run:batch.run_id}),/response lost/);assert.ok(interrupted);
  const head=f.git('rev-parse','HEAD');assert.equal((await a.status()).recovery_required,true);
  const fresh=createAdapter({instance:f.root});assert.equal((await fresh.claim()).status,'no-work');assert.equal(f.git('rev-parse','HEAD'),head);assert.equal((await fresh.status()).recovery_required,false);
  const g=setup(t);g.observe();const b=createAdapter({instance:g.root}),owned=await b.claim();await b['release-error']({run:owned.run_id});assert.equal((await b.status()).ready.length,1);
});
scenario('concurrent-claim',async t=>{
  const f=setup(t);f.observe();
  // Block the first process after its claim CAS, while it still owns the mutex.
  // The second contender must actually hit that lock, independent of scheduling.
  const gated=`import {createAdapter} from './adapters/reference-git/adapter.mjs';
    import {readSync} from 'node:fs';
    const a=createAdapter({instance:process.argv[1],hooks:{afterPublish(){
      process.stdout.write('READY\\n');readSync(0,Buffer.alloc(1),0,1,null);
    }}});console.log(JSON.stringify(await a.claim()));`;
  const owner=spawn(process.execPath,['--input-type=module','-e',gated,f.root],{cwd:harness,stdio:['pipe','pipe','pipe'],timeout:60000});
  t.after(()=>{if(owner.exitCode===null)owner.kill();});
  let output='',diagnostic='';
  const completed=new Promise((done,reject)=>{
    owner.on('error',reject);owner.stdout.on('data',b=>output+=b);owner.stderr.on('data',b=>diagnostic+=b);
    owner.on('close',(code,signal)=>signal?reject(Error('Claim owner timed out')):done({code,out:output,err:diagnostic}));
  });
  // Attach a rejection handler before awaiting readiness, including on timeout.
  completed.catch(()=>{});
  await new Promise((done,reject)=>{
    const timer=setTimeout(()=>reject(Error('Claim owner did not reach publication gate')),20000);
    const cleanup=()=>{clearTimeout(timer);owner.stdout.off('data',data);owner.off('close',closed);owner.off('error',failed);};
    const data=()=>{if(output.includes('READY\n')){cleanup();done();}};
    const closed=()=>{cleanup();reject(Error('Claim owner exited before gate: '+diagnostic));};
    const failed=e=>{cleanup();reject(e);};
    owner.stdout.on('data',data);owner.once('close',closed);owner.once('error',failed);
  });
  const competitor=await new Promise((done,reject)=>{
    const p=spawn(process.execPath,[join(harness,'adapters/reference-git/adapter.mjs'),'claim','--instance',f.root],{stdio:['ignore','pipe','pipe'],timeout:60000});
    let out='',err='';p.stdout.on('data',b=>out+=b);p.stderr.on('data',b=>err+=b);p.on('error',reject);
    p.on('close',(code,signal)=>signal?reject(Error('Claim contender timed out')):done({code,out,err}));
  });
  assert.equal(competitor.code,1);assert.match(competitor.err,/Another local adapter operation/);
  owner.stdin.end('\n');const result=await completed;
  assert.equal(result.code,0,result.err);const claimed=JSON.parse(result.out.slice(result.out.indexOf('\n')+1));
  assert.equal((await createAdapter({instance:f.root}).status()).lease.run_id,claimed.run_id);
  await assert.rejects(createAdapter({instance:f.root}).claim(),/unexpired processing lease/);
});
scenario('profile-and-source',async t=>{
  const f=setup(t),s=setup(t);s.write('profiles/core.md','Reviewed domain rules.\n');s.write('golem.config.json',{schema_version:1,profile:{path:'profiles/core.md'}});s.write('purpose.md','Reviewed purpose.\n');
  const a=createAdapter({instance:f.root});assert.equal((await a['profile-status']({source:s.root})).state,'not-installed');assert.equal((await a['profile-install']({source:s.root})).status,'installed');
  assert.equal((await a['profile-status']({source:s.root})).state,'in-sync');assert.equal((await a['profile-install']({source:s.root})).status,'unchanged');
  assert.equal((await memoryTool(['profile-check','--root',f.root,'--source',s.root])).state,'selected');
  const bridge=JSON.parse(command(process.execPath,[join(harness,'processor/source-bundle.mjs'),s.root,'']));assert.equal(Buffer.from(bridge.files['instance/purpose.md'],'base64').toString(),'Reviewed purpose.\n');
});
scenario('merge-snapshots',async t=>{
  const f=setup(t,'instance'),ours=join(f.temporary,'ours'),theirs=join(f.temporary,'theirs'),out=join(f.temporary,'out');
  for(const p of [ours,theirs])cpSync(join(base,'instance'),p,{recursive:true});
  const r=await mergeSnapshots({base:f.root,ours,theirs,out});assert.deepEqual(r.conflicts,[]);assert.equal(r.merged.claims,1);assert.deepEqual(readFileSync(join(out,'inbox/11111111-1111-4111-8111-111111111111.md')),f.read('inbox/11111111-1111-4111-8111-111111111111.md'));
  assert.equal(existsSync(join(out,'memory/processing-lock.json')),false);
  const again=await mergeSnapshots({base:f.root,ours,theirs,out});assert.equal(again.conflicts[0].kind,'merge_refused');
});
scenario('provider-cycle-transfer',async t=>{
  const f=setup(t,'instance');const s=f.observe();const a=createAdapter({instance:f.root}),batch=await a.claim({required_capabilities:['memory-provider-v1']});
  const p=await a.openMemory({instance_id:'portable'}),m=createMemory(p),meta=await m.open(),snapshot=meta.snapshot_id;
  assert.equal((await p.describe()).provider_version,1);assert.equal((await p.counts({snapshot})).observations,2);
  assert.equal((await p.read({snapshot,collection:'claims',id:'missing'})).status,'unknown');
  const page=await p.scan({snapshot,collection:'observations',limit:1});assert.ok(page.next_cursor);assert.equal((await p.scan({snapshot,collection:'observations',limit:1,cursor:page.next_cursor})).next_cursor,null);
  await assert.rejects(p.scan({snapshot,collection:'claims',cursor:page.next_cursor}),/Cursor/);
  assert.equal((await m.source(snapshot,s.id,{max_bytes:3})).total_bytes,Buffer.byteLength(s.text));
  assert.equal((await m.context(snapshot,{query:'alpha'})).claims.length,1);assert.equal((await m.stats(snapshot)).totals.pending,1);assert.deepEqual(await m.audit(snapshot),[]);assert.ok(Array.isArray((await m.warnings(snapshot)).warnings));
  const change=template('provider/change.json.tpl',{SNAPSHOT:snapshot,POLICY:meta.policy_id,RUN:batch.run_id});
  assert.deepEqual(await rebaseChanges(p,change,snapshot),change);
  const first=await m.prepare(change);await m.abort(first.candidate_id);assert.equal(await m.recover(change.idempotency_key),null);
  const c=await m.prepare(change),receipt=await m.publish(c);assert.equal((await m.recover(change.idempotency_key)).change_digest,receipt.change_digest);
  const now=await m.open();assert.deepEqual(await m.audit(now.snapshot_id,{previous:snapshot}),[]);assert.equal((await m.stats(now.snapshot_id)).totals.processed,2);
  const stream=[];for await(const row of exportMemory(p,[now.snapshot_id]))stream.push(row);
  let saved;const receiver=createJsonTransferReceiver({publish:async r=>{saved=r;return {status:'imported'};}});assert.deepEqual(await importMemory(stream,receiver),{status:'imported'});assert.equal(saved.snapshots.size,1);
  const bad=structuredClone(stream);bad[1].logical_digest='0'.repeat(64);let aborted=false;
  await assert.rejects(importMemory(bad,createJsonTransferReceiver({publish:async()=>assert.fail('Corrupt stream published'),abort:async()=>{aborted=true;}})),/checksum/);assert.ok(aborted);
});
scenario('cognition-and-learning',async t=>{
  const f=setup(t,'instance'),a=createAdapter({instance:f.root}),view=await a.openCognition({instance_id:'portable'});
  const task={protocol_version:1,task_id:'task-portable',conversation_id:'conversation-portable',binding:view.binding,mode:'propose_learning',messages:[{id:'u1',author:'user',kind:'user_question',text:'What ships?',reply_to:[],intent:{category:'ask',origin:'user',basis:'explicit',description:'Retrieve source-backed answer.',uncertainty:[]}}],scope:{subject_ids:[],valid_at:null},limits:{rounds:2,context_requests:4,claims:10,source_bytes:4000,expansion_budget:100,elapsed_ms:10000}};
  assert.deepEqual(validateTask(task),[]);const session=createCognitiveSession(task,view,{now:()=>0});session.beginRound();const c=await session.context({query:'alpha'}),s=await session.source(c.sources[0].id);const trusted=session.receipt();
  const result={protocol_version:1,task_id:task.task_id,binding:task.binding,outcome:'answer',answer:'Alpha ships.',findings:[{id:'finding1',classification:'source_assertion',text:'Alpha ships.',claim_ids:['claim-alpha'],premise_ids:[],evidence:[{source_id:s.id,sha256:s.sha256,start:0,quote:s.text}],uncertainty:[]}],questions:[],uncertainty:[],stop_reason:'complete',coverage:trusted.coverage,usage:trusted.usage,model:{requested:null,observed:null,configuration:'Synthetic; no inference',cost:null}};
  assert.deepEqual(validateResult(result,task,trusted),[]);assert.equal(session.finish(result).usage.source_bytes,Buffer.byteLength(s.text));
  const proposal={protocol_version:1,proposal_id:'learn-portable',task_id:task.task_id,binding:task.binding,operation:'add_hypothesis',target_id:null,hypothesis_id:'hyp-portable',statement:'Alpha may need review.',support:['claim-alpha'],refutation:[],uncertainty:['Not checked'],rationale:'Follow up.',verification_needed:['Review Alpha']};
  assert.deepEqual(validateLearning(proposal,task,trusted),[]);await assert.rejects(a.publishLearning({task,proposal}),/authorized/);
  const authorization={allowed:true,task_id:task.task_id,proposal_id:proposal.proposal_id,reference:'Synthetic host permission'};
  assert.equal((await a.publishLearning({task,proposal,authorization})).status,'published');assert.equal((await a.publishLearning({task,proposal,authorization})).status,'already_published');
  const budget=createCognitiveSession({...task,limits:{...task.limits,rounds:1}},view,{now:()=>0});budget.beginRound();assert.throws(()=>budget.beginRound(),/budget/);
});
test('all scenario descriptions execute',()=>assert.deepEqual([...executed].sort(),[...ids].sort()));
