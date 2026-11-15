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

export function validateMemory(graph,{sources={},ledger,queue,previous}={}){
  const errors=schemaErrors(graph);if(errors.length)return errors;
  const fail=message=>errors.push(message);
  function index(rows,name){const map=new Map();for(const row of rows){if(map.has(row.id))fail(name+': duplicate ID '+row.id);map.set(row.id,row);}return map;}
  const es=index(graph.entities,'entities'),cs=index(graph.claims,'claims'),ss=index(graph.sources,'sources');
  for(const id of es.keys())if(cs.has(id))fail('Entity/claim ID collision: '+id);
  const qs=Array.isArray(queue?.questions)?queue.questions:[];
  if(!queue||queue.schema_version!==1||!Array.isArray(queue.questions))fail('Invalid question queue');
  const qi=new Set();for(const q of qs||[]){if(typeof q.id!=='string'||! /^[a-zA-Z0-9_-]{1,80}$/.test(q.id)||qi.has(q.id)||!['open','closed'].includes(q.status)||typeof q.text!=='string'||!q.text.trim()||q.text.length>2000)fail('Invalid/duplicate question');qi.add(q.id);if(!sources[q.source_observation_id])fail('Question source missing: '+q.id);for(const id of q.analysis?.source_observation_ids||[])if(!sources[id])fail('Question analysis source missing: '+q.id);if(q.status==='closed'&&(!q.analysis?.source_observation_ids?.length||q.analysis.status!=='answered'))fail('Closed question needs an analyzed answer: '+q.id);}
  if(!ledger||ledger.schema_version!==1||!Array.isArray(ledger.observations))fail('Invalid processed ledger');
  const processed=new Map();
  for(const row of Array.isArray(ledger?.observations)?ledger.observations:[]){if(processed.has(row.id)||row.status!=='processed'||!sources[row.id]||row.source_file!==sources[row.id]?.path||row.source_sha256!==sources[row.id]?.sha256)fail('Ledger source mismatch: '+row.id);processed.set(row.id,row);if(!ss.has(row.id))fail('Processed source missing from graph: '+row.id);}
  for(const s of graph.sources){const actual=sources[s.id];if(!actual||actual.path!==s.path||actual.sha256!==s.sha256||actual.recorded_at!==s.recorded_at)fail('Graph source mismatch: '+s.id);if(!processed.has(s.id))fail('Graph source is not processed: '+s.id);}
  for(const [id,s]of Object.entries(sources)){if(s.id!==id||s.path!==`inbox/${id}.md`||!s.body?.trim()||!Number.isFinite(Date.parse(s.recorded_at)))fail('Invalid source: '+id);if(s.question_id&&!qi.has(s.question_id))fail('Unknown source question: '+id);}
  for(const e of graph.entities){for(const id of e.source_ids)if(!ss.has(id))fail('Entity source missing: '+e.id);if(Date.parse(e.created_at)>Date.parse(graph.updated_at))fail('Entity created after graph update: '+e.id);}
  for(const c of graph.claims){
    const references = [
      ['subject_id', c.subject_id],
      ['speaker_id', c.speaker_id],
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
  function visit(id,path=new Set()){if(path.has(id)){fail('Correction cycle: '+id);return;}const next=new Set(path).add(id);for(const older of cs.get(id)?.supersedes||[])visit(older,next);}
  for(const c of graph.claims)visit(c.id);
  if(previous){
    if(Date.parse(graph.updated_at)<Date.parse(previous.updated_at))fail('Graph update timestamp went backwards');
    for(const e of previous.entities||[]){const now=es.get(e.id);if(!now||now.type!==e.type||now.created_at!==e.created_at||e.source_ids.some(id=>!now.source_ids.includes(id)))fail('Entity identity/history removed: '+e.id);}
    for(const c of previous.claims||[]){const now=cs.get(c.id);if(!now){fail('Claim history removed: '+c.id);continue;}for(const k of Object.keys(c).filter(k=>k!=='status'))if(JSON.stringify(c[k])!==JSON.stringify(now[k]))fail('Claim history mutated: '+c.id);if(c.status!=='active'&&now.status!==c.status)fail('Claim status history reversed: '+c.id);}
    for(const s of previous.sources||[])if(JSON.stringify(ss.get(s.id))!==JSON.stringify(s))fail('Source history changed: '+s.id);
  }
  return [...new Set(errors)];
}

const terms=text=>String(text).normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replaceAll('ł','l').match(/[\p{L}\p{N}_-]+/gu)||[];
export function retrieveContext(graph,{query='',entity_id='',source_id='',limit=30}={}){
  const tokens=[...new Set(terms(query))],scores=new Map(),entityIds=new Set(entity_id?[entity_id]:[]);
  const score=text=>tokens.reduce((n,t)=>n+(terms(text).some(word=>word===t)?1:0),0);
  for(const e of graph.entities){const n=score([e.label,...e.aliases,e.id].join(' '));if(n)entityIds.add(e.id);}
  for(const c of graph.claims){let n=score([c.predicate,c.object.value??'',...c.sources.map(s=>s.quote)].join(' '));if(!tokens.length&&!entity_id&&!source_id)n=1;if(entityIds.has(c.subject_id)||entityIds.has(c.object.entity_id))n+=4;if(source_id&&c.sources.some(s=>s.observation_id===source_id))n+=8;if(n)scores.set(c.id,n);}
  const bounded=Math.min(100,Math.max(1,Number(limit)||30));
  const ranked=graph.claims.filter(c=>scores.has(c.id)).sort((a,b)=>scores.get(b.id)-scores.get(a.id)||a.id.localeCompare(b.id));
  const selected=ranked.slice(0,bounded),ids=new Set(selected.flatMap(c=>[c.subject_id,c.speaker_id,c.object.entity_id].filter(Boolean)));
  // One graph hop, bounded together with directly ranked claims. Keep correction history.
  const related=graph.claims.filter(c=>!scores.has(c.id)&&(ids.has(c.subject_id)||ids.has(c.object.entity_id)||selected.some(x=>x.supersedes.includes(c.id)||c.supersedes.includes(x.id))));
  const claims=[...selected,...related].slice(0,bounded),allIds=new Set([...entityIds,...claims.flatMap(c=>[c.subject_id,c.speaker_id,c.object.entity_id].filter(Boolean))]);
  const sourceIds=new Set(claims.flatMap(c=>c.sources.map(s=>s.observation_id)));if(source_id)sourceIds.add(source_id);
  return {entities:graph.entities.filter(e=>allIds.has(e.id)),claims,sources:graph.sources.filter(s=>sourceIds.has(s.id)),truncated:ranked.length+related.length>claims.length,limits:{claims:bounded},method:'lexical_exact_tokens_plus_one_graph_hop'};
}

export function memoryStats(graph,sources,ledger,queue){
  const all=Object.values(sources),processed=new Set((ledger.observations||[]).filter(x=>sources[x.id]?.sha256===x.source_sha256).map(x=>x.id));
  const days=new Map();function add(day,key){if(!days.has(day))days.set(day,{day,observations:0,entities:0,claims:0,relations:0});days.get(day)[key]++;}
  for(const s of all)add(s.recorded_at.slice(0,10),'observations');for(const e of graph.entities)add(e.created_at.slice(0,10),'entities');for(const c of graph.claims){add(c.created_at.slice(0,10),'claims');if(c.object.entity_id)add(c.created_at.slice(0,10),'relations');}
  const totals={observations:all.length,processed:processed.size,pending:all.length-processed.size,entities:graph.entities.length,claims:graph.claims.length,relations:graph.claims.filter(c=>c.object.entity_id).length,active_claims:graph.claims.filter(c=>c.status==='active').length,open_questions:queue.questions.filter(q=>q.status==='open').length};
  const cumulative={observations:0,entities:0,claims:0,relations:0};const timeline=[...days.values()].sort((a,b)=>a.day.localeCompare(b.day)).map(day=>{for(const k of Object.keys(cumulative))cumulative[k]+=day[k];return {...day,cumulative:{...cumulative}};});
  return {totals,timeline,graph_updated_at:graph.updated_at,definitions:{relations:'Claims whose object references an entity; a subset of claims, including retained correction history.',timeline:'UTC recording date for observations; actual graph creation date for entities/claims. Migration does not invent earlier graph growth.'}};
}
