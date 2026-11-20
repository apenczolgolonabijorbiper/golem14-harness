import test from 'node:test';
import assert from 'node:assert/strict';
import {boundedSpawn} from './subprocess.mjs';
import {command} from './test-fixtures.mjs';

test('children time out with command and partial stderr instead of blocking',()=>{
  const script="process.stderr.write('synthetic stall');setInterval(()=>{},1000)";
  const start=Date.now();
  assert.throws(()=>command(process.execPath,['-e',script],{timeout:1500}),e=>/timed out after 1500ms/.test(e.message)&&e.message.includes(process.execPath)&&e.message.includes('synthetic stall'));
  assert.ok(Date.now()-start<10000);
});
test('children receive EOF, noninteractive Git environment and exact input bytes',()=>{
  const r=boundedSpawn(process.execPath,['-e',"process.stdin.resume();process.stdin.on('end',()=>console.log(process.env.GIT_TERMINAL_PROMPT+':'+process.env.GCM_INTERACTIVE))"],{encoding:'utf8'});
  assert.equal(r.status,0);assert.equal(r.stdout.trim(),'0:Never');
  const bytes=Buffer.from([0,255,13,10]);
  const echo=boundedSpawn(process.execPath,['-e','process.stdin.pipe(process.stdout)'],{input:bytes});
  assert.deepEqual(echo.stdout,bytes);
});
