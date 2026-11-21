import test from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {rmSync,existsSync,readFileSync,writeFileSync} from 'node:fs';
import {fixture,harness,command} from './test-fixtures.mjs';
import {createAdapter,run as cli} from '../adapters/reference-git/adapter.mjs';
import {loadGuidance,guidanceIdentity} from './guidance.mjs';
import {run as memoryTool} from '../processor/memory-tool.mjs';

test('purpose-only guidance binds identity, rejects dirty purpose and changed committed guidance',async t=>{
 const f=fixture(t),a=createAdapter({instance:f.root});f.observe();const before=f.git('rev-parse','HEAD'),purpose=f.read('instance/purpose.md');f.write('instance/purpose.md',purpose+'X');await assert.rejects(()=>a.claim(),/purpose/);assert.equal(f.git('rev-parse','HEAD'),before);f.write('instance/purpose.md',purpose);
 const c=await a.claim({required_capabilities:['purpose-guidance-v2']});assert.equal(c.guidance_version.profile,null);assert.equal(c.guidance,purpose);assert.equal(JSON.parse(f.read(c.guidance_path)).guidance,c.guidance);f.analyze(c);
 assert.equal((await memoryTool(['profile-check','--root',f.root,'--kinds','observation'])).guidance_identity,c.guidance_identity);
 f.write('instance/purpose.md',purpose+'Byte');f.git('add','instance/purpose.md');f.git('commit','-qm','Changed purpose');await assert.rejects(()=>a.commit({run:c.run_id}),/Claimed profile changed/);
 assert.notEqual(guidanceIdentity((await loadGuidance(f.root)).guidance_version),c.guidance_identity);
});
test('retained snapshot corruption and unsupported identity format fail without rewriting history',async t=>{
 const f=fixture(t),a=createAdapter({instance:f.root});f.observe();const c=await a.claim();f.analyze(c);const original=f.read(c.guidance_path),snapshot=JSON.parse(original);snapshot.guidance+='Corruption';f.write(c.guidance_path,snapshot);f.git('add',c.guidance_path);f.git('commit','-qm','Corrupt retained text');await assert.rejects(()=>a.commit({run:c.run_id}),/provenance/);
 f.write(c.guidance_path,original);const lease=JSON.parse(f.read('memory/processing-lock.json'));lease.guidance_version.schema_version=1;f.write('memory/processing-lock.json',lease);f.save();const head=f.git('rev-parse','HEAD');await assert.rejects(()=>a.commit({run:c.run_id}));assert.equal(f.git('rev-parse','HEAD'),head);
});
