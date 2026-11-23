import taskSchema from '../schemas/cognitive-task.schema.json' with {type:'json'};
import resultSchema from '../schemas/cognitive-result.schema.json' with {type:'json'};
import learningSchema from '../schemas/cognitive-learning.schema.json' with {type:'json'};
import contextSchema from '../schemas/cognitive-context.schema.json' with {type:'json'};
import {schemaErrors} from './memory-model.mjs';

export const cognitiveCapabilities = ['cognitive-task-v1','cognitive-context-v1','cognitive-result-v1','learning-hypothesis-v1','hypothesis-unknown-confidence-v1'];
const equalBinding=(a,b)=>a&&b&&['instance_id','snapshot_id','guidance_id'].every(k=>a[k]===b[k]);
const check=(value,schema)=>schemaErrors(value,schema).map(e=>e.replace(/^graph/,'cognition'));
const fail=errors=>{if(errors.length)throw Error(errors.join('\n'));};
function unique(rows,label,errors){const ids=new Set();for(const row of rows){if(ids.has(row.id))errors.push('Duplicate '+label+': '+row.id);ids.add(row.id);}return ids;}
export function validateTask(task){
  const errors=check(task,taskSchema);if(errors.length)return errors;
  if(!task.messages.length)errors.push('A task needs at least one message');
  const ids=new Set();
  for(const m of task.messages){
    if(ids.has(m.id))errors.push('Duplicate message: '+m.id);
    for(const id of m.reply_to)if(!ids.has(id))errors.push('Reply must reference an earlier message: '+id);
    if(m.kind==='question_answer'&&!m.reply_to.length)errors.push('Question answer needs explicit reply links');
    if(['user_question','user_request','question_answer'].includes(m.kind)&&m.author!=='user')errors.push('User message has wrong author');
    if(['cognitive_question','hypothesis'].includes(m.kind)&&m.author!=='golem'||m.kind==='collection_request'&&m.author!=='application'&&m.author!=='golem')errors.push('Cognitive message has wrong author');
    if(m.intent.origin!==m.author)errors.push('Intent origin differs from message author');
    if(m.intent.basis==='inferred'&&!m.intent.uncertainty.length)errors.push('Inferred intent needs uncertainty');
    ids.add(m.id);
  }
  return errors;
}
export function validateContext(bundle,binding){
  const errors=check(bundle,contextSchema);if(errors.length)return errors;
  if(!equalBinding(bundle.binding,binding))errors.push('Context binding mismatch');
  unique(bundle.claims,'context claim',errors);unique(bundle.entities,'context entity',errors);const ss=unique(bundle.sources,'context source',errors);
  for(const c of bundle.claims){if(typeof c.id!=='string'||!Array.isArray(c.sources))errors.push('Malformed context claim');else for(const s of c.sources)if(!ss.has(s.observation_id))errors.push('Context source missing');}
  if(bundle.truncation_reasons.length&&!bundle.truncated)errors.push('Truncation flag missing');
  return errors;
}

