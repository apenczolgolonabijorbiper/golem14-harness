import test from 'node:test';
import assert from 'node:assert/strict';
import {join,dirname} from 'node:path';
import {mkdtempSync,realpathSync,readFileSync,writeFileSync,mkdirSync,rmSync,existsSync,symlinkSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {fixture,python,harness} from './test-fixtures.mjs';
import {readApplicationSource,compareSource} from './application-source.mjs';
import {loadGuidance,guidanceIdentity} from './guidance.mjs';
import {run} from '../processor/memory-tool.mjs';
export function bundle(t,{purpose=true}={}){
  const root=realpathSync(mkdtempSync(join(tmpdir(),'golem-source-')));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const write=(path,bytes)=>{mkdirSync(dirname(join(root,path)),{recursive:true});writeFileSync(join(root,path),typeof bytes==='string'||Buffer.isBuffer(bytes)?bytes:JSON.stringify(bytes,null,2)+'\n');};
  write('profiles/core.md','# Domain\r\nExact bytes.\r\n');write('profiles/notes.md','# Notes\nNotes rules.\n');
  write('profiles/vocabulary.json',{schema_version:2,kinds:['record'],predicates:['describes'],single_valued:['describes']});
  const config={schema_version:1,profile:{path:'profiles/core.md',sections:[{id:'notes',path:'profiles/notes.md',kinds:['note','future']}],vocabulary:'profiles/vocabulary.json'}};
  write('golem.config.json',config);if(purpose)write('purpose.md','# Purpose\r\nSynthetic scope.\r\n');return {root,write,config};
}
const inventory=root=>Object.fromEntries(readdirSync(root,{recursive:true,withFileTypes:true}).filter(e=>e.isFile()&&!e.parentPath?.includes('.git')).map(e=>{const path=join(e.parentPath??e.path,e.name);return [path,readFileSync(path).toString('base64')];}));
test('source initialization captures bytes, purpose, all section selectors and identity',async t=>{
  const src=bundle(t),f=fixture(t);rmSync(f.root,{recursive:true});
  const initialized=JSON.parse(python([join(harness,'processor/init-instance.py'),'--root',f.root,'--profile-from',src.root,'--node',process.execPath,'--json']));
  assert.equal(initialized.root,f.root);assert.equal(initialized.source.files.length,5);
  const captured=await readApplicationSource(src.root);
  for(const [path,bytes]of captured.files)assert.deepEqual(readFileSync(join(f.root,path)),bytes);
  assert.equal((await compareSource(f.root,captured)).state,'in-sync');
  const report=await run(['profile-check','--root',f.root,'--source',src.root,'--kinds','note,other']);
  const guidance=await loadGuidance(f.root,{kinds:['other','note']});assert.equal(report.guidance_identity,guidanceIdentity(guidance.guidance_version));
  assert.deepEqual(report.batches.rows.find(x=>x.kind==='other').section_ids,[]);
  assert.deepEqual(report.selectors.rows[0].unseen,['note','future']);
  const before=inventory(f.root),sourceBefore=inventory(src.root);await run(['vocabulary-survey','--root',f.root]);assert.deepEqual(inventory(f.root),before);assert.deepEqual(inventory(src.root),sourceBefore);
  src.write('profiles/core.md','Later');assert.equal(captured.files.get('profiles/core.md').toString(),'# Domain\r\nExact bytes.\r\n');assert.equal((await compareSource(f.root,await readApplicationSource(src.root))).files.find(x=>x.path==='profiles/core.md').state,'differs');
});
test('source errors and conflicting options expose no partial destination',async t=>{
  const src=bundle(t),f=fixture(t);rmSync(f.root,{recursive:true});
  const initialize=(extra=[])=>python([join(harness,'processor/init-instance.py'),'--root',f.root,'--profile-from',src.root,...extra]);
  assert.throws(()=>initialize(['--profile']));assert.equal(existsSync(f.root),false);
  assert.throws(()=>initialize(['--purpose-from',join(src.root,'purpose.md')]));assert.equal(existsSync(f.root),false);
  for(const path of ['../outside.md','instance/purpose.md','memory/graph.json','profiles/../bad.md','/absolute.md']){src.write('golem.config.json',{schema_version:1,profile:{path}});assert.throws(()=>initialize());assert.equal(existsSync(f.root),false);}
  src.write('golem.config.json',src.config);src.write('profiles/core.md',Buffer.from([255]));assert.throws(()=>initialize());assert.equal(existsSync(f.root),false);
  src.write('profiles/core.md','Valid');src.config.profile.sections.push({id:'absent',path:'profiles/absent.md',kinds:['unseen']});src.write('golem.config.json',src.config);assert.throws(()=>initialize());assert.equal(existsSync(f.root),false);
  mkdirSync(f.root);assert.throws(()=>initialize());assert.deepEqual(readdirSync(f.root),[]);
});
test('purpose-only initialization leaves profile unselected; omitted purpose retains stub',async t=>{
  const src=bundle(t),f=fixture(t);rmSync(f.root,{recursive:true});
  python([join(harness,'processor/init-instance.py'),'--root',f.root,'--purpose-from',join(src.root,'purpose.md')]);
  assert.deepEqual(readFileSync(join(f.root,'instance/purpose.md')),readFileSync(join(src.root,'purpose.md')));assert.equal((await run(['profile-check','--root',f.root])).state,'none');
  rmSync(f.root,{recursive:true});rmSync(join(src.root,'purpose.md'));python([join(harness,'processor/init-instance.py'),'--root',f.root,'--profile-from',src.root]);assert.match(readFileSync(join(f.root,'instance/purpose.md'),'utf8'),/Define the purpose/);
});
test('comparison reports stale, missing and drift independently and preserves omitted purpose',async t=>{
  const src=bundle(t,{purpose:false}),f=fixture(t,{profile:true}),before=f.read('instance/purpose.md');
  f.write('profiles/core.md','Different');const result=await compareSource(f.root,await readApplicationSource(src.root));assert.deepEqual(result.stale_managed_paths,['profiles/default.md']);assert.equal(result.files.find(x=>x.path==='profiles/core.md').state,'differs');assert.equal(result.files.find(x=>x.path==='profiles/notes.md').state,'missing');assert.equal(f.read('instance/purpose.md'),before);
});
test('selected source links and ancestor links fail closed',async t=>{
  const src=bundle(t);try{symlinkSync(join(src.root,'profiles/core.md'),join(src.root,'profiles/link.md'));}catch(e){if(['EPERM','EACCES','ENOSYS'].includes(e.code)){t.skip('OS does not grant symlink creation');return;}throw e;}
  src.config.profile.path='profiles/link.md';src.write('golem.config.json',src.config);await assert.rejects(()=>readApplicationSource(src.root),/Symlink/);
  const alias=src.root+'-alias';symlinkSync(src.root,alias,'dir');t.after(()=>rmSync(alias,{force:true}));await assert.rejects(()=>readApplicationSource(alias),/Linked/);
});
