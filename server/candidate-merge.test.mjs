import test from 'node:test';
import assert from 'node:assert/strict';
import {cpSync,readFileSync,writeFileSync,mkdirSync,readdirSync,existsSync,symlinkSync,rmSync,realpathSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {fixture,command,harness} from './test-fixtures.mjs';
import {mergeSnapshots} from './candidate-merge.mjs';
import {run} from '../processor/memory-tool.mjs';
const read=(root,path)=>JSON.parse(readFileSync(join(root,path),'utf8'));
const write=(root,path,value)=>{mkdirSync(dirname(join(root,path)),{recursive:true});writeFileSync(join(root,path),typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value,null,2)+'\n');};
function add(root,source,n){
  const graph=read(root,'memory/graph.json'),at=new Date().toISOString(),entity='ent-'+n;
  graph.updated_at=at;graph.sources.push({id:source.id,path:source.path,sha256:source.sha256,recorded_at:source.recorded_at});
  graph.entities.push({id:entity,type:'other',label:'Synthetic record',aliases:[],source_ids:[source.id],created_at:at,uncertainty:[]});
  graph.claims.push({id:'clm-'+n,subject_id:entity,attributed_to_id:entity,predicate:'describes',object:{value:'Synthetic'},classification:'source_assertion',sources:[{observation_id:source.id,quote:source.body.trim()}],asserted_at:source.recorded_at,valid_time:{from:null,to:null,expression:null,precision:'unknown'},status:'active',supersedes:[],uncertainty:[],created_at:at});
  write(root,'memory/graph.json',graph);
  const ledger=read(root,'memory/processed.json');ledger.updated_at=at;ledger.observations.push({id:source.id,source_file:source.path,source_sha256:source.sha256,status:'processed',processed_at:at,outputs:['memory/graph.json'],run:`memory/runs/run-${n}.md`});write(root,'memory/processed.json',ledger);
  write(root,`memory/runs/run-${n}.md`,'# Synthetic review\n');
}
function bytes(root){const rows=[];function walk(dir=''){for(const entry of readdirSync(join(root,dir),{withFileTypes:true})){if(entry.name==='.git')continue;const path=dir?dir+'/'+entry.name:entry.name;if(entry.isDirectory())walk(path);else rows.push([path,entry.isSymbolicLink()?'link':readFileSync(join(root,path)).toString('hex')]);}}walk();return rows.sort();}
function setup(t){
  const f=fixture(t),base=realpathSync(f.root),s=[1,2,3].map(n=>f.observe(n));add(base,s[0],1);
  const ours=join(dirname(base),'ours'),theirs=join(dirname(base),'theirs'),out=join(dirname(base),'out');
  for(const root of [ours,theirs])cpSync(base,root,{recursive:true,filter:path=>!path.split(/[\\/]/).includes('.git')});
  return {base,ours,theirs,out,s};
}
async function merge(t,f){const before=[f.base,f.ours,f.theirs].map(bytes);const result=await mergeSnapshots(f);assert.deepEqual([f.base,f.ours,f.theirs].map(bytes),before,'all inputs remain byte-identical');if(result.conflicts.length)assert.equal(existsSync(f.out),false,'no output on conflict');return result;}
const change=(root,path,fn)=>{const value=read(root,path);fn(value);write(root,path,value);};
const question=(source,id='q1')=>({id,text:'Synthetic question '+id,status:'open',source_observation_id:source.id});
const hypothesis=id=>({id,statement:'Synthetic hypothesis',status:'open',support:[],refutation:[],confidence:0.5,updated_at:new Date(0).toISOString()});

