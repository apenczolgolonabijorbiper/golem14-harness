import {externalKey,identifierQueryMatch,dependencyErrors,policyWarnings,temporalSelection} from './core-policies.mjs';
import graphSchema from '../schemas/memory-graph.schema.json' with {type:'json'};

// Deliberately bounded JSON Schema vocabulary; unknown keywords fail closed.
export function schemaErrors(value,schema=graphSchema){
  const errors=[],root=schema;
  const supported=new Set(['$schema','$id','title','description','$defs','$ref','type','const','enum','anyOf','properties','required','additionalProperties','items','minItems','maxItems','uniqueItems','minLength','maxLength','pattern','format','minimum','maximum']);
  function check(v,s,path,out){
    for(const key of Object.keys(s))if(!supported.has(key))out.push(path+': unsupported schema keyword '+key);
    if(s.$ref){const name=s.$ref.replace('#/$defs/','');if(!s.$ref.startsWith('#/$defs/')||!root.$defs?.[name])out.push(path+': invalid schema reference');else check(v,root.$defs[name],path,out);return;}
    if(s.anyOf&&!s.anyOf.some(branch=>{const e=[];check(v,branch,path,e);return !e.length;})){out.push(path+': no allowed shape');return;}
    const types=Array.isArray(s.type)?s.type:[s.type];
    const matches=t=>t===undefined||t==='null'&&v===null||t==='array'&&Array.isArray(v)||t==='object'&&v!==null&&typeof v==='object'&&!Array.isArray(v)||t==='number'&&typeof v==='number'&&Number.isFinite(v)||t==='integer'&&Number.isInteger(v)||t==='string'&&typeof v==='string'||t==='boolean'&&typeof v==='boolean';
    if(!types.some(matches)){out.push(path+': invalid type');return;}
    if('const'in s&&v!==s.const)out.push(path+': invalid constant');
    if(s.enum&&!s.enum.includes(v))out.push(path+': invalid enum');
    if(typeof v==='number'&&(v<(s.minimum??-Infinity)||v>(s.maximum??Infinity)))out.push(path+': invalid numeric range');
    if(typeof v==='string'){
      if(s.minLength!==undefined&&v.trim().length<s.minLength||s.maxLength!==undefined&&v.length>s.maxLength)out.push(path+': invalid length');
      if(s.pattern&&!new RegExp(s.pattern).test(v))out.push(path+': invalid pattern');
      if(s.format==='date-time'&&(!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(v)||!Number.isFinite(Date.parse(v))||new Date(v).toISOString().slice(0,19)!==v.slice(0,19)))out.push(path+': invalid timestamp');
    }
    if(Array.isArray(v)){
      if(v.length<(s.minItems??0)||v.length>(s.maxItems??Infinity))out.push(path+': invalid item count');
      if(s.uniqueItems&&new Set(v.map(x=>JSON.stringify(x))).size!==v.length)out.push(path+': duplicate values');
      if(s.items)v.forEach((x,i)=>check(x,s.items,path+'['+i+']',out));
    }else if(v&&typeof v==='object'){
      for(const key of s.required||[])if(!Object.hasOwn(v,key))out.push(path+'.'+key+': required');
      for(const [key,x]of Object.entries(v)){if(s.properties?.[key])check(x,s.properties[key],path+'.'+key,out);else if(s.additionalProperties===false)out.push(path+'.'+key+': unexpected field');}
    }
  }
  check(value,schema,'graph',errors);return errors;
}

export const attributionId = claim => claim.attributed_to_id;
export const classificationName = value => value;

