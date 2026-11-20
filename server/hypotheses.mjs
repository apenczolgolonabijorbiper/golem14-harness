import schema from '../schemas/hypotheses.schema.json' with {type:'json'};
import {schemaErrors} from './memory-model.mjs';
export function validateHypotheses(value,graph,{path='memory/hypotheses.json'}={}){
  const errors=schemaErrors(value,schema).map(e=>path+': '+e.replace(/^graph/,'hypotheses'));
  if(errors.length)return errors;
  const seen=new Set(),claims=new Set(graph.claims.map(c=>c.id)),sources=new Set(graph.sources.map(s=>s.id));
  for(const h of value.hypotheses){
    if(seen.has(h.id))errors.push(path+': duplicate hypothesis ID '+h.id);seen.add(h.id);
    if(Date.parse(h.updated_at)>Date.parse(value.updated_at))errors.push(path+': hypothesis updated after collection '+h.id);
    for(const id of [...h.support,...h.refutation])if(!claims.has(id))errors.push(path+': hypothesis claim not found: '+h.id+' -> '+id);
    for(const id of h.observation_ids??[])if(!sources.has(id))errors.push(path+': hypothesis source not found: '+h.id+' -> '+id);
    if(h.status==='supported'&&!h.support.length||h.status==='refuted'&&!h.refutation.length)errors.push(path+': hypothesis status needs evidence: '+h.id);
  }
  return errors;
}