// trusted is host-retained delivery data, never supplied or amended by the executor.
export function validateResult(result,task,trusted){
  const errors=[...validateTask(task),...check(result,resultSchema)];if(errors.length)return errors;
  if(result.task_id!==task.task_id||!equalBinding(result.binding,task.binding)||!equalBinding(trusted.binding,task.binding))errors.push('Result task/snapshot/guidance mismatch');
  const fs=unique(result.findings,'finding',errors),claims=new Map(trusted.claims.map(c=>[c.id,c]));
  const messages=new Set(task.messages.map(m=>m.id));unique(result.questions,'question',errors);
  const ancestry=new Map();
  for(const f of result.findings){
    ancestry.set(f.id,f.premise_ids);
    for(const id of f.claim_ids)if(!claims.has(id))errors.push('Undelivered/cross-instance claim: '+id);
    for(const id of f.premise_ids)if(!fs.has(id)||id===f.id)errors.push('Invalid finding premise: '+id);
    if(f.classification==='source_assertion'&&(!f.claim_ids.length||!f.evidence.length))errors.push('Source assertion needs claims and exact evidence');
    if(f.classification==='derived_conclusion'&&!f.premise_ids.length)errors.push('Derived conclusion needs premises');
    if(f.classification==='hypothesis'&&!f.uncertainty.length)errors.push('Hypothesis needs uncertainty');
    if(f.classification==='general_model_knowledge'&&(f.claim_ids.length||f.evidence.length||f.premise_ids.length))errors.push('General model knowledge cannot fabricate memory provenance');
    for(const r of f.evidence){
      const segment=trusted.sources.find(s=>s.id===r.source_id&&s.sha256===r.sha256&&r.start>=s.start&&r.start+r.quote.length<=s.start+s.text.length);
      if(!segment||segment.text.slice(r.start-segment.start,r.start-segment.start+r.quote.length)!==r.quote)errors.push('Source hash/locator/quote mismatch: '+r.source_id);
      if(!f.claim_ids.some(id=>claims.get(id)?.sources.some(s=>s.observation_id===r.source_id)))errors.push('Evidence is not linked to a cited claim');
    }
  }
  const done=new Set(),visiting=new Set();
  function visit(id){if(visiting.has(id)){errors.push('Finding dependency cycle');return;}if(done.has(id))return;visiting.add(id);for(const p of ancestry.get(id)??[])if(fs.has(p))visit(p);visiting.delete(id);done.add(id);}
  for(const id of fs)visit(id);
  for(const q of result.questions){if(messages.has(q.id)||fs.has(q.id))errors.push('Question ID collision');for(const id of q.reply_to)if(!messages.has(id))errors.push('Question reply target missing');for(const id of q.premise_ids)if(!fs.has(id))errors.push('Question premise missing');if(q.intent.origin!=='golem'||q.intent.basis==='inferred'&&!q.intent.uncertainty.length)errors.push('Invalid question intent');}
  if(result.outcome==='answer'&&result.stop_reason!=='complete')errors.push('Incomplete stop cannot be a complete answer');
  if(result.stop_reason==='missing_evidence'&&!result.questions.length&&!result.uncertainty.length)errors.push('Missing evidence requires a question or uncertainty');
  if(result.coverage.truncated!==trusted.coverage.truncated||result.coverage.pending_count!==trusted.coverage.pending_count||result.coverage.valid_at!==task.scope.valid_at)errors.push('Coverage metadata lost');
  for(const key of ['rounds','context_requests','source_bytes','elapsed_ms']){
    if(result.usage[key]>task.limits[key]&&!(key==='elapsed_ms'&&result.stop_reason==='budget'))errors.push('Task budget exceeded: '+key);
    if(result.usage[key]!==trusted.usage[key])errors.push('Usage receipt mismatch: '+key);
  }
  return errors;
}
export function validateLearning(proposal,task,trusted){
  const errors=[...validateTask(task),...check(proposal,learningSchema)];if(errors.length)return errors;
  if(task.mode!=='propose_learning')errors.push('Read-only task cannot propose learning');
  if(proposal.task_id!==task.task_id||!equalBinding(proposal.binding,task.binding)||!equalBinding(trusted.binding,task.binding))errors.push('Learning binding mismatch');
  const claims=new Map(trusted.claims.map(c=>[c.id,c]));
  for(const id of [...proposal.support,...proposal.refutation])if(!claims.has(id))errors.push('Learning premise missing: '+id);else if(claims.get(id).status!=='active')errors.push('Learning premise is no longer active: '+id);
  if(!proposal.uncertainty.length||!proposal.verification_needed.length)errors.push('Learning hypotheses require uncertainty and verification');
  if(proposal.operation==='add_hypothesis'&&proposal.target_id!==null||proposal.operation==='correct_hypothesis'&&(!proposal.target_id||proposal.target_id===proposal.hypothesis_id))errors.push('Invalid correction target');
  if(!/^[a-z][a-z0-9_-]{2,100}$/.test(proposal.hypothesis_id))errors.push('Invalid hypothesis ID');
  if(new Set(proposal.support).size!==proposal.support.length||new Set(proposal.refutation).size!==proposal.refutation.length||proposal.support.some(id=>proposal.refutation.includes(id)))errors.push('Duplicate/contradictory learning premises');
  return errors;
}