export function validateMemory(graph,{sources={},ledger,queue,previous,metrics}={}){
  const errors=metrics?metrics.sync('schema',()=>schemaErrors(graph)):schemaErrors(graph);if(errors.length)return errors;
  if(previous&&schemaErrors(previous).length)return ['Unsupported/invalid previous graph'];
  let end=metrics?.stage('graph');
  try {
  const fail=message=>errors.push(message);
  function index(rows,name){const map=new Map();for(const row of rows){if(map.has(row.id))fail(name+': duplicate ID '+row.id);map.set(row.id,row);}return map;}
  const es=index(graph.entities,'entities'),cs=index(graph.claims,'claims'),ss=index(graph.sources,'sources');
  for(const id of es.keys())if(cs.has(id))fail('Entity/claim ID collision: '+id);
  const qs=Array.isArray(queue?.questions)?queue.questions:[];
  if(!queue||queue.schema_version!==1||!Array.isArray(queue.questions))fail('Invalid question queue');
  const qi=new Set();for(const q of qs||[]){if(typeof q.id!=='string'||! /^[a-zA-Z0-9_-]{1,80}$/.test(q.id)||qi.has(q.id)||!['open','closed'].includes(q.status)||typeof q.text!=='string'||!q.text.trim()||q.text.length>2000)fail('Invalid/duplicate question');qi.add(q.id);if(!sources[q.source_observation_id])fail('Question source missing: '+q.id);for(const id of q.analysis?.source_observation_ids||[])if(!sources[id])fail('Question analysis source missing: '+q.id);if(q.status==='closed'&&(!q.analysis?.source_observation_ids?.length||q.analysis.status!=='answered'))fail('Closed question needs an analyzed answer: '+q.id);}
  end?.();end=metrics?.stage('provenance');
  if(!ledger||ledger.schema_version!==1||!Array.isArray(ledger.observations))fail('Invalid processed ledger');
  const processed=new Map();
  for(const row of Array.isArray(ledger?.observations)?ledger.observations:[]){if(processed.has(row.id))fail('Duplicate processed row: '+row.id);if(row.status!=='processed'||!sources[row.id]||row.source_file!==sources[row.id]?.path||row.source_sha256!==sources[row.id]?.sha256)fail('Ledger source mismatch: '+row.id);processed.set(row.id,row);if(!ss.has(row.id))fail('Processed source missing from graph: '+row.id);}
  for(const s of graph.sources){const actual=sources[s.id];if(!actual||actual.path!==s.path||actual.sha256!==s.sha256||actual.recorded_at!==s.recorded_at)fail('Graph source mismatch: '+s.id);if(!processed.has(s.id))fail('Graph source is not processed: '+s.id);}
  for(const [id,s]of Object.entries(sources)){if(s.id!==id||s.path!==`inbox/${id}.md`||!s.body?.trim()||!Number.isFinite(Date.parse(s.recorded_at)))fail('Invalid source: '+id);if(s.question_id&&!qi.has(s.question_id))fail('Unknown source question: '+id);}
  errors.push(...dependencyErrors(graph.claims));
  for(const e of graph.entities){
    const keys=new Set();for(const id of e.external_ids??[]){const key=externalKey(id);if(keys.has(key)||id.namespace.trim()!==id.namespace||id.value.trim()!==id.value)fail('Invalid/duplicate external identifier: '+e.id);keys.add(key);}
    for(const id of e.source_ids)if(!ss.has(id))fail('Entity source missing: '+e.id);if(Date.parse(e.created_at)>Date.parse(graph.updated_at))fail('Entity created after graph update: '+e.id);}
  end?.();end=metrics?.stage('claims');
  for(const c of graph.claims){
    const references = [
      ['subject_id', c.subject_id],
      ['attributed_to_id', attributionId(c)],
      ['object.entity_id', c.object.entity_id],
    ];
    const referencedEntities = new Set();
    for (const [field, id] of references) {
      if (id === undefined) continue;
      const entity = es.get(id);
      if (entity) referencedEntities.add(entity);
      else fail(`Claim entity not found: ${c.id} (${field} ${id})`);
    }
    for (const ref of c.sources) {
      const source = sources[ref.observation_id];
      if (!ss.has(ref.observation_id) || !source?.body.includes(ref.quote)) fail('Claim source/quote mismatch: '+c.id);
      for (const entity of referencedEntities) {
        if (!entity.source_ids.includes(ref.observation_id)) fail('Entity provenance does not include claim source: '+c.id);
      }
    }
    if(c.classification==='hypothesis'&&!c.uncertainty.length)fail('Hypothesis requires uncertainty: '+c.id);
    if(c.valid_time.from&&c.valid_time.to&&Date.parse(c.valid_time.from)>Date.parse(c.valid_time.to))fail('Invalid time range: '+c.id);
    if(c.valid_time.precision==='unknown'&&(c.valid_time.from||c.valid_time.to))fail('Unknown time cannot assert bounds: '+c.id);
    if(c.valid_time.precision==='exact'&&!c.valid_time.from)fail('Exact time needs a bound: '+c.id);
    if(Date.parse(c.created_at)>Date.parse(graph.updated_at))fail('Claim created after update: '+c.id);
    if(!c.sources.some(s=>sources[s.observation_id]?.recorded_at===c.asserted_at))fail('Assertion timestamp must match a source: '+c.id);
    for(const id of c.supersedes){const old=cs.get(id);if(!old||id===c.id||old.subject_id!==c.subject_id||old.predicate!==c.predicate||!['superseded','retracted'].includes(old.status))fail('Invalid correction: '+c.id);}
    if(c.status==='superseded'&&!graph.claims.some(x=>x.supersedes.includes(c.id)))fail('Missing replacement claim: '+c.id);
  }
  for(const error of dependencyErrors(graph.claims.map(c=>({...c,depends_on:c.supersedes}))))fail(error.replace('Claim dependency cycle:','Correction cycle:'));
  end?.();end=metrics?.stage('history');
  if(previous){
    if(Date.parse(graph.updated_at)<Date.parse(previous.updated_at))fail('Graph update timestamp went backwards');
    for(const e of previous.entities||[]){const now=es.get(e.id);for(const id of e.external_ids??[])if(!now?.external_ids?.some(x=>externalKey(x)===externalKey(id)))fail('Entity external identifier history removed: '+e.id);if(!now||now.type!==e.type||(e.kind!==undefined&&now.kind!==e.kind)||now.created_at!==e.created_at||e.source_ids.some(id=>!now.source_ids.includes(id)))fail('Entity identity/history removed: '+e.id);}
    for(const c of previous.claims||[]){const now=cs.get(c.id);if(!now){fail('Claim history removed: '+c.id);continue;}if(Object.keys(now).length!==Object.keys(c).length)fail('Claim history mutated: '+c.id);for(const k of Object.keys(c).filter(k=>k!=='status'))if(JSON.stringify(c[k])!==JSON.stringify(now[k]))fail('Claim history mutated: '+c.id);if(c.status!=='active'&&now.status!==c.status)fail('Claim status history reversed: '+c.id);}
    for(const s of previous.sources||[])if(JSON.stringify(ss.get(s.id))!==JSON.stringify(s))fail('Source history changed: '+s.id);
  }
  return [...new Set(errors)];
  } finally {end?.();}
}