test('disjoint completed branches retain inherited ledger, exact bytes and distinct entities',async t=>{
  const f=setup(t);add(f.ours,f.s[1],2);add(f.theirs,f.s[2],3);
  write(f.theirs,'evidence/raw.bin',Buffer.from([0,255,13,10,128]));
  const r=await merge(t,f);assert.deepEqual(r.conflicts,[]);assert.equal(r.merged.ledger_rows,3);assert.equal(r.merged.claims,3);
  assert.equal(r.base_checked_by,'host');assert.ok(r.needs_regeneration.includes('memory/index.md'));
  assert.equal(r.warnings[0].kind,'possible_duplicate_entity');assert.equal(read(f.out,'memory/graph.json').entities.length,3);
  assert.deepEqual(readFileSync(join(f.out,'evidence/raw.bin')),Buffer.from([0,255,13,10,128]));
  assert.equal(existsSync(join(f.out,'memory/processing-lock.json')),false);
  assert.equal((await run(['validate','--root',f.out,'--previous',join(f.ours,'memory/graph.json')])).valid,true);
});
test('identical newly processed source is refused, inherited overlap is valid',async t=>{
  const f=setup(t);add(f.ours,f.s[1],2);cpSync(f.ours,f.theirs,{recursive:true});const r=await merge(t,f);
  assert.ok(r.conflicts.some(c=>c.kind==='source_processed_twice'&&c.id===f.s[1].id));
});
test('divergent concurrent claim change names the claim',async t=>{
  const f=setup(t);for(const [root,value] of [[f.ours,'Ours'],[f.theirs,'Theirs']])change(root,'memory/graph.json',g=>g.claims[0].object.value=value);
  const r=await merge(t,f);assert.ok(r.conflicts.some(c=>c.id==='clm-1'&&c.kind==='record_changed_both'));
});
test('claim removal and retained immutable claim mutation are refused',async t=>{
  const f=setup(t);change(f.theirs,'memory/graph.json',g=>g.claims=[]);let r=await merge(t,f);assert.ok(r.conflicts.some(c=>c.id==='clm-1'&&c.kind==='record_removed'));
  change(f.theirs,'memory/graph.json',g=>g.claims=read(f.base,'memory/graph.json').claims);change(f.theirs,'memory/graph.json',g=>g.claims[0].object.value='Changed');
  r=await merge(t,f);assert.ok(r.conflicts.some(c=>c.kind==='invalid_branch_history'));
});
test('queue and hypotheses merge by ID and incomplete readable queue requires regeneration',async t=>{
  const f=setup(t);for(const [root,n] of [[f.ours,1],[f.theirs,2]]){
    change(root,'questions/queue.json',q=>q.questions=[question(f.s[0],'q'+n)]);write(root,'questions/queue.md','q'+n+' Synthetic question q'+n+'\n');
    change(root,'memory/hypotheses.json',h=>h.hypotheses=[hypothesis('hyp-'+n)]);
  }
  const r=await merge(t,f);assert.deepEqual(r.conflicts,[]);assert.equal(r.merged.questions,2);assert.equal(r.merged.hypotheses,2);assert.ok(r.needs_regeneration.includes('questions/queue.md'));assert.equal(r.requires_review,true);
  assert.equal(readFileSync(join(f.out,'questions/queue.md'),'utf8'),'q1 Synthetic question q1\n');
  await assert.rejects(run(['validate','--root',f.out]),/Readable queue missing/);
  write(f.out,'questions/queue.md','q1 Synthetic question q1\nq2 Synthetic question q2\n');assert.equal((await run(['validate','--root',f.out,'--previous',join(f.ours,'memory/graph.json')])).valid,true);
});
test('queue and hypothesis concurrent edits report keyed conflicts',async t=>{
  const f=setup(t);for(const [root,n] of [[f.ours,1],[f.theirs,2]]){
    change(root,'questions/queue.json',q=>q.questions=[{...question(f.s[0]),text:'Text '+n}]);write(root,'questions/queue.md','q1 Text '+n);
    change(root,'memory/hypotheses.json',h=>h.hypotheses=[{...hypothesis('hyp-one'),statement:'Statement '+n}]);
  }
  const r=await merge(t,f);for(const id of ['q1','hyp-one'])assert.ok(r.conflicts.some(c=>c.id===id&&c.kind==='record_changed_both'));
});
test('both changed Markdown keeps ours and requires review',async t=>{
  const f=setup(t);write(f.ours,'memory/index.md','Ours\n');write(f.theirs,'memory/index.md','Theirs\n');const r=await merge(t,f);assert.deepEqual(r.conflicts,[]);assert.deepEqual(r.needs_regeneration,['memory/index.md']);assert.equal(readFileSync(join(f.out,'memory/index.md'),'utf8'),'Ours\n');
});
test('run collision, evidence collision and immutable pending input edit are refused',async t=>{
  const f=setup(t);for(const root of [f.ours,f.theirs])write(root,'memory/runs/shared.md','Same journal');
  write(f.ours,'evidence/shared.bin','A');write(f.theirs,'evidence/shared.bin','B');write(f.theirs,f.s[1].path,readFileSync(join(f.theirs,f.s[1].path),'utf8')+'edited');
  const r=await merge(t,f);for(const kind of ['run_collision','file_changed_both','immutable_file_changed'])assert.ok(r.conflicts.some(c=>c.kind===kind));
});
test('ledger history and guidance changes are refused',async t=>{
  const f=setup(t);change(f.theirs,'memory/processed.json',l=>l.observations[0].processed_at='2020-01-01T00:00:00Z');write(f.theirs,'instance/purpose.md','New purpose');
  const r=await merge(t,f);for(const kind of ['ledger_history_changed','guidance_changed'])assert.ok(r.conflicts.some(c=>c.kind===kind));
});
test('existing, nested, ancestor and engine output paths never clobber files',async t=>{
  const f=setup(t),before=[f.base,f.ours,f.theirs].map(bytes);
  for(const out of [f.base,join(f.base,'nested'),dirname(f.base),join(harness,'merge-forbidden')]){
    const r=await mergeSnapshots({...f,out});assert.ok(r.conflicts.length);assert.equal(existsSync(join(harness,'merge-forbidden')),false);
  }
  assert.deepEqual([f.base,f.ours,f.theirs].map(bytes),before);
});
test('symlink input and output parent are refused',async t=>{
  const f=setup(t),link=join(dirname(f.base),'link');symlinkSync(f.theirs,link,process.platform==='win32'?'junction':'dir');
  assert.ok((await mergeSnapshots({...f,theirs:link})).conflicts.length);assert.ok((await mergeSnapshots({...f,out:join(link,'out')})).conflicts.length);assert.equal(existsSync(f.out),false);
});
test('invalid hypothesis and missing canonical layout refuse output',async t=>{
  const f=setup(t);write(f.theirs,'memory/hypotheses.json',[]);assert.ok((await merge(t,f)).conflicts.length);
  write(f.theirs,'memory/hypotheses.json',read(f.base,'memory/hypotheses.json'));rmSync(join(f.theirs,'instance/purpose.md'));assert.ok((await merge(t,f)).conflicts.length);
});
test('CLI emits parseable conflict report with failure exit; successful fast-forward validates',async t=>{
  const f=setup(t);add(f.theirs,f.s[2],3);
  const args=['merge','--base',f.base,'--ours',f.ours,'--theirs',f.theirs,'--out',f.out];
  const report=JSON.parse(command(process.execPath,[join(harness,'processor/memory-tool.mjs'),...args]));assert.deepEqual(report.conflicts,[]);
  assert.equal((await run(['validate','--root',f.out,'--previous',join(f.ours,'memory/graph.json')])).valid,true);
  assert.throws(()=>command(process.execPath,[join(harness,'processor/memory-tool.mjs'),...args]),/merge_refused/);
  await assert.rejects(run([...args,'--root',f.out]),/Expected unique/);
});

