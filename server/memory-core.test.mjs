import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {validateMemory,retrieveContext,memoryStats,schemaErrors} from './memory-model.mjs';

const sid='00000000-0000-4000-8000-000000000001',at='2026-01-01T12:00:00.000Z',created='2026-02-01T12:00:00.000Z';
function fixture(){
  const body='Synthetic Alice visited Test City.',raw=`---\nid: ${sid}\nrecorded_at: ${at}\n---\n\n${body}\n`;
  const source={id:sid,path:`inbox/${sid}.md`,sha256:createHash('sha256').update(raw).digest('hex'),recorded_at:at,body};
  const sources={[sid]:source},entity=(id,type,label)=>({id,type,label,aliases:[],source_ids:[sid],created_at:created,uncertainty:[]});
  const graph={schema_version:1,updated_at:created,sources:[{id:sid,path:source.path,sha256:source.sha256,recorded_at:at}],entities:[entity('ent-alice','person','Alice'),entity('ent-city','place','Test City')],claims:[{id:'clm-visit',subject_id:'ent-alice',speaker_id:'ent-alice',predicate:'visited',object:{entity_id:'ent-city'},classification:'user_declaration',sources:[{observation_id:sid,quote:body}],asserted_at:at,valid_time:{from:null,to:null,expression:null,precision:'unknown'},status:'active',supersedes:[],uncertainty:[],created_at:created}]};
  const ledger={schema_version:1,observations:[{id:sid,status:'processed',source_file:source.path,source_sha256:source.sha256}]},queue={schema_version:1,questions:[{id:'q1',text:'Where?',status:'open',source_observation_id:sid}]};
  return {graph,sources,ledger,queue,raw};
}
test('schema and provenance reject corruption and dangling references',()=>{
  const f=fixture();assert.deepEqual(validateMemory(f.graph,f),[]);
  for(const mutate of [g=>g.entities.push(structuredClone(g.entities[0])),g=>g.claims[0].subject_id='ent-missing',g=>g.sources[0].sha256='0'.repeat(64),g=>g.claims[0].sources[0].quote='Not in source',g=>g.claims[0].valid_time.from='2026-01-01T12:00:00Z',g=>g.claims[0].asserted_at=created,g=>g.claims[0].status='superseded',g=>g.claims[0].unknown=true,g=>g.entities[0].created_at='2026-02-30T12:00:00Z']){
    const g=structuredClone(f.graph);mutate(g);assert.ok(validateMemory(g,f).length);
  }
  assert.ok(schemaErrors({...f.graph,schema_version:2}).length);
  const bad=structuredClone(f);bad.ledger.observations[0].source_sha256='wrong';assert.ok(validateMemory(bad.graph,bad).length);
  const q=structuredClone(f);q.queue.questions[0].status='closed';assert.ok(validateMemory(q.graph,q).length);
});
test('corrections preserve old claims and entity identities',()=>{
  const f=fixture(),before=structuredClone(f.graph);f.graph.claims[0].status='superseded';const replacement=structuredClone(f.graph.claims[0]);replacement.id='clm-correction';replacement.status='active';replacement.supersedes=['clm-visit'];replacement.object={value:'corrected synthetic statement'};f.graph.claims.push(replacement);
  assert.deepEqual(validateMemory(f.graph,{...f,previous:before}),[]);
  const changed=structuredClone(f.graph);changed.claims[0].object={value:'rewritten'};assert.ok(validateMemory(changed,{...f,previous:before}).length);
  const removed=structuredClone(f.graph);removed.entities.shift();assert.ok(validateMemory(removed,{...f,previous:before}).length);
  const cycle=structuredClone(f.graph);cycle.claims[0].supersedes=['clm-correction'];cycle.claims[1].status='superseded';assert.ok(validateMemory(cycle,f).some(x=>x.includes('cycle')));
});
test('context resolves aliases and graph neighbors with bounded, cited results',()=>{
  const f=fixture();f.graph.entities[0].aliases=['Żółć'];const hit=retrieveContext(f.graph,{query:'zolc'});assert.equal(hit.claims[0].id,'clm-visit');assert.equal(hit.sources[0].id,sid);assert.equal(hit.entities.length,2);
  assert.equal(retrieveContext(f.graph,{query:'no-such-token'}).claims.length,0);
  assert.equal(retrieveContext(f.graph,{entity_id:'ent-city'}).claims.length,1);
  assert.equal(retrieveContext(f.graph,{source_id:sid,limit:1}).claims.length,1);
});
test('stats distinguish observations, claims, relations and true creation dates',()=>{
  const f=fixture();f.graph.claims.push({...structuredClone(f.graph.claims[0]),id:'clm-label',predicate:'note',object:{value:'Synthetic'}});
  const s=memoryStats(f.graph,f.sources,f.ledger,f.queue);assert.equal(s.totals.claims,2);assert.equal(s.totals.relations,1);assert.equal(s.totals.observations,1);assert.equal(s.timeline[0].entities,0);assert.equal(s.timeline[1].entities,2);assert.equal(s.timeline[1].cumulative.observations,1);
});