const terms=text=>String(text).normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replaceAll('ł','l').match(/[\p{L}\p{N}_-]+/gu)||[];
function lexicalContext(graph,options={}){
  const {query='',entity_id='',source_id='',limit=30,vocabulary}=options;
  const tokens=[...new Set(terms(query))],scores=new Map(),entityIds=new Set([...(options.seed_ids??[]),...(entity_id?[entity_id]:[])]);
  const score=text=>tokens.reduce((n,t)=>n+(terms(text).some(word=>word===t)?1:0),0);
  for(const e of graph.entities){const n=score([e.label,...e.aliases,e.id,e.kind??''].join(' '));if(n||identifierQueryMatch(e,query,vocabulary))entityIds.add(e.id);}
  for(const c of graph.claims){let n=score([c.predicate,c.object.value??'',...c.sources.map(s=>s.quote)].join(' '));if(!tokens.length&&!entity_id&&!source_id&&options.seed_ids===undefined)n=1;if(entityIds.has(c.subject_id)||entityIds.has(c.object.entity_id))n+=4;if(source_id&&c.sources.some(s=>s.observation_id===source_id))n+=8;if(n)scores.set(c.id,n);}
  const bounded=Math.min(100,Math.max(1,Number(limit)||30));
  const ranked=graph.claims.filter(c=>scores.has(c.id)).sort((a,b)=>scores.get(b.id)-scores.get(a.id)||a.id.localeCompare(b.id));
  const selected=ranked.slice(0,bounded),ids=new Set(selected.flatMap(c=>[c.subject_id,attributionId(c),c.object.entity_id].filter(Boolean)));
  // One graph hop, bounded together with directly ranked claims. Keep correction history.
  const related=graph.claims.filter(c=>!scores.has(c.id)&&(ids.has(c.subject_id)||ids.has(c.object.entity_id)||selected.some(x=>x.supersedes.includes(c.id)||c.supersedes.includes(x.id))));
  const claims=[...selected,...related].slice(0,bounded),allIds=new Set([...entityIds,...claims.flatMap(c=>[c.subject_id,attributionId(c),c.object.entity_id].filter(Boolean))]);
  const sourceIds=new Set(claims.flatMap(c=>c.sources.map(s=>s.observation_id)));if(source_id)sourceIds.add(source_id);
  return {entities:graph.entities.filter(e=>allIds.has(e.id)),claims,sources:graph.sources.filter(s=>sourceIds.has(s.id)),truncated:ranked.length+related.length>claims.length,limits:{claims:bounded},method:'lexical_exact_tokens_plus_one_graph_hop'};
}

