// Declarative policies only: no evaluated source content, hooks or normalizers.
const slug=/^[a-z][a-z0-9_-]{1,40}$/,predicate=/^[a-z][a-z0-9_]{1,80}$/;
function object(value,allowed,label){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!allowed.includes(k)))throw Error('Invalid '+label);}
export function validateVocabulary(v){
  object(v,['schema_version','kinds','predicates','single_valued','external_id_schemes'],'profile vocabulary');
  if(v.schema_version!==2)throw Error('Invalid vocabulary version: expected 2');
  for(const key of ['kinds','predicates','single_valued'])if(v[key]!==undefined){const xs=v[key],pattern=key==='kinds'?slug:predicate;if(!Array.isArray(xs)||xs.length>500||xs.some(x=>typeof x!=='string'||!pattern.test(x))||new Set(xs).size!==xs.length)throw Error('Invalid vocabulary '+key);}
  if(v.single_valued?.some(x=>v.predicates&&!v.predicates.includes(x)))throw Error('Single-valued predicate outside vocabulary');
  if(v.external_id_schemes!==undefined){
    if(!Array.isArray(v.external_id_schemes)||v.external_id_schemes.length>100)throw Error('Invalid external identifier schemes');
    const seen=new Set();for(const s of v.external_id_schemes){object(s,['scheme','prefixes'],'external identifier scheme');if(typeof s.scheme!=='string'||!slug.test(s.scheme)||seen.has(s.scheme))throw Error('Invalid/duplicate external identifier scheme');seen.add(s.scheme);
      if(s.prefixes!==undefined&&(!Array.isArray(s.prefixes)||s.prefixes.length>20||new Set(s.prefixes).size!==s.prefixes.length||s.prefixes.some(p=>typeof p!=='string'||!p||p.length>100||/\s/.test(p))))throw Error('Invalid identifier prefixes');
    }
  }
}
export const externalKey=id=>JSON.stringify([id.scheme,id.namespace,id.value]);
export const objectKey=object=>Object.hasOwn(object,'entity_id')?JSON.stringify(['entity',object.entity_id]):JSON.stringify(['value',typeof object.value,object.value]);
export function identifierQueryMatch(entity,query,vocabulary){
  const q=String(query??'').trim(),tokens=q.split(/\s+/);
  return (entity.external_ids??[]).some(id=>{
    const prefixes=vocabulary?.external_id_schemes?.find(s=>s.scheme===id.scheme)?.prefixes??[];
    return [id.value,...prefixes.map(prefix=>prefix+id.value)].some(value=>q===value||tokens.includes(value));
  });
}
export function dependencyErrors(claims){
  const byId=new Map(claims.map(c=>[c.id,c])),indegree=new Map(),children=new Map(),errors=[];
  for(const c of claims){indegree.set(c.id,0);for(const id of c.depends_on??[]){if(id===c.id||!byId.has(id)){errors.push('Invalid claim dependency: '+c.id+' -> '+id);continue;}indegree.set(c.id,indegree.get(c.id)+1);if(!children.has(id))children.set(id,[]);children.get(id).push(c.id);}}
  const ready=[...indegree].filter(([,n])=>n===0).map(([id])=>id);let at=0;
  while(at<ready.length){const id=ready[at++];for(const child of children.get(id)??[]){const n=indegree.get(child)-1;indegree.set(child,n);if(n===0)ready.push(child);}}
  if(at!==claims.length)errors.push('Claim dependency cycle: '+[...indegree].filter(([,n])=>n>0).slice(0,10).map(([id])=>id).join(', '));
  return errors;
}
export function policyWarnings(graph,{vocabulary,hypotheses}={}){
  const warnings=[],add=(code,object_id,message)=>warnings.push({code,object_id,message,documentation:'docs/MEMORY_MODEL.md#validation-warnings'}),ids=new Map(),groups=new Map();
  for(const e of graph.entities)for(const id of e.external_ids??[]){const key=externalKey(id);if(!ids.has(key))ids.set(key,[]);ids.get(key).push(e.id);if(vocabulary?.external_id_schemes&&!vocabulary.external_id_schemes.some(s=>s.scheme===id.scheme))add('unknown_external_id_scheme',e.id,'Undeclared external identifier scheme: '+id.scheme);}
  for(const [key,entities]of ids)if(entities.length>1)add('duplicate_external_id',entities[0],'Shared scoped identifier '+key+': '+entities.slice(0,10).join(', ')+(entities.length>10?' (and '+(entities.length-10)+' more)':''));
  for(const c of graph.claims)if(c.status==='active'&&vocabulary?.single_valued?.includes(c.predicate)){const key=JSON.stringify([c.subject_id,c.predicate]);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(c);}
  for(const [key,claims]of groups)if(new Set(claims.map(c=>objectKey(c.object))).size>1)add('multiple_active_values',claims[0].subject_id,'Conflicting active values '+key+': '+claims.slice(0,10).map(c=>c.id).join(', ')+(claims.length>10?' (and '+(claims.length-10)+' more)':''));
  const byId=new Map(graph.claims.map(c=>[c.id,c]));
  const changed=(dependent,refs)=>{for(const id of new Set(refs))if(['superseded','retracted'].includes(byId.get(id)?.status))add('dependency_changed',dependent,'Review '+dependent+': evidence '+id+' is '+byId.get(id).status);};
  for(const c of graph.claims)if(c.status==='active')changed(c.id,c.depends_on??[]);
  for(const h of hypotheses?.hypotheses??[])if(['open','supported'].includes(h.status))changed(h.id,[...h.support,...h.refutation]);
  return warnings;
}
export function timestamp(value,label){if(typeof value!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString().slice(0,19)!==value.slice(0,19))throw Error('Invalid '+label+' timestamp: expected UTC ISO time');return Date.parse(value);}

