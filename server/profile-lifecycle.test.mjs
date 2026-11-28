import test from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {rmSync,existsSync,readFileSync,writeFileSync,symlinkSync} from 'node:fs';
import {fixture,harness,command} from './test-fixtures.mjs';
import {createAdapter,run as cli} from '../adapters/reference-git/adapter.mjs';
import {loadGuidance,guidanceIdentity} from './guidance.mjs';
import {run as memoryTool} from '../processor/memory-tool.mjs';
function source(t){const s=fixture(t,{profile:true});s.write('purpose.md','# Purpose\nSynthetic reviewed source.\n');s.write('profiles/default.md','# Domain\nSource rules.\n');return s;}
test('install lifecycle handles empty Git inbox, drift, restoration and scoped deletion',async t=>{
 const s=source(t),f=fixture(t),a=createAdapter({instance:f.root});rmSync(join(f.root,'inbox'),{recursive:true});
 assert.equal((await a.status()).ready.length,0);assert.equal((await a['profile-status']({source:s.root})).state,'not-installed');
 assert.equal((await a['profile-install']({source:s.root})).status,'installed');assert.equal((await a['profile-status']({source:s.root})).state,'in-sync');
 const before=f.git('rev-parse','HEAD');assert.equal((await a['profile-install']({source:s.root})).status,'unchanged');assert.equal(f.git('rev-parse','HEAD'),before);
 f.write('profiles/default.md','Local dirty rules');assert.equal((await a['profile-status']({source:s.root})).state,'dirty');
 const restored=await a['profile-install']({source:s.root});assert.deepEqual(restored.restored_paths,['profiles/default.md']);assert.equal(f.git('rev-parse','HEAD'),before);
 s.write('profiles/extra.md','Section');s.write('golem.config.json',{schema_version:1,profile:{path:'profiles/default.md',sections:[{id:'extra',path:'profiles/extra.md',kinds:['note']}]}});await a['profile-install']({source:s.root});
 f.write('profiles/unrelated.md','Keep');s.write('golem.config.json',{schema_version:1,profile:{path:'profiles/default.md'}});rmSync(join(s.root,'purpose.md'));const purpose=f.read('instance/purpose.md');
 assert.deepEqual((await a['profile-status']({source:s.root})).committed.stale_managed_paths,['profiles/extra.md']);
 await a['profile-install']({source:s.root});assert.equal(existsSync(join(f.root,'profiles/extra.md')),false);assert.equal(f.read('profiles/unrelated.md'),'Keep');assert.equal(f.read('instance/purpose.md'),purpose);assert.equal((await a.claim()).status,'no-work');
});
test('installation refuses lease, invalid source, staged target and CAS movement',async t=>{
 const s=source(t),f=fixture(t),a=createAdapter({instance:f.root});f.observe();const c=await a.claim(),head=f.git('rev-parse','HEAD');await assert.rejects(()=>a['profile-install']({source:s.root}),/lease/);assert.equal(f.git('rev-parse','HEAD'),head);await a['release-error']({run:c.run_id});
 s.write('profiles/default.md','');const after=f.git('rev-parse','HEAD');await assert.rejects(()=>a['profile-install']({source:s.root}),/empty/);assert.equal(f.git('rev-parse','HEAD'),after);assert.equal((await a['profile-status']({source:s.root})).state,'source-invalid');
 s.write('profiles/default.md','Valid');f.write('profiles/default.md','Staged');f.git('add','profiles/default.md');await assert.rejects(()=>a['profile-install']({source:s.root}),/unowned|staged/);assert.equal(f.read('profiles/default.md'),'Staged');f.git('reset','-q','HEAD','--','profiles/default.md');rmSync(join(f.root,'profiles/default.md'));
 const moving=createAdapter({instance:f.root,hooks:{beforeInstall(){f.write('unrelated.md','Concurrent');f.git('add','unrelated.md');f.git('commit','-qm','Concurrent');}}});await assert.rejects(()=>moving['profile-install']({source:s.root}),/Head changed/);assert.equal(existsSync(join(f.root,'golem.config.json')),false);
});
test('post-CAS installation deletion recovery is read-only in status and preserves local edits',async t=>{
 const s=source(t),f=fixture(t),a=createAdapter({instance:f.root});await a['profile-install']({source:s.root});
 s.write('profiles/new.md','New');s.write('golem.config.json',{schema_version:1,profile:{path:'profiles/new.md'}});
 const interrupted=createAdapter({instance:f.root,hooks:{afterPublish(){throw Error('Injected post-CAS');}}});await assert.rejects(()=>interrupted['profile-install']({source:s.root}),/Injected/);
 const head=f.git('rev-parse','HEAD'),pending=join(f.root,'.git/golem-adapter-pending.json'),record=readFileSync(pending);
 assert.equal((await a['profile-status']({source:s.root})).recovery_required,true);assert.deepEqual(readFileSync(pending),record);
 f.write('profiles/default.md','Preserve recovery edit');await assert.rejects(()=>a['profile-install']({source:s.root}),/preserve edited/i);assert.equal(f.read('profiles/default.md'),'Preserve recovery edit');
 rmSync(join(f.root,'profiles/default.md'));await a['profile-install']({source:s.root});assert.equal(f.git('rev-parse','HEAD'),head);assert.equal(existsSync(pending),false);assert.equal((await a['profile-status']({source:s.root})).state,'in-sync');
});
test('recovery refuses divergent HEAD and leaves operator edits intact',async t=>{
 const s=source(t),f=fixture(t),a=createAdapter({instance:f.root,hooks:{afterPublish(){throw Error('Interrupted');}}});await assert.rejects(()=>a['profile-install']({source:s.root}));
 f.write('other.md','Preserve');f.git('add','other.md');f.git('commit','-qm','Advance');const head=f.git('rev-parse','HEAD');await assert.rejects(()=>createAdapter({instance:f.root})['profile-install']({source:s.root}),/advanced during recovery/);assert.equal(f.git('rev-parse','HEAD'),head);assert.equal(f.read('other.md'),'Preserve');
});
test('per-instance source guard checks purpose under operation lock without affecting other instances',async t=>{
 const s=source(t),f=fixture(t),a=createAdapter({instance:f.root,sourceGuard:s.root});await a['profile-install']({source:s.root});s.write('purpose.md','Changed');await assert.rejects(()=>a.claim(),/profile-install/);
 const other=fixture(t);assert.equal((await createAdapter({instance:other.root}).claim()).status,'no-work');await a['profile-install']({source:s.root});assert.equal((await a.claim()).status,'no-work');
});