export function memoryStats(graph,sources,ledger,queue){
  const all=Object.values(sources),processed=new Set((ledger.observations||[]).filter(x=>sources[x.id]?.sha256===x.source_sha256).map(x=>x.id));
  const days=new Map();function add(day,key){if(!days.has(day))days.set(day,{day,observations:0,entities:0,claims:0,relations:0});days.get(day)[key]++;}
  for(const s of all)add(s.recorded_at.slice(0,10),'observations');for(const e of graph.entities)add(e.created_at.slice(0,10),'entities');for(const c of graph.claims){add(c.created_at.slice(0,10),'claims');if(c.object.entity_id)add(c.created_at.slice(0,10),'relations');}
  const totals={observations:all.length,processed:processed.size,pending:all.length-processed.size,entities:graph.entities.length,claims:graph.claims.length,relations:graph.claims.filter(c=>c.object.entity_id).length,active_claims:graph.claims.filter(c=>c.status==='active').length,open_questions:queue.questions.filter(q=>q.status==='open').length};
  const cumulative={observations:0,entities:0,claims:0,relations:0};const timeline=[...days.values()].sort((a,b)=>a.day.localeCompare(b.day)).map(day=>{for(const k of Object.keys(cumulative))cumulative[k]+=day[k];return {...day,cumulative:{...cumulative}};});
  return {capacity:capacity(graph),totals,timeline,graph_updated_at:graph.updated_at,definitions:{relations:'Claims whose object references an entity; a subset of claims, including retained correction history.',timeline:'UTC recording date for observations; actual graph creation date for entities/claims. Migration does not invent earlier graph growth.'}};
}