// A bounded per-invocation executor interface. Host supplies an immutable read view;
// the core never loads graph files, chooses a provider or dispatches an executor.
export function createCognitiveSession(task,view,{now=()=>Date.now(),cancelled=()=>false}={}){
  task=structuredClone(task);fail(validateTask(task));if(!equalBinding(task.binding,view.binding))throw Error('Snapshot binding mismatch');
  const started=now(),usage={rounds:0,context_requests:0,source_bytes:0,elapsed_ms:0};
  const sourceHashes=new Map(),claims=new Map(),sources=[],coverage={truncated:false,pending_count:view.pending_count??0,valid_at:task.scope.valid_at};
  const audit=()=>structuredClone({binding:task.binding,claims:[...claims.values()],sources,coverage,usage});
  function guard(){usage.elapsed_ms=Math.max(0,now()-started);if(cancelled())throw Error('cancelled');if(usage.elapsed_ms>=task.limits.elapsed_ms)throw Error('budget');}
  const api={
    beginRound(){guard();if(usage.rounds>=task.limits.rounds)throw Error('budget');usage.rounds++;},
    async context(options={}){
      guard();if(usage.context_requests>=task.limits.context_requests)throw Error('budget');usage.context_requests++;
      const allowed=['query','entity_id','source_id','predicate','type','kind','status','hops','external_id','scheme','namespace','limit','claim_ids','current'];
      if(Object.keys(options).some(k=>!allowed.includes(k)))throw Error('Unsupported context option');
      const limit=options.limit??task.limits.claims;if(!Number.isInteger(limit)||limit<1||limit>task.limits.claims)throw Error('Claim limit exceeded');
      const bundle=await view.context({...options,subject_ids:task.scope.subject_ids,limit,expansion_budget:task.limits.expansion_budget,...(task.scope.valid_at?{valid_at:task.scope.valid_at}:{current:options.current??true})});
      guard();fail(validateContext(bundle,task.binding));
      if(bundle.claims.length>limit||bundle.pending_count!==coverage.pending_count||bundle.valid_at!==task.scope.valid_at)throw Error('Provider context limits/scope mismatch');
      for(const s of bundle.sources){if(sourceHashes.has(s.id)&&sourceHashes.get(s.id)!==s.sha256)throw Error('Changed snapshot source');sourceHashes.set(s.id,s.sha256);}
      for(const c of bundle.claims){const old=claims.get(c.id);if(old&&JSON.stringify(old)!==JSON.stringify(c))throw Error('Changed snapshot claim');claims.set(c.id,structuredClone(c));}
      coverage.truncated ||= bundle.truncated;return structuredClone(bundle);
    },
    async source(id,{start=0,length=4000}={}){
      guard();if(usage.context_requests>=task.limits.context_requests)throw Error('budget');usage.context_requests++;
      if(!Number.isInteger(start)||start<0||!Number.isInteger(length)||length<1||length>16000)throw Error('Invalid source range');
      if(![...claims.values()].some(c=>c.sources.some(s=>s.observation_id===id)))throw Error('Source was not retrieved');
      const remaining=task.limits.source_bytes-usage.source_bytes;if(remaining<=0)throw Error('budget');
      const s=await view.source(id,{start,length,max_bytes:remaining});guard();
      const bytes=Buffer.byteLength(s.text,'utf8');
      if(!equalBinding(s.binding,task.binding)||s.id!==id||s.start!==start||bytes>remaining||s.text.length>length||s.sha256!==sourceHashes.get(id))throw Error('Source binding/range mismatch');
      usage.source_bytes+=bytes;coverage.truncated ||= s.truncated;sources.push(structuredClone(s));return structuredClone(s);
    },
    receipt(){usage.elapsed_ms=Math.max(0,now()-started);return audit();},
    finish(result){const trusted=api.receipt();const sealed={...structuredClone(result),usage:trusted.usage};
      if(cancelled()&&sealed.stop_reason!=='cancelled')throw Error('cancelled');
      if(trusted.usage.elapsed_ms>=task.limits.elapsed_ms&&sealed.stop_reason!=='budget')throw Error('budget');
      fail(validateResult(sealed,task,trusted));return sealed;}
  };return api;
}