test('identical purpose and profile bytes give identity independent of repository revision',async t=>{
 const s=source(t),f=fixture(t),g=fixture(t);for(const instance of [f,g])await createAdapter({instance:instance.root})['profile-install']({source:s.root});
 assert.equal(guidanceIdentity((await loadGuidance(f.root)).guidance_version),guidanceIdentity((await loadGuidance(g.root)).guidance_version));
 await assert.rejects(()=>createAdapter({instance:f.root}).claim({required_capabilities:['unknown-capability']}),/unavailable/);
});

test('CLI honors selected Git executable across child operations',async t=>{
 const f=fixture(t);await assert.rejects(()=>cli(['status','--instance',f.root,'--git','missing-golem-git']));
 const executable=command(process.platform==='win32'?'where':'which',['git']).split(/\r?\n/)[0];assert.equal((await cli(['status','--instance',f.root,'--git',executable])).contract_version,1);
});

test('captured install bytes remain consistent when the reviewed source changes before publication',async t=>{
 const s=source(t),f=fixture(t),old=s.read('profiles/default.md');
 const a=createAdapter({instance:f.root,hooks:{beforeInstall(){s.write('profiles/default.md','A newer source revision');}}});
 const installed=await a['profile-install']({source:s.root});assert.equal(f.read('profiles/default.md'),old);assert.ok(installed.source.files.find(x=>x.path==='profiles/default.md').sha256);assert.equal((await a['profile-status']({source:s.root})).state,'drift');
});
test('malformed and linked inboxes are refused rather than treated as empty',async t=>{
 const f=fixture(t),a=createAdapter({instance:f.root});rmSync(join(f.root,'inbox'),{recursive:true});writeFileSync(join(f.root,'inbox'),'Not a directory');await assert.rejects(()=>a.status(),/Unsafe inbox/);await assert.rejects(()=>memoryTool(['validate','--root',f.root]),/Unsafe inbox/);rmSync(join(f.root,'inbox'));
 const other=fixture(t);try{symlinkSync(join(other.root,'inbox'),join(f.root,'inbox'),'dir');}catch(e){if(['EPERM','EACCES','ENOSYS'].includes(e.code)){t.diagnostic('OS does not grant symlink creation; regular-file refusal passed');return;}throw e;}
 await assert.rejects(()=>a.status(),/Unsafe inbox/);await assert.rejects(()=>memoryTool(['validate','--root',f.root]),/Unsafe inbox/);
});