export const warningCodes = ['unused_entity','duplicate_corroboration','unknown_kind','unknown_predicate','unknown_external_id_scheme','capacity_near_limit','duplicate_external_id','multiple_active_values','dependency_changed'];
export const graphLimits=Object.fromEntries(['sources','entities','claims'].map(key=>[key,graphSchema.properties[key].maxItems]));
export const capacity=graph=>Object.fromEntries(Object.entries(graphLimits).map(([key,limit])=>[key,{used:graph[key].length,limit}]));
export function collectWarnings(graph,{sources={},vocabulary,hypotheses}={}) {
  if (schemaErrors(graph).length) return [];
  const warnings=[], used=new Set(graph.claims.flatMap(c=>[c.subject_id,attributionId(c),c.object.entity_id].filter(Boolean)));
  const add=(code,object_id,message)=>warnings.push({code,object_id,message,documentation:'docs/MEMORY_MODEL.md#validation-warnings'});
  for(const e of graph.entities) {
    if(!used.has(e.id)) add('unused_entity',e.id,'Entity is not referenced by any claim: '+e.id);
    if(e.kind&&vocabulary?.kinds&&!vocabulary.kinds.includes(e.kind))add('unknown_kind',e.id,'Kind is outside the configured vocabulary: '+e.id);
  }
  for(const c of graph.claims) {
    if(vocabulary?.predicates&&!vocabulary.predicates.includes(c.predicate))add('unknown_predicate',c.id,'Predicate is outside the configured vocabulary: '+c.id);
    const ids=[...new Set(c.sources.map(s=>s.observation_id))],bodies=ids.map(id=>sources[id]?.body);
    if(classificationName(c.classification)==='corroborated'&&ids.length>=2&&bodies.every(b=>typeof b==='string')&&new Set(bodies).size===1)add('duplicate_corroboration',c.id,'Possible duplicated corroboration (identical source bodies): '+c.id);
  }
  warnings.push(...policyWarnings(graph,{vocabulary,hypotheses}));
  for(const [name,{used,limit}]of Object.entries(capacity(graph)))if(used>=Math.ceil(limit*.8))add('capacity_near_limit',name,`${name} capacity: ${used}/${limit}`);
  return warnings.sort((a,b)=>a.code.localeCompare(b.code)||a.object_id.localeCompare(b.object_id)||a.message.localeCompare(b.message));
}

function filterList(value,name,pattern) {
  if(value===undefined) return null;
  const list=Array.isArray(value)?value:String(value).split(',');
  if(!list.length||list.some(v=>typeof v!=='string'||!pattern.test(v))||new Set(list).size!==list.length)throw Error('Invalid '+name+' filter');
  return list;
}

