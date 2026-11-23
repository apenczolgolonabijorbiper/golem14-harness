// JSON reference read view only. Other hosts implement the same bounded operations
// over their own immutable snapshot; the cognition core has no file/Git dependency.
import {retrieveContext,validateMemory,collectWarnings} from './memory-model.mjs';
import {validateHypotheses} from './hypotheses.mjs';
export function createMemoryReadView({binding,state,guidance}){
  const captured=structuredClone(state),bound=structuredClone(binding),vocabulary=structuredClone(guidance.vocabulary);
  const errors=[...validateMemory(captured.graph,captured),...validateHypotheses(captured.hypotheses,captured.graph)];
  if(errors.length)throw Error('Invalid committed cognition snapshot: '+errors[0]);
  const {graph,sources,ledger}=captured;
  for(const key of ['claims','entities','sources'])graph[key].sort((a,b)=>a.id.localeCompare(b.id));
  const processed=new Set(ledger.observations.map(r=>r.id));
  const pending_count=Object.keys(sources).filter(id=>!processed.has(id)).length;
  const warnings=collectWarnings(graph,{...captured,vocabulary}).map(w=>w.message).slice(0,100);
  return {
    binding:structuredClone(bound),pending_count,guidance:structuredClone(guidance),
    async context(options){
      const {claim_ids,subject_ids=[],...filters}=options;
      if(claim_ids&&(!Array.isArray(claim_ids)||claim_ids.length>100||claim_ids.some(id=>typeof id!=='string')))throw Error('Invalid claim_ids');
      let selected=subject_ids.length?{...graph,claims:graph.claims.filter(c=>subject_ids.some(id=>[c.subject_id,c.object.entity_id,c.attributed_to_id].includes(id)))}:graph;
      const temporalUnavailable=filters.current&&!vocabulary?.single_valued?.length;
      if(temporalUnavailable)delete filters.current;
      const c=retrieveContext(selected,{...filters,...(claim_ids?{claim_ids}:{}),now:graph.updated_at,vocabulary});
      // Existing context caps source metadata. Do not leave dangling citations.
      const sourceSet=new Set(c.sources.map(s=>s.id)),before=c.claims.length;
      c.claims=c.claims.filter(c=>c.sources.every(s=>sourceSet.has(s.observation_id)));
      if(c.claims.length<before){c.truncated=true;c.truncation_reasons=[...(c.truncation_reasons??[]),'source_limit'];}
      const ids=new Set(c.claims.map(c=>c.id)),missing=c.claims.flatMap(c=>(c.depends_on??[]).filter(id=>!ids.has(id)));
      return structuredClone({protocol_version:1,binding:structuredClone(bound),request_id:JSON.stringify(options).slice(0,180)||'context',claims:c.claims,entities:c.entities,sources:c.sources.map(({id,sha256,recorded_at})=>({id,sha256,recorded_at})),selection:{current:c.temporal?.current??false,alternatives:c.current_selection??[],hidden:c.hidden??{},knowledge:c.temporal?.knowledge??'Snapshot evidence; recency not inferred'},dependencies:c.claims.map(c=>({claim_id:c.id,premise_ids:c.depends_on??[]})),warnings:[...warnings,...(temporalUnavailable?['No single-valued policy selected; temporal recency was not inferred.']:[]),...(missing.length?['Dependencies omitted; retrieve claim_ids before deriving conclusions.']:[]),'Zero hits do not establish absence; pending intake is not analyzed memory.'].slice(0,100),truncated:!!c.truncated||missing.length>0,truncation_reasons:[...(c.truncation_reasons??[]),...(missing.length?['dependencies_omitted']:[])],pending_count,valid_at:options.valid_at??null,method:c.method});
    },
    async source(id,{start,length,max_bytes}){
      if(!processed.has(id)||!sources[id])throw Error('Source missing or unprocessed');
      const s=sources[id];let text='',bytes=0;
      for(const cp of s.body.slice(start,start+length)){const n=Buffer.byteLength(cp,'utf8');if(bytes+n>max_bytes)break;text+=cp;bytes+=n;}
      return {binding:structuredClone(bound),id,sha256:s.sha256,start,text,truncated:start>0||text.length<s.body.length,processed:true};
    },
  };
}
