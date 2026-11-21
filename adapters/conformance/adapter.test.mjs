import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {boundedSpawn} from '../../server/subprocess.mjs';
import {join} from 'node:path';
import {symlinkSync} from 'node:fs';
import {fixture,harness} from '../../server/test-fixtures.mjs';
import {createAdapter} from '../reference-git/adapter.mjs';

// Any compatible local CLI can run the black-box tests via a JSON command array.
const cli=process.env.GOLEM_ADAPTER?JSON.parse(process.env.GOLEM_ADAPTER):[process.execPath,join(harness,'adapters/reference-git/adapter.mjs')];
function invoke(f,command,...args){const r=boundedSpawn(cli[0],[...cli.slice(1),command,'--instance',f.root,...(process.env.GOLEM_ADAPTER?[]:['--harness',harness]),...args],{encoding:'utf8',timeout:180000});if(r.status!==0)throw Error(r.stderr);return JSON.parse(r.stdout);}

test('CLI conformance: no work, age gating, claim/owner checks, renew and error release',t=>{
  const f=fixture(t),before=f.git('rev-parse','HEAD');assert.equal(invoke(f,'claim').status,'no-work');assert.equal(f.git('rev-parse','HEAD'),before);
  f.observe(1,{age:0});assert.equal(invoke(f,'status').waiting_for_age.length,1);assert.equal(invoke(f,'claim').status,'no-work');
  f.observe(1);const claimed=invoke(f,'claim');assert.equal(claimed.status,'claimed');assert.equal('guidance_version' in claimed,invoke(f,'status').capabilities?.includes('purpose-guidance-v2')??false);assert.throws(()=>invoke(f,'claim'),/lease/);
  const wrong='00000000-0000-4000-8000-000000000099';assert.throws(()=>invoke(f,'renew','--run',wrong),/own/);assert.throws(()=>invoke(f,'release-error','--run',wrong),/own/);
  invoke(f,'renew','--run',claimed.run_id);invoke(f,'release-error','--run',claimed.run_id,'--reason','not stored');const status=invoke(f,'status');assert.equal(status.lease.status,'error');assert.equal(status.processed,0);assert.equal(status.ready.length,1);
});
test('CLI conformance: exact candidate, successful completion, scope and no-op retry',t=>{
  const f=fixture(t);const source=f.observe();const claim=invoke(f,'claim');
  assert.throws(()=>invoke(f,'commit','--run',claim.run_id),/failed|missing/i);assert.equal(invoke(f,'status').lease.status,'processing');
  f.analyze(claim);f.write('memory/events/event.md','Synthetic event');f.write('scratch.md','Keep me');f.observe(2);
  const before={head:f.git('rev-parse','HEAD'),ledger:f.read('memory/processed.json'),lease:f.read('memory/processing-lock.json')};
  const v=invoke(f,'validate','--run',claim.run_id,'--outputs','memory/events/event.md');assert.equal(v.mode,'candidate');assert.deepEqual(before,{head:f.git('rev-parse','HEAD'),ledger:f.read('memory/processed.json'),lease:f.read('memory/processing-lock.json')});
  const completed=invoke(f,'commit','--run',claim.run_id,'--outputs','memory/events/event.md');assert.deepEqual(completed.processed,[source.id]);assert.ok(completed.left_uncommitted.includes('scratch.md'));assert.ok(completed.left_uncommitted.some(p=>p.includes('000000000002')));assert.equal(f.git('show','HEAD:memory/events/event.md'),'Synthetic event');assert.throws(()=>f.git('show','HEAD:scratch.md'));
  const rows=JSON.parse(f.read('memory/processed.json')).observations;assert.equal(rows[0].source_sha256,source.sha256);assert.equal(invoke(f,'status').lease.status,'idle');assert.throws(()=>invoke(f,'commit','--run',claim.run_id),/own/);
  assert.equal(invoke(f,'validate').ok,true);
});
test('CLI conformance: invalid graph and changed sources keep inputs pending',t=>{
  const f=fixture(t);f.observe();let claim=invoke(f,'claim');f.analyze(claim,{bad:true});const ledger=f.read('memory/processed.json');assert.throws(()=>invoke(f,'commit','--run',claim.run_id),/validation/i);assert.equal(f.read('memory/processed.json'),ledger);assert.equal(invoke(f,'status').lease.status,'error');assert.match(invoke(f,'status').lease.reason,/Claim source\/quote mismatch/);
  claim=invoke(f,'claim');f.write(`memory/runs/${claim.run_id}.md`,'Review');f.write(claim.sources[0].path,f.read(claim.sources[0].path)+'Changed');assert.throws(()=>invoke(f,'commit','--run',claim.run_id),/source changed/i);assert.equal(invoke(f,'status').lease.status,'error');assert.equal(invoke(f,'status').processed,0);
});
test('CLI conformance: unsafe output paths are rejected without releasing the lease',t=>{
  const f=fixture(t);f.observe();const claim=invoke(f,'claim');f.analyze(claim);try{symlinkSync(join(f.root,'memory/graph.json'),join(f.root,'escape.md'));}catch(e){if(!['EPERM','EACCES','ENOSYS'].includes(e.code))throw e;t.diagnostic('OS does not grant symlink creation; other unsafe-output checks still run');}
  for(const path of ['/tmp/unsafe','../outside','memory/../graph.json','.git/config','C:/unsafe','missing.md','escape.md','memory','memory/processed.json','profiles/new.md'])assert.throws(()=>invoke(f,'commit','--run',claim.run_id,'--outputs',path));assert.equal(invoke(f,'status').lease.status,'processing');
});
test('CLI conformance: selected guidance, scoped sections, journal enforcement and immutable version',t=>{
  const f=fixture(t,{profile:true});if(!invoke(f,'status').capabilities?.some(c=>['profile-guidance-v1','purpose-guidance-v2'].includes(c))){t.skip('Adapter does not advertise profile delivery');return;}f.write('profiles/notes.md','Notes guidance');f.write('profiles/digests.md','Digest guidance');f.write('profiles/vocab.json',{schema_version:2,kinds:['record'],predicates:['describes']});
  f.write('golem.config.json',{schema_version:1,profile:{path:'profiles/default.md',vocabulary:'profiles/vocab.json',sections:[{id:'notes',path:'profiles/notes.md',kinds:['note']},{id:'digests',path:'profiles/digests.md',kinds:['digest']}]}});f.save();
  f.observe(1,{kind:'note'});let claim=invoke(f,'claim');assert.ok(claim.guidance.includes('Notes guidance'));assert.ok(!claim.guidance.includes('Digest guidance'));assert.ok(claim.guidance_boundary.includes('data'));f.analyze(claim);
  const original=f.read('profiles/default.md');f.write('profiles/default.md',original+'\nUpdated');
  assert.equal(JSON.parse(f.read(claim.guidance_path)).guidance,claim.guidance);f.write(`memory/runs/${claim.run_id}.md`,'Missing identity');assert.throws(()=>invoke(f,'commit','--run',claim.run_id),/guidance_version/);f.write(`memory/runs/${claim.run_id}.md`,'guidance_version: '+claim.guidance_identity+'\n');invoke(f,'commit','--run',claim.run_id);
  f.save();f.observe(2,{kind:'../../evil'});const next=invoke(f,'claim');assert.notEqual((next.guidance_version.profile??next.guidance_version).profile_sha256,(claim.guidance_version.profile??claim.guidance_version).profile_sha256);assert.equal((next.guidance_version.profile??next.guidance_version).sections.length,0);assert.ok(next.guidance.includes('Updated'));
});