function baseContext(graph,options={}) {
  const {query='',entity_id='',source_id='',limit=30}=options;
  if(!Number.isInteger(Number(limit))||Number(limit)<1)throw Error('Invalid limit: expected a positive integer');
  const extended=['predicate','type','kind','status','hops','expansion_budget'].some(k=>options[k]!==undefined);
  if(!extended)return lexicalContext(graph,options);
  const predicates=filterList(options.predicate,'predicate',/^[a-z][a-z0-9_]{1,80}$/);
  const types=filterList(options.type,'type',/^(person|place|event|organization|other)$/);
  const kinds=filterList(options.kind,'kind',/^[a-z][a-z0-9_-]{1,40}$/);
  const status=options.status??'all',hops=Number(options.hops??1),budget=Number(options.expansion_budget??10000);
  if(!['all','active'].includes(status))throw Error('Invalid status: expected active or all');
  if(!Number.isInteger(hops)||hops<1||hops>3)throw Error('Invalid hops: supported range is 1..3');
  if(!Number.isInteger(budget)||budget<1||budget>20000)throw Error('Invalid expansion budget: supported range is 1..20000');
  const allowed=c=>(!predicates||predicates.includes(c.predicate))&&(status==='all'||c.status==='active');
  const eligible=graph.claims.filter(allowed),entityMatches=e=>(!types||types.includes(e.type))&&(!kinds||kinds.includes(e.kind));
  const matchingIds=new Set(graph.entities.filter(entityMatches).map(e=>e.id));
  const presentation=c=>(!types&&!kinds)||matchingIds.has(c.subject_id)||matchingIds.has(c.object.entity_id)||matchingIds.has(attributionId(c));
  const hidden={superseded:0,retracted:0,predicate:0,entity:0};
  for(const c of graph.claims) {
    if(status==='active'&&c.status!=='active')hidden[c.status]++;
    else if(predicates&&!predicates.includes(c.predicate))hidden.predicate++;
  }
  const bounded=Math.min(100,Number(limit)),metadata={},seeds=new Set(options.seed_ids??[]);
  let candidates=[],exhausted=false;
  if(options.hops===undefined) {
    // Same ranking and related selection as the legacy path, but exclusions precede the bound.
    const tokens=[...new Set(terms(query))],score=text=>tokens.reduce((n,t)=>n+(terms(text).includes(t)?1:0),0),scores=new Map();
    if(entity_id)seeds.add(entity_id);
    for(const e of graph.entities)if(score([e.label,...e.aliases,e.id,e.kind??''].join(' '))||identifierQueryMatch(e,query,options.vocabulary))seeds.add(e.id);
    for(const c of eligible){let n=score([c.predicate,c.object.value??'',...c.sources.map(s=>s.quote)].join(' '));if(!tokens.length&&!entity_id&&!source_id&&options.seed_ids===undefined)n=1;if(seeds.has(c.subject_id)||seeds.has(c.object.entity_id))n+=4;if(source_id&&c.sources.some(s=>s.observation_id===source_id))n+=8;if(n)scores.set(c.id,n);}
    const ranked=eligible.filter(c=>scores.has(c.id)).sort((a,b)=>scores.get(b.id)-scores.get(a.id)||a.id.localeCompare(b.id));
    hidden.entity=ranked.filter(c=>!presentation(c)).length;
    const selected=ranked.filter(presentation).slice(0,bounded),ids=new Set(selected.flatMap(c=>[c.subject_id,attributionId(c),c.object.entity_id].filter(Boolean)));
    const related=eligible.filter(c=>!scores.has(c.id)&&(ids.has(c.subject_id)||ids.has(c.object.entity_id)||selected.some(x=>x.supersedes.includes(c.id)||c.supersedes.includes(x.id))));
    hidden.entity+=related.filter(c=>!presentation(c)).length;
    candidates=[...ranked.filter(presentation),...related.filter(presentation)];
    for(const c of candidates)metadata[c.id]={hop:scores.has(c.id)?0:1,parent_entity_id:null};
  }else{
    const tokens=[...new Set(terms(query))],matches=text=>tokens.some(t=>terms(text).includes(t));
    if(entity_id)seeds.add(entity_id);
    for(const e of graph.entities)if(matches([e.label,...e.aliases,e.id,e.kind??''].join(' '))||identifierQueryMatch(e,query,options.vocabulary))seeds.add(e.id);
    for(const c of eligible)if((source_id&&c.sources.some(s=>s.observation_id===source_id))||matches([c.predicate,c.object.value??'',...c.sources.map(s=>s.quote)].join(' ')))for(const id of [c.subject_id,c.object.entity_id].filter(Boolean))seeds.add(id);
    if(!query&&!entity_id&&!source_id&&options.seed_ids===undefined)for(const e of graph.entities)seeds.add(e.id);
    const adjacency=new Map();for(const c of eligible)for(const id of new Set([c.subject_id,c.object.entity_id].filter(Boolean))){if(!adjacency.has(id))adjacency.set(id,[]);adjacency.get(id).push(c);}
    for(const rows of adjacency.values())rows.sort((a,b)=>a.id.localeCompare(b.id));
    let frontier=[...seeds].sort(),visited=new Set(frontier),seen=new Set(),examined=0;
    outer:for(let hop=1;hop<=hops&&frontier.length;hop++){
      const next=new Set();
      for(const id of frontier)for(const c of adjacency.get(id)||[]){
        if(seen.has(c.id))continue;
        if(examined>=budget){exhausted=true;break outer;}examined++;seen.add(c.id);
        metadata[c.id]={hop,parent_entity_id:id};candidates.push(c);
        for(const target of [c.subject_id,c.object.entity_id].filter(Boolean))if(!visited.has(target))next.add(target);
      }
      frontier=[...next].sort();for(const id of frontier)visited.add(id);
    }
    hidden.entity=candidates.filter(c=>!presentation(c)).length;candidates=candidates.filter(presentation);
  }
  const claims=candidates.slice(0,bounded),allIds=new Set([...seeds,...claims.flatMap(c=>[c.subject_id,attributionId(c),c.object.entity_id].filter(Boolean))]);
  const entities=graph.entities.filter(e=>allIds.has(e.id)&&entityMatches(e)),shown=new Set(entities.map(e=>e.id));
  const supporting_entities=graph.entities.filter(e=>!shown.has(e.id)&&claims.some(c=>[c.subject_id,attributionId(c),c.object.entity_id].includes(e.id)));
  const sourceIds=new Set(claims.flatMap(c=>c.sources.map(s=>s.observation_id)));if(source_id)sourceIds.add(source_id);
  return {entities,supporting_entities,claims,sources:graph.sources.filter(s=>sourceIds.has(s.id)),truncated:candidates.length>bounded||exhausted,truncation_reasons:[...(candidates.length>bounded?['claim_limit']:[]),...(exhausted?['expansion_budget']:[])],filters:{predicate:predicates,type:types,kind:kinds,status,hops},hidden,traversal:Object.fromEntries(claims.map(c=>[c.id,metadata[c.id]])),limits:{claims:bounded,expansion_budget:budget},method:options.hops===undefined?'lexical_filtered_plus_one_graph_hop':'lexical_seeds_breadth_first_undirected'};
}