export function temporalSelection(graph,options,vocabulary){
  const current=options.current===true||options.current==='true';
  if(options.current!==undefined&&![true,false,'true','false'].includes(options.current))throw Error('Invalid current: expected true or false');
  const at=options.valid_at===undefined?null:timestamp(options.valid_at,'valid-at'),now=at??(options.now===undefined?Date.now():timestamp(options.now,'now'));
  if(current&&!vocabulary?.single_valued?.length)throw Error('Current retrieval requires single_valued profile policy');
  let unknown=0,temporal=0,claims=graph.claims;
  if(at!==null)claims=claims.filter(c=>{const t=c.valid_time;if(t.precision==='unknown'||!t.from&&!t.to){unknown++;return false;}const keep=(!t.from||Date.parse(t.from)<=at)&&(!t.to||at<=Date.parse(t.to));if(!keep)temporal++;return keep;});
  const groups=new Map(),keep=new Set(claims.map(c=>c.id)),metadata=[];
  if(current){
    for(const c of claims)if(vocabulary.single_valued.includes(c.predicate)){
      keep.delete(c.id);if(c.status!=='active')continue;
      const key=JSON.stringify([c.subject_id,c.predicate]);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(c);
    }
    for(const [key,rows]of groups){
      const inRange=c=>(!c.valid_time.from||Date.parse(c.valid_time.from)<=now)&&(!c.valid_time.to||now<=Date.parse(c.valid_time.to));
      const effective=rows.filter(c=>c.valid_time.from&&c.valid_time.precision==='exact'&&inRange(c));
      const reported=rows.filter(c=>c.valid_time.from&&['partial','as_reported'].includes(c.valid_time.precision)&&inRange(c));
      const unknown=rows.filter(c=>(!c.valid_time.from||c.valid_time.precision==='unknown')&&inRange(c));
      const uncertain=rows.filter(c=>!c.valid_time.from||c.valid_time.precision!=='exact');
      const pool=effective.length?effective:reported.length?reported:unknown;
      const basis=effective.length?'valid_time.from':reported.length?'valid_time.from_uncertain':'asserted_at_heuristic';
      const value=c=>Date.parse(basis==='asserted_at_heuristic'?c.asserted_at:c.valid_time.from);
      const latest=pool.length?Math.max(...pool.map(value)):null;
      const winners=pool.filter(c=>value(c)===latest).sort((a,b)=>a.id.localeCompare(b.id));
      for(const c of winners)keep.add(c.id);
      const alternatives=rows.filter(c=>!winners.includes(c));
      const [subject_id,predicate]=JSON.parse(key);
      metadata.push({subject_id,predicate,basis,selected:winners.map(c=>c.id),alternatives:alternatives.map(c=>c.id),unresolved:uncertain.length>0||new Set(rows.map(c=>objectKey(c.object))).size>1,tied:new Set(winners.map(c=>objectKey(c.object))).size>1});
    }
  }
  return {graph:{...graph,claims:claims.filter(c=>keep.has(c.id))},metadata,hidden:{unknown_time:unknown,valid_time:temporal,current:claims.filter(c=>!keep.has(c.id)).length}};
}

export function requireCapabilities(status,required=['candidate-validation-v1','core-policies-v2']){
  if(!Array.isArray(required)||required.some(x=>typeof x!=='string'))throw Error('Invalid required capabilities');
  if(!Array.isArray(status?.capabilities)||status.capabilities.some(c=>typeof c!=='string'))throw Error('Adapter missing required capability: invalid capability list');
  const missing=required.filter(c=>!status.capabilities.includes(c));
  if(missing.length)throw Error('Adapter missing required capability: '+missing.join(', '));
  return status;
}