test('individually valid branches cannot introduce an entity/claim ID collision',async t=>{
  const f=setup(t);add(f.theirs,f.s[2],3);
  change(f.ours,'memory/graph.json',g=>g.entities.push({...g.entities[0],id:'clm-3'}));
  const r=await merge(t,f);assert.ok(r.conflicts.some(c=>c.kind==='invalid_merged_history'&&c.detail.includes('Entity/claim ID collision')));
});
test('base question closure and disjoint hypothesis changes preserve metadata',async t=>{
  const f=setup(t);
  for(const root of [f.base,f.ours,f.theirs]){
    change(root,'questions/queue.json',q=>q.questions=[{...question(f.s[0]),closure_criteria:'Review evidence'}]);write(root,'questions/queue.md','q1 Synthetic question q1');
    change(root,'memory/hypotheses.json',h=>h.hypotheses=[hypothesis('hyp-old')]);
  }
  change(f.ours,'questions/queue.json',q=>{q.questions[0].status='closed';q.questions[0].analysis={status:'answered',source_observation_ids:[f.s[0].id]};});
  change(f.theirs,'memory/hypotheses.json',h=>h.hypotheses[0].confidence=0.8);
  const r=await merge(t,f);assert.deepEqual(r.conflicts,[]);assert.equal(read(f.out,'questions/queue.json').questions[0].status,'closed');assert.equal(read(f.out,'questions/queue.json').questions[0].closure_criteria,'Review evidence');assert.equal(read(f.out,'memory/hypotheses.json').hypotheses[0].confidence,0.8);
});
test('portable file/directory collisions are refused before creating output',async t=>{
  const f=setup(t);write(f.ours,'evidence/Note','one');write(f.theirs,'evidence/note/child','two');const r=await merge(t,f);assert.ok(r.conflicts.some(c=>c.detail?.includes('collision')));
});
