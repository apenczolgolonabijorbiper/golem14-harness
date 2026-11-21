import {loadProfile,readInstanceFile,utf8,sha256} from './application-profile.mjs';
import {loadGuidance,guidanceIdentity} from './guidance.mjs';
import {identifierQueryMatch} from './core-policies.mjs';
import {readApplicationSource,compareSource,managedPaths} from './application-source.mjs';
const stub='# Purpose\n\nDescribe the memory purpose.\n\n## Entity kinds\n\n## Predicates\n\n## Evidence rules\n\n## Review focus\n';
export const bounded = (rows,limit=100) => ({rows:rows.slice(0,limit),total:rows.length,truncated:rows.length>limit});
const counts=values=>[...values.reduce((m,x)=>m.set(x,(m.get(x)||0)+1),new Map())].sort(([a],[b])=>a.localeCompare(b)).map(([value,count])=>({value,count}));
export async function profileCheck(root,{kinds,state,graphError,source}={}) {
  const observed=[...new Set(Object.values(state?.sources??{}).map(s=>s.kind).filter(Boolean))].sort();
  const selectedKinds=kinds===undefined?observed:[...new Set(kinds)].sort();
  const p=await loadProfile(root,{kinds:selectedKinds}),g=await loadGuidance(root,{kinds:selectedKinds});
  const paths=await managedPaths(root),files=[];
  for(const path of ['instance/purpose.md',...paths]){const bytes=await readInstanceFile(root,path);files.push({path,sha256:sha256(bytes),lines:utf8(bytes).split('\n').length,bytes:bytes.length,budget:'advisory'});}
  let cfg=null;if(p)cfg=JSON.parse(utf8(await readInstanceFile(root,'golem.config.json'))).profile;
  const selectors=(cfg?.sections??[]).map(s=>({id:s.id,kinds:s.kinds,selected:s.kinds.some(k=>selectedKinds.includes(k)),unseen:s.kinds.filter(k=>!observed.includes(k))}));
  const batches=[];for(const kind of selectedKinds){const batch=await loadGuidance(root,{kinds:[kind]});batches.push({kind,section_ids:batch.guidance_version.profile?.sections.map(s=>s.id)??[],guidance_identity:guidanceIdentity(batch.guidance_version)});}
  const vocabulary={};
  if(state&&!graphError)for(const [name,used]of [['kinds',state.graph.entities.map(e=>e.kind).filter(Boolean)],['predicates',state.graph.claims.map(c=>c.predicate)]]){const declared=p?.vocabulary?.[name];vocabulary[name]={used:bounded(counts(used)),used_but_undeclared:declared?bounded(counts(used.filter(v=>!declared.includes(v)))):null,declared_but_unused:bounded((declared??[]).filter(v=>!used.includes(v)).sort())};}
  const text=p?.guidance??'',purpose=utf8(await readInstanceFile(root,'instance/purpose.md'));
  const headings=s=>s.split('\n').filter(l=>/^#+ /.test(l)).map(l=>l.replace(/^#+ /,'').trim().toLowerCase());
  return {state:!p?'none':sha256(await readInstanceFile(root,cfg.path))===sha256(stub)?'stub':'selected',selected_paths:paths,files,observed_kinds:bounded(observed),requested_kinds:bounded(selectedKinds),selectors:bounded(selectors),batches:bounded(batches),guidance_version:g.guidance_version,guidance_identity:guidanceIdentity(g.guidance_version),vocabulary,graph:graphError?{available:false,error:graphError}:{available:!!state},advisories:{heuristic_duplicate_headings:headings(purpose).filter(h=>headings(text).includes(h)),line_counts:'Advisory only; duplicate headings do not prove semantic conflict'},...(source?{comparison:await compareSource(root,await readApplicationSource(source))}:{})};
}
export function vocabularySurvey(graph,{singleValued=[],prefix,vocabulary}={}) {
  const identifiers=graph.entities.flatMap(e=>(e.external_ids??[]).map(i=>({...i,entity_id:e.id})));
  const entities=new Map(graph.entities.map(e=>[e.id,e]));
  const shapes=counts(graph.claims.map(c=>`${entities.get(c.subject_id)?.kind??'?'} / ${c.predicate} / ${c.object.entity_id?'entity:'+String(entities.get(c.object.entity_id)?.kind??'?'):typeof c.object.value}`));
  const patterns=identifiers.filter(i=>!/^([a-f0-9]{32,}|[a-f0-9]{8}-[a-f0-9-]{27,})$/i.test(i.value)).map(i=>({scheme:i.scheme,namespace:i.namespace,value:i.value,prefix:i.value.match(/^([A-Za-z][A-Za-z0-9]*[-_:])\d+$/)?.[1]})).filter(i=>i.prefix);
  const temporal=[];
  for(const predicate of [...new Set(singleValued)].sort()){
    const groups=new Map();for(const c of graph.claims.filter(c=>c.predicate===predicate&&c.status==='active')){const key=c.subject_id;const rows=groups.get(key)??[];rows.push(c);groups.set(key,rows);}
    for(const [subject,rows]of [...groups].sort(([a],[b])=>a.localeCompare(b))){
      const unknown=rows.filter(c=>c.valid_time.precision!=='exact'||!c.valid_time.from&&!c.valid_time.to),exact=rows.filter(c=>!unknown.includes(c));
      // Sweep endpoints, retaining only per-value maximum ends: O(n log n), inclusive endpoints.
      const sorted=exact.map(c=>({claim:c.id,value:JSON.stringify(c.object),from:c.valid_time.from?Date.parse(c.valid_time.from):-Infinity,to:c.valid_time.to?Date.parse(c.valid_time.to):Infinity})).sort((a,b)=>a.from-b.from||a.claim.localeCompare(b.claim));
      let greatest=null,second=null,overlaps=0;
      for(const c of sorted){
        const competing=greatest?.value===c.value?second:greatest;
        if(competing&&competing.to>=c.from)overlaps++;
        if(greatest?.value===c.value){greatest.to=Math.max(greatest.to,c.to);}
        else if(!greatest||c.to>greatest.to){second=greatest;greatest={value:c.value,to:c.to};}
        else if(second?.value===c.value){second.to=Math.max(second.to,c.to);}
        else if(!second||c.to>second.to){second={value:c.value,to:c.to};}
      }
      temporal.push({subject_id:subject,predicate,claims:rows.length,unknown_or_partial:unknown.length,competing_interval_starts:overlaps,classification:overlaps?'overlap':unknown.length?'unknown':'history'});
    }
  }
  let preview;
  if(prefix){const split=prefix.indexOf(':');if(split<1)throw Error('--prefix expects scheme:PFX');const scheme=prefix.slice(0,split),value=prefix.slice(split+1);preview={scheme,prefix:value,text_query_matches:bounded(graph.entities.filter(e=>identifierQueryMatch(e,value,vocabulary)).map(e=>e.id).sort()),matches:bounded(identifiers.filter(i=>i.scheme===scheme&&i.value.startsWith(value)).sort((a,b)=>a.value.localeCompare(b.value))),semantics:'Advisory prefix preview; external-id retrieval remains exact and does not strip prefixes'};}
  return {entity_kinds:bounded(counts(graph.entities.map(e=>e.kind??'(absent)'))),entity_types:bounded(counts(graph.entities.map(e=>e.type))),predicate_shapes:bounded(shapes),identifiers:bounded(counts(identifiers.map(i=>`${i.scheme} / ${i.namespace} / ${/^\d+$/.test(i.value)?'digits':/^[a-f0-9]{40}$|^[a-f0-9]{64}$/i.test(i.value)?'hash':'text'}`))),possible_embedded_prefixes:bounded(patterns),intervals:bounded(temporal),limits:{rows_per_category:100,interval_cost:'Sorting plus per-distinct-value sweep; O(n log n) sorting plus O(n) endpoint sweep; closed inclusive endpoints',graph_read:'One local graph snapshot; no source body sampling'},...(preview?{preview}:{})};
}
