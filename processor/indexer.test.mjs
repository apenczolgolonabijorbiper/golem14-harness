import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {once} from 'node:events';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {initialize} from './init-instance.mjs';
import {index,indexerLock} from './process.mjs';
const processor=path.dirname(fileURLToPath(import.meta.url));
const id='00000000-0000-4000-8000-000000000001';
async function fixture(t){const base=fs.realpathSync(fs.mkdtempSync(path.join(tmpdir(),'node-index-')));t.after(()=>fs.rmSync(base,{recursive:true,force:true,maxRetries:10,retryDelay:100}));const root=path.join(base,'instance');await initialize(root);return {base,root};}
function note(root,n=1,text='Zażółć 世界.\nSecond line.\n',newline='\n'){
  const uid=id.slice(0,-12)+String(n).padStart(12,'0');const raw=Buffer.from(`---\nid: ${uid}\nrecorded_at: 2026-01-01T00:00:00.000Z\nkind: observation\n---\n\n${text}`.replaceAll('\n',newline));
  fs.writeFileSync(path.join(root,'inbox',uid+'.md'),raw);return {uid,raw};
}
function run(root){return spawnSync(process.execPath,[path.join(processor,'process.mjs'),'--root',root],{encoding:'utf8',timeout:30000});}
function evidence(root){return Object.fromEntries(fs.readdirSync(path.join(root,'evidence')).filter(n=>n.endsWith('.json')).map(n=>[n,fs.readFileSync(path.join(root,'evidence',n),'utf8')]));}
async function held(t,root,{fail=false}={}){
  const code=`import {index} from ${JSON.stringify(new URL('./process.mjs',import.meta.url).href)};import {readSync} from 'node:fs';let first=true;try{index(process.argv[1],{beforePublish(){if(first){first=false;process.stdout.write('READY\\n');readSync(0,Buffer.alloc(1),0,1,null);${fail?"throw Error('Injected publication failure');":''}}}});}catch(e){console.error(e.message);process.exitCode=1;}`;
  const child=spawn(process.execPath,['--input-type=module','-e',code,root],{stdio:['pipe','pipe','pipe']});
  t.after(async()=>{if(child.exitCode===null&&child.signalCode===null){child.kill();await once(child,'close');}});
  let stdout='',stderr='';const complete=new Promise((resolve,reject)=>{child.on('error',reject);child.stderr.on('data',b=>stderr+=b);child.on('close',code=>resolve({code,stdout,stderr}));});
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Owner failed to reach publication gate: '+stderr)),20000);child.stdout.on('data',b=>{stdout+=b;if(stdout.includes('READY\n')){clearTimeout(timer);resolve();}});child.once('error',e=>{clearTimeout(timer);reject(e);});child.once('exit',()=>{clearTimeout(timer);if(!stdout.includes('READY\n'))reject(Error(stderr));});});
  return {child,complete};
}
test('Node initializer refuses nonempty and linked destinations; uses one timestamp',async t=>{
  const {base,root}=await fixture(t),before=fs.readFileSync(path.join(root,'memory/graph.json'));
  await assert.rejects(initialize(root),/never reset/);assert.deepEqual(fs.readFileSync(path.join(root,'memory/graph.json')),before);
  await assert.rejects(initialize(path.join(base,'bad'),{profile:true,profileFrom:root}),/mutually exclusive/);assert.equal(fs.existsSync(path.join(base,'bad')),false);
  fs.symlinkSync(root,path.join(base,'link'),process.platform==='win32'?'junction':'dir');await assert.rejects(initialize(path.join(base,'link','fresh')),/Linked/);
  const at=new Date('2026-01-01T00:00:00.000Z'),empty=path.join(base,'empty');fs.mkdirSync(empty);await initialize(empty,{now:()=>at,profile:true});
  for(const p of ['graph','processed','hypotheses'])assert.equal(JSON.parse(fs.readFileSync(path.join(empty,'memory',p+'.json'))).updated_at,at.toISOString());
  assert.equal(JSON.parse(fs.readFileSync(path.join(empty,'golem.config.json'))).profile.path,'profiles/default.md');
});
test('newlines, UTF-8, exact hashes, idempotency and existing evidence preservation',async t=>{
  const {base}=await fixture(t);
  for(const [i,newline]of ['\n','\r\n','\r'].entries()){
    const root=path.join(base,'newline-'+i);await initialize(root);const {raw}=note(root,1,undefined,newline);assert.equal(run(root).status,0);
    const e=JSON.parse(evidence(root)[id+'.json']);assert.equal(e.sha256,createHash('sha256').update(raw).digest('hex'));assert.equal(e.text,'Zażółć 世界.\nSecond line.');
    assert.deepEqual(fs.readFileSync(path.join(root,'inbox',id+'.md')),raw);const before=evidence(root);assert.equal(run(root).stdout,'');assert.deepEqual(evidence(root),before);
  }
});
test('overlapping publishers refuse promptly, expose only complete JSON and match baseline',async t=>{
  const {base,root}=await fixture(t),baseline=path.join(base,'baseline');await initialize(baseline);
  for(let n=1;n<=100;n++){note(root,n,'Synthetic 世界. '.repeat(1000));fs.copyFileSync(path.join(root,'inbox',id.slice(0,-12)+String(n).padStart(12,'0')+'.md'),path.join(baseline,'inbox',id.slice(0,-12)+String(n).padStart(12,'0')+'.md'));}
  assert.equal(run(baseline).status,0);const owner=await held(t,root);assert.deepEqual(evidence(root),{});
  const loser=run(root);assert.equal(loser.status,1);assert.match(loser.stderr,/Indexer busy:/);assert.equal(loser.stdout,'');
  owner.child.stdin.end('\n');const outcome=await owner.complete;assert.equal(outcome.code,0,outcome.stderr);
  assert.deepEqual(evidence(root),evidence(baseline));for(const text of Object.values(evidence(root)))assert.ok(JSON.parse(text).id);
});
test('killed owner releases exclusion, cleans orphan temp and preserves finalized evidence',async t=>{
  const {root}=await fixture(t);for(let n=1;n<=10;n++)note(root,n);
  const target=path.join(root,'evidence',id+'.json');fs.writeFileSync(target,'{"preserved":true}\n');
  const owner=await held(t,root);assert.ok(fs.readdirSync(path.join(root,'evidence')).some(n=>n.endsWith('.tmp')));assert.equal(run(root).status,1);
  owner.child.kill('SIGKILL');await owner.complete;const after=run(root);assert.equal(after.status,0,after.stderr);assert.equal(after.stdout.split('Indexed:').length-1,9);assert.equal(fs.readFileSync(target,'utf8'),'{"preserved":true}\n');
  assert.equal(fs.readdirSync(path.join(root,'evidence')).some(n=>n.endsWith('.tmp')),false);assert.deepEqual(fs.readdirSync(path.join(root,'.golem-indexer-locks')),[]);
});
test('publication failures clean temporary files and release lock',async t=>{
  const {root}=await fixture(t);note(root);const owner=await held(t,root,{fail:true});owner.child.stdin.end('\n');const result=await owner.complete;
  assert.equal(result.code,1);assert.match(result.stderr,/Injected publication failure/);assert.deepEqual(evidence(root),{});assert.equal(fs.readdirSync(path.join(root,'evidence')).length,0);assert.equal(run(root).status,0);
});
test('invalid UTF-8 refuses; malformed sources skip; question metadata and live register remain intact',async t=>{
  const {root}=await fixture(t);const {raw}=note(root);fs.writeFileSync(path.join(root,'inbox','bad.md'),Buffer.from([255]));assert.equal(run(root).status,1);fs.unlinkSync(path.join(root,'inbox','bad.md'));fs.rmSync(path.join(root,'evidence',id+'.json'),{force:true});
  fs.writeFileSync(path.join(root,'inbox',id+'.md'),raw.toString().replace('kind: observation','kind: question_answer\nquestion_id: q1\nquestion_text: "Co mówi 世界?"'));
  assert.equal(run(root).status,0);assert.deepEqual(JSON.parse(evidence(root)[id+'.json']).question,{id:'q1',text:'Co mówi 世界?',source:null});
  const release=indexerLock(root);try{assert.throws(()=>index(root),/Indexer busy:/);}finally{release();}
});
test('simultaneous contenders never overlap critical sections',async t=>{
  const {root}=await fixture(t);
  const code=`import {indexerLock} from ${JSON.stringify(new URL('./process.mjs',import.meta.url).href)};import fs from 'node:fs';import path from 'node:path';const root=process.argv[1],guard=path.join(root,'exclusive-proof');let completed=0;for(let n=0;n<500&&completed<10;n++){let release;try{release=indexerLock(root);}catch(e){if(!e.message.startsWith('Indexer busy:'))throw e;await new Promise(r=>setTimeout(r,2));continue;}try{const fd=fs.openSync(guard,'wx');await new Promise(r=>setTimeout(r,1));fs.closeSync(fd);fs.unlinkSync(guard);completed++;}finally{release();}}if(completed!==10)throw Error('Contender starved');`;
  const children=Array.from({length:6},()=>spawn(process.execPath,['--input-type=module','-e',code,root],{stdio:['ignore','pipe','pipe']}));
  t.after(()=>{for(const c of children)if(c.exitCode===null)c.kill();});
  await Promise.all(children.map(c=>new Promise((resolve,reject)=>{let err='';c.stderr.on('data',b=>err+=b);c.on('error',reject);c.on('close',code=>code===0?resolve():reject(Error(err)));})));
});
test('fresh initializer and index CLI work without Python on PATH',async t=>{
  const {base}=await fixture(t),root=path.join(base,'node only'),emptyPath=path.join(base,'empty-bin');fs.mkdirSync(emptyPath);
  const env={...process.env,PATH:emptyPath,GOLEM_PYTHON:'missing-python-must-not-run'};
  const init=spawnSync(process.execPath,[path.join(processor,'init-instance.mjs'),'--root',root],{env,encoding:'utf8'});assert.equal(init.status,0,init.stderr);note(root);
  const result=spawnSync(process.execPath,[path.join(processor,'process.mjs'),'--root',root],{env,encoding:'utf8'});assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/Indexed:/);
});