export function retrieveContext(graph,options={}) {
  let selected=graph,metadata=[],hidden={};
  if(options.current!==undefined||options.valid_at!==undefined){const result=temporalSelection(graph,options,options.vocabulary);selected=result.graph;metadata=result.metadata;hidden=result.hidden;}
  // Exact dependency reads narrow the already temporally selected snapshot, so a
  // requested historical record cannot become 'current' just by hiding its peers.
  if(options.claim_ids!==undefined){
    if(!Array.isArray(options.claim_ids)||options.claim_ids.length>100||options.claim_ids.some(id=>typeof id!=='string'||!id.trim())||new Set(options.claim_ids).size!==options.claim_ids.length)throw Error('Invalid exact claim IDs');
    const ids=new Set(options.claim_ids);selected={...selected,claims:selected.claims.filter(c=>ids.has(c.id))};
  }
  const lookup=[options.external_id,options.scheme,options.namespace];
  if(lookup.some(x=>x!==undefined)){
    if(lookup.some(x=>typeof x!=='string'||!x.trim()))throw Error('External lookup requires --external-id, --scheme and --namespace');
    const key=externalKey({scheme:options.scheme,namespace:options.namespace,value:options.external_id});
    options={...options,query:'',seed_ids:graph.entities.filter(e=>(e.external_ids??[]).some(id=>externalKey(id)===key)).map(e=>e.id)};
  }
  const result=baseContext(selected,options);
  const cap=100,entityCount=result.entities.length,sourceCount=result.sources.length;
  result.entities=result.entities.slice(0,cap);result.sources=result.sources.slice(0,cap);
  if(entityCount>cap||sourceCount>cap){result.truncated=true;result.truncation_reasons=[...(result.truncation_reasons??[]),...(entityCount>cap?['entity_limit']:[]),...(sourceCount>cap?['source_limit']:[])];}
  result.limits={...result.limits,entities:cap,sources:cap};
  if(options.current!==undefined||options.valid_at!==undefined){
    result.hidden={...(result.hidden??{}),...hidden};
    const shown=new Set(result.claims.map(c=>c.id));
    const relevant=metadata.filter(m=>m.selected.some(id=>shown.has(id)));
    result.current_selection=relevant.slice(0,cap).map(m=>({...m,selected:m.selected.slice(0,cap),alternatives:m.alternatives.slice(0,cap),alternatives_truncated:m.alternatives.length>cap}));
    result.current_ties=result.current_selection.filter(m=>m.tied);
    result.temporal={valid_at:options.valid_at??null,current:options.current===true||options.current==='true',knowledge:'current correction/retraction knowledge; not a past transaction snapshot'};
  }
  return result;
}