// Factory-only fault injection exercises storage mechanics beyond the CLI contract.
if(!process.env.GOLEM_ADAPTER){
 test('reference: expiry reclaim and changed processed source intervention',async t=>{
  const f=fixture(t);f.observe();let clock=Date.now();const adapter=createAdapter({instance:f.root,now:()=>clock});const old=await adapter.claim();clock+=900001;await assert.rejects(()=>adapter.renew({run:old.run_id}),/own/);const next=await adapter.claim();f.analyze(next);await adapter.commit({run:next.run_id});const path=next.sources[0].path;f.write(path,f.read(path)+'Mutation');assert.equal((await adapter.status()).malformed.length,1);await assert.rejects(()=>adapter.claim(),/intervention/);
 });
 test('reference: ref movement between validation and publication retains lease and drafts',async t=>{
  const f=fixture(t);f.observe();const adapter=createAdapter({instance:f.root,hooks:{beforeCommit(){f.write('intake.md','Concurrent intake');f.git('add','intake.md');f.git('commit','-qm','Concurrent writer');}}});const claim=await adapter.claim();f.analyze(claim);await assert.rejects(()=>adapter.commit({run:claim.run_id}),/Head changed/);assert.equal((await adapter.status()).lease.run_id,claim.run_id);assert.equal(JSON.parse(f.read('memory/processed.json')).observations.length,0);assert.equal(f.read('intake.md'),'Concurrent intake');
 });
 test('reference: source mutation after candidate validation prevents completion',async t=>{
  const f=fixture(t);f.observe();let claimed;const adapter=createAdapter({instance:f.root,hooks:{beforeCommit(){f.write(claimed.sources[0].path,f.read(claimed.sources[0].path)+'Mutation');}}});claimed=await adapter.claim();f.analyze(claimed);await assert.rejects(()=>adapter.commit({run:claimed.run_id}),/source changed/i);assert.equal((await adapter.status()).lease.status,'error');
 });
 test('reference: interrupted post-CAS completion is recovered without duplicate commit or draft loss',async t=>{
  const f=fixture(t);f.observe();const adapter=createAdapter({instance:f.root,hooks:{afterPublish({operation}){if(operation.startsWith('complete'))throw Error('Injected interruption');}}});const claim=await adapter.claim();f.analyze(claim);f.write('scratch.md','Preserve');await assert.rejects(()=>adapter.commit({run:claim.run_id}),/Injected/);const committed=f.git('rev-parse','HEAD');assert.equal(JSON.parse(f.git('show','HEAD:memory/processed.json')).observations.length,1);assert.equal((await adapter.status()).recovery_required,true);
  const fresh=createAdapter({instance:f.root});assert.equal((await fresh.claim()).status,'no-work');assert.equal(f.git('rev-parse','HEAD'),committed);assert.equal((await fresh.status()).recovery_required,false);assert.equal(f.read('scratch.md'),'Preserve');assert.equal(JSON.parse(f.read('memory/processed.json')).observations.length,1);
 });
 test('reference: autocrlf and attributes cannot transform candidate source bytes',async t=>{
  const f=fixture(t);f.write('.gitattributes','*.md text eol=crlf\n');f.save();f.git('config','core.autocrlf','true');const source=f.observe();const raw=f.read(source.path);const adapter=createAdapter({instance:f.root});const claim=await adapter.claim();f.analyze(claim);await adapter.commit({run:claim.run_id});const stored=boundedSpawn('git',['-C',f.root,'show',`HEAD:${source.path}`]).stdout;assert.deepEqual(stored,Buffer.from(raw));assert.equal((await adapter.status()).processed,1);
 });
 test('reference: staged candidate changes and stale protocol files are refused',async t=>{
  const f=fixture(t);f.observe();const adapter=createAdapter({instance:f.root});const claim=await adapter.claim();f.analyze(claim);f.git('add','memory/graph.json');await assert.rejects(()=>adapter.commit({run:claim.run_id}),/staged/);f.git('reset','-q','HEAD','--','memory/graph.json');f.write('memory/processing-lock.json',{schema_version:1,status:'idle',observation_ids:[]});await assert.rejects(()=>adapter.renew({run:claim.run_id}),/Stale/);assert.equal((await adapter.status()).lease.run_id,claim.run_id);
 });
}

