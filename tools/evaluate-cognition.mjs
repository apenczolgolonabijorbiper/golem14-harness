// No built-in scripted answers. Prepare immutable synthetic inputs, run an external
// executor, or check retained model responses. Model credentials remain external.
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {cases} from '../cognition/conformance/cases.mjs';
import {validateResult} from '../server/cognitive-task.mjs';
const hash=x=>createHash('sha256').update(x).digest('hex');
const write=(path,value)=>writeFileSync(path,JSON.stringify(value,null,2)+'\n',{flag:'wx'});
export function prepare(){
  return {protocol_version:1,kind:'actual-model-evaluation-input',instructions:'Use docs/COGNITIVE_TASKS.md and the included result schema. Return JSON {results:[{case_id,result}]} only. Do not use tools, publish memory, or invent facts. Each result must meet its task and original source evidence. Model identity/cost are null unless known. Findings are concise, not private reasoning. General model knowledge has no memory citations. A derived finding names the IDs of premise findings. For missing original bytes return insufficient or qualified partial. Follow each forced_stop_reason. Questions have origin golem, kind cognitive_question or collection_request, explicit intent, reply_to user-1 and premise_ids. The usage and coverage fields are supplied per case and must be retained.',result_schema:JSON.parse(readFileSync(new URL('../schemas/cognitive-result.schema.json',import.meta.url))),cases:cases.map(c=>{
    const binding={instance_id:'synthetic-evaluation',snapshot_id:'snapshot-'+c.id,guidance_id:'cognitive-v1-synthetic-guidance'};
    const task={protocol_version:1,task_id:c.id,conversation_id:'conversation-'+c.id,binding,mode:'read_only',messages:[{id:'user-1',kind:'user_question',author:'user',text:c.question,reply_to:[],intent:{category:c.id==='intent-and-branches'?'compare':'ask',origin:'user',basis:'explicit',description:c.question,uncertainty:[]}}],scope:{subject_ids:[],valid_at:c.id==='conflicting-temporal'?'2026-01-02T12:00:00Z':null},limits:{rounds:1,context_requests:8,claims:10,source_bytes:16000,expansion_budget:100,elapsed_ms:300000}};
    const sources=c.facts.map((text,i)=>({id:`00000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`,sha256:hash(text),start:0,text}));
    const claims=sources.map((s,i)=>({id:'clm-'+(i+1),subject_id:'ent-room-'+(i+1),attributed_to_id:'ent-inspector',predicate:'reports',object:{value:s.text},classification:'source_assertion',sources:[{observation_id:s.id,quote:s.text}],asserted_at:'2026-01-01T00:00:00Z',valid_time:{from:null,to:null,expression:null,precision:'unknown'},status:'active',supersedes:[],uncertainty:[],created_at:'2026-01-02T00:00:00Z'}));
    const trusted={binding,claims,sources:c.missing_source?[]:sources,coverage:{truncated:c.truncated??false,pending_count:c.pending_count??0,valid_at:task.scope.valid_at},usage:{rounds:1,context_requests:1+sources.length,source_bytes:c.missing_source?0:sources.reduce((n,s)=>n+Buffer.byteLength(s.text),0),elapsed_ms:0}};
    return {case_id:c.id,task,trusted,forced_stop_reason:c.stop_reason??null,semantic_rubric:c.rubric,allowed_outcomes:c.outcomes};
  })};
}
export function evaluate(input,output){
  const seen=new Set(),reports=[];
  for(const row of output.results??[]){
    const c=input.cases.find(c=>c.case_id===row.case_id);if(!c||seen.has(row.case_id))throw Error('Unknown/duplicate case: '+row.case_id);seen.add(row.case_id);
    const errors=validateResult(row.result,c.task,c.trusted);
    if(!c.allowed_outcomes.includes(row.result?.outcome))errors.push('Outcome fails case rubric');
    if(c.forced_stop_reason&&row.result?.stop_reason!==c.forced_stop_reason)errors.push('Required stop reason missing');
    reports.push({case_id:c.case_id,integrity_errors:errors,semantic_rubric:c.semantic_rubric,semantic_verdict:'requires_review'});
  }
  for(const c of input.cases)if(!seen.has(c.case_id))reports.push({case_id:c.case_id,integrity_errors:['Missing model result'],semantic_rubric:c.semantic_rubric,semantic_verdict:'not_run'});
  return {kind:'model-evaluation-validation',verified:false,date:new Date().toISOString(),input_sha256:hash(JSON.stringify(input)),output_sha256:hash(JSON.stringify(output)),model:output.model??{requested:null,observed:null,configuration:'unknown',cost:null},reports,limitations:['Integrity validation and allowed outcome checks do not decide semantic truth.','Semantic verdicts require retained review; no scripted fixture certifies cognition.']};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [command,...args]=process.argv.slice(2);
 if(command==='prepare'&&args.length===1)write(args[0],prepare());
 else if(command==='check'&&args.length===3){const input=JSON.parse(readFileSync(args[0])),output=JSON.parse(readFileSync(args[1])),report=evaluate(input,output);write(args[2],report);if(report.reports.some(r=>r.integrity_errors.length))process.exitCode=1;}
 else if(command==='run'&&args.length>=4&&args[2]==='--'){
   const request=readFileSync(args[0]),r=spawnSync(args[3],args.slice(4),{input:request,encoding:'utf8',timeout:300000,maxBuffer:8*1024*1024,shell:false});
   if(r.status!==0)throw Error('External executor failed; no model verification claimed: '+String(r.stderr??r.error).slice(0,2000));
   const output=JSON.parse(r.stdout);write(args[1],output);
 }else throw Error('Usage: prepare INPUT; check INPUT RESULTS REPORT; run INPUT RESULTS -- EXECUTABLE [ARGS...]');
}
