import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {prepare,executorRequest,evaluate} from '../tools/evaluate-cognition.mjs';

test('executor request withholds evaluator fields while preserving all task/evidence controls',()=>{
  const input=prepare();
  input.secret='evaluator-only';
  input.cases[0].future_evaluator_field='evaluator-only';
  const before=JSON.stringify(input),request=executorRequest(input);
  assert.equal(request.cases.length,18);
  assert.equal(request.secret,undefined);
  assert.equal(JSON.stringify(request).includes('evaluator-only'),false);
  for(let i=0;i<input.cases.length;i++){
    assert.deepEqual(Object.keys(request.cases[i]).sort(),['case_id','forced_stop_reason','task','trusted']);
    assert.deepEqual(request.cases[i].task,input.cases[i].task);
    assert.deepEqual(request.cases[i].trusted,input.cases[i].trusted);
    assert.equal(request.cases[i].forced_stop_reason,input.cases[i].forced_stop_reason);
  }
  assert.equal(JSON.stringify(input),before);
  assert.equal(request.instructions.includes('docs/COGNITIVE_TASKS.md'),false);
  assert.equal(evaluate(input,{results:[]}).reports.length,18);
});

test('run strips rubrics at dispatch and request exports the same standalone payload',t=>{
  const root=mkdtempSync(join(tmpdir(),'cognitive-evaluation-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const input=join(root,'input.json'),request=join(root,'request.json'),output=join(root,'output.json');
  writeFileSync(input,JSON.stringify(prepare()));
  const cli=fileURLToPath(new URL('../tools/evaluate-cognition.mjs',import.meta.url));
  // Scripted transport probe only: echoes stdin, never certifies cognition.
  const run=spawnSync(process.execPath,[cli,'run',input,output,'--',process.execPath,'-e',
    "let s='';process.stdin.on('data',x=>s+=x);process.stdin.on('end',()=>process.stdout.write(s))"],{encoding:'utf8'});
  assert.equal(run.status,0,run.stderr);
  const exported=spawnSync(process.execPath,[cli,'request',input,request],{encoding:'utf8'});
  assert.equal(exported.status,0,exported.stderr);
  const payload=JSON.parse(readFileSync(output));
  assert.deepEqual(payload,JSON.parse(readFileSync(request)));
  assert.equal(JSON.stringify(payload).includes('semantic_rubric'),false);
  assert.equal(JSON.stringify(payload).includes('allowed_outcomes'),false);
  const again=spawnSync(process.execPath,[cli,'request',input,request],{encoding:'utf8'});
  assert.notEqual(again.status,0,'retained request bytes must not be overwritten');
});
