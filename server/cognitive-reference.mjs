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

// Normal host path: immutable provider handles, bounded context and source reads.
export async function createProviderReadView(provider,snapshot){
  const {createMemory}=await import('./provider-memory.mjs');
  const {records,evidenceBytes}=await import('./memory-contract.mjs');
  const {parseSource}=await import('./observation.mjs');
  const memory=createMemory(provider),meta=await memory.open(snapshot);
  const binding={instance_id:meta.instance_id,snapshot_id:meta.snapshot_id,guidance_id:meta.policy_id};
  const counts=await provider.counts({snapshot});
  const pending_count=counts.observations-counts.processed;
  return {binding,pending_count,guidance:structuredClone(meta.policy),
    async context(options){
      const filters={...options},temporalUnavailable=filters.current&&!meta.policy.vocabulary?.single_valued?.length;
      if(temporalUnavailable)delete filters.current;
      const c=await memory.context(snapshot,filters),sourceSet=new Set(c.sources.map(s=>s.id));
      const claims=c.claims.filter(c=>c.sources.every(s=>sourceSet.has(s.observation_id))),ids=new Set(claims.map(c=>c.id));
      const missing=claims.flatMap(c=>(c.depends_on??[]).filter(id=>!ids.has(id)));
      return {protocol_version:1,binding,request_id:JSON.stringify(options).slice(0,180)||'context',claims,entities:c.entities,sources:c.sources.map(({id,sha256,recorded_at})=>({id,sha256,recorded_at})),selection:{current:c.temporal?.current??false,alternatives:c.current_selection??[],hidden:c.hidden??{},knowledge:c.temporal?.knowledge??'Snapshot evidence; recency not inferred'},dependencies:claims.map(c=>({claim_id:c.id,premise_ids:c.depends_on??[]})),warnings:[...c.warnings.map(w=>w.message),...(temporalUnavailable?['No single-valued policy selected; temporal recency was not inferred.']:[]),...(missing.length?['Dependencies omitted; retrieve claim_ids before deriving conclusions.']:[]),c.knowledge].slice(0,100),truncated:!!c.truncated||missing.length>0||claims.length<c.claims.length,truncation_reasons:[...(c.truncation_reasons??[]),...(missing.length?['dependencies_omitted']:[]),...(claims.length<c.claims.length?['source_limit']:[])],pending_count,valid_at:options.valid_at??null,method:c.method};
    },
    async source(id,{start,length,max_bytes}){
      const row=await memory.read(snapshot,'processed',id);if(!row)throw Error('Source missing or unprocessed');
      const descriptor=await memory.read(snapshot,'observations',id);
      const raw=await evidenceBytes(provider,snapshot,id),s=parseSource(descriptor.path,new TextDecoder('utf-8',{fatal:true}).decode(raw));
      let text='',bytes=0;for(const cp of s.body.slice(start,start+length)){const n=Buffer.byteLength(cp,'utf8');if(bytes+n>max_bytes)break;text+=cp;bytes+=n;}
      return {binding,id,sha256:s.sha256,start,text,truncated:start>0||text.length<s.body.length,processed:true};
    },
  };
}