test('CLI conformance: warning-only completion is valid and integrity errors retain their first diagnostic',t=>{
  const f=fixture(t,{profile:true});f.write('profiles/vocab.json',{schema_version:2,kinds:[],predicates:[]});f.write('golem.config.json',{schema_version:1,profile:{path:'profiles/default.md',vocabulary:'profiles/vocab.json'}});f.save();f.observe();const claim=invoke(f,'claim');f.analyze(claim);
  const dry=invoke(f,'validate','--run',claim.run_id);assert.equal(dry.output.valid,true);assert.deepEqual(dry.output.warnings.map(w=>w.code),['unknown_kind','unknown_predicate']);const result=invoke(f,'commit','--run',claim.run_id);assert.equal(result.warnings.length,2);assert.equal(invoke(f,'validate').output.warnings.length,2);
  const graph=JSON.parse(f.read('memory/graph.json'));graph.claims[0].sources[0].quote='Not in source';f.write('memory/graph.json',graph);const r=boundedSpawn(process.execPath,[join(harness,'processor/memory-tool.mjs'),'validate','--root',f.root],{encoding:'utf8'});assert.equal(r.status,1);assert.match(r.stderr,/^Memory validation failed: Claim source\/quote mismatch:/);
});

test('CLI conformance: malformed sources and unavailable configured profiles write no lease',t=>{
  const f=fixture(t);const source=f.observe();const before=f.git('rev-parse','HEAD');f.write(source.path,'Not finalized');assert.throws(()=>invoke(f,'claim'),/Malformed/);assert.equal(f.git('rev-parse','HEAD'),before);
  f.observe();f.write('golem.config.json',{schema_version:1,profile:{path:'profiles/missing.md'}});f.save();const configured=f.git('rev-parse','HEAD');assert.throws(()=>invoke(f,'claim'));assert.equal(f.git('rev-parse','HEAD'),configured);assert.equal(JSON.parse(f.read('memory/processing-lock.json')).status,'idle');
});

