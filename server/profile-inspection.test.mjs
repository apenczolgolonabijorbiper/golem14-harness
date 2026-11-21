import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './test-fixtures.mjs';
import {run} from '../processor/memory-tool.mjs';
import {vocabularySurvey} from './profile-inspection.mjs';
test('profile diagnostics survive invalid graph and identify only exact initializer stub',async t=>{
 const f=fixture(t,{profile:true});assert.equal((await run(['profile-check','--root',f.root])).state,'stub');f.write('profiles/default.md','# Purpose\nMy own headings');f.write('memory/graph.json','bad JSON');const result=await run(['profile-check','--root',f.root]);assert.equal(result.state,'selected');assert.equal(result.graph.available,false);assert.ok(result.graph.error);
 f.write('golem.config.json',{schema_version:1,profile:null});assert.equal((await run(['profile-check','--root',f.root])).state,'none');
 await assert.rejects(()=>run(['stats','--root',f.root,'--source','not-valid-here']),/option/);
});
test('survey distinguishes inclusive overlap, history, open values and uncertain precision',()=>{
 const entities=[{id:'ent-a',kind:'record',type:'other',external_ids:[{scheme:'tracker',namespace:'synthetic',value:'ABC-1'},{scheme:'tracker',namespace:'synthetic',value:'ABC-2'},{scheme:'git',namespace:'synthetic',value:'a'.repeat(40)}]}];
 const claim=(id,subject,value,from,to,precision='exact')=>({id,subject_id:subject,predicate:'has_state',object:{value},status:'active',valid_time:{from,to,precision}});
 const claims=[claim('a','history','A','2026-01-01','2026-01-02'),claim('b','history','B','2026-01-03',null),claim('c','endpoint','A','2026-01-01','2026-01-02'),claim('d','endpoint','B','2026-01-02',null),claim('e','open','A','2026-01-01',null),claim('f','open','B','2026-01-02',null),claim('g','unknown','X',null,null,'unknown'),claim('h','partial','X','2026-01-01',null,'partial')];
 const result=vocabularySurvey({entities,claims},{singleValued:['has_state'],prefix:'tracker:ABC-'}),rows=new Map(result.intervals.rows.map(r=>[r.subject_id,r]));assert.equal(rows.get('history').classification,'history');assert.equal(rows.get('endpoint').classification,'overlap');assert.equal(rows.get('open').classification,'overlap');assert.equal(rows.get('unknown').classification,'unknown');assert.equal(rows.get('partial').classification,'unknown');assert.equal(result.possible_embedded_prefixes.total,2);assert.equal(result.preview.matches.total,2);
 const large=vocabularySurvey({entities:Array.from({length:150},(_,i)=>({id:'ent-'+i,kind:'kind-'+i,type:'other'})),claims:[]});assert.equal(large.entity_kinds.total,150);assert.equal(large.entity_kinds.rows.length,100);assert.equal(large.entity_kinds.truncated,true);
});