if(!process.env.GOLEM_ADAPTER){
 test('reference: post-CAS recovery preserves local protocol edits and unrelated staged work',async t=>{
  const f=fixture(t);f.observe();const adapter=createAdapter({instance:f.root,hooks:{afterPublish({operation}){if(operation.startsWith('complete'))throw Error('Interrupted');}}});const claim=await adapter.claim();f.analyze(claim);f.write('unrelated.md','Staged content');f.git('add','unrelated.md');await assert.rejects(()=>adapter.commit({run:claim.run_id}),/Interrupted/);const head=f.git('rev-parse','HEAD');f.write('memory/processed.json','Keep local edit');const fresh=createAdapter({instance:f.root});await assert.rejects(()=>fresh.claim(),/local|protocol|recovery/i);assert.equal(f.read('memory/processed.json'),'Keep local edit');assert.equal(f.git('rev-parse','HEAD'),head);assert.match(f.git('diff','--cached','--name-only'),/unrelated.md/);
 });
 test('reference: profile-guidance identity and snapshot cannot be replaced by mutable files',async t=>{
  const f=fixture(t,{profile:true});f.observe();const adapter=createAdapter({instance:f.root});const claim=await adapter.claim();f.analyze(claim);const original=f.read(claim.guidance_path);f.write('profiles/default.md','A later profile');f.write(claim.guidance_path,'Forged local snapshot');const result=await adapter.commit({run:claim.run_id});assert.equal(result.status,'committed');assert.equal(f.git('show',`HEAD:${claim.guidance_path}`),original.trim());assert.ok(result.left_uncommitted.includes(claim.guidance_path));
 });
}

test('CLI conformance: expired lease is reclaimed and changed processed bytes are malformed',t=>{
  const f=fixture(t);f.observe();const old=invoke(f,'claim');const lease=JSON.parse(f.read('memory/processing-lock.json'));lease.expires_at='2020-01-01T00:00:00.000Z';f.write('memory/processing-lock.json',lease);f.save();assert.throws(()=>invoke(f,'renew','--run',old.run_id),/own/);const next=invoke(f,'claim');assert.notEqual(next.run_id,old.run_id);f.analyze(next);invoke(f,'commit','--run',next.run_id);f.write(next.sources[0].path,f.read(next.sources[0].path)+'Changed');assert.equal(invoke(f,'status').malformed.length,1);assert.throws(()=>invoke(f,'claim'),/intervention/);
});

test('CLI conformance: concurrent claims cannot both acquire ownership',async t=>{
  const f=fixture(t);f.observe();
  const call=()=>new Promise((done,reject)=>{const child=spawn(cli[0],[...cli.slice(1),'claim','--instance',f.root,...(process.env.GOLEM_ADAPTER?[]:['--harness',harness])],{stdio:['ignore','pipe','pipe'],env:{...process.env,GIT_TERMINAL_PROMPT:'0',GCM_INTERACTIVE:'Never'},timeout:180000});let stdout='',stderr='';child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);child.on('error',reject);child.on('close',(code,signal)=>signal?reject(Error('Adapter claim child stopped ('+signal+'): '+JSON.stringify(cli)+'\n'+stderr.slice(0,2000))):done({code,stdout,stderr}));});
  const results=await Promise.all([call(),call()]);assert.equal(results.filter(r=>r.code===0).length,1);const winner=JSON.parse(results.find(r=>r.code===0).stdout);assert.equal(invoke(f,'status').lease.run_id,winner.run_id);
});

test('CLI optional purpose-guidance-v2: purpose-only immutable delivery and dirty refusal',t=>{
 const f=fixture(t);if(!invoke(f,'status').capabilities?.includes('purpose-guidance-v2')){t.skip('Adapter does not advertise purpose-guidance-v2');return;}
 const purpose=f.read('instance/purpose.md');f.observe();f.write('instance/purpose.md',purpose+'Dirty');const head=f.git('rev-parse','HEAD');assert.throws(()=>invoke(f,'claim'),/purpose/);assert.equal(f.git('rev-parse','HEAD'),head);f.write('instance/purpose.md',purpose);
 const c=invoke(f,'claim');assert.equal(c.guidance_version.schema_version,2);assert.equal(c.guidance_version.profile,null);assert.equal(c.guidance,purpose);assert.equal(JSON.parse(f.read(c.guidance_path)).guidance,c.guidance);f.analyze(c);assert.equal(invoke(f,'commit','--run',c.run_id).status,'committed');
});
