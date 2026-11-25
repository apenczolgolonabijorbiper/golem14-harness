// Development verifier only. Consumers may implement this JSONL protocol in any runtime.
import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {isDeepStrictEqual as equal} from 'node:util';
import {parseSource} from '../../server/observation.mjs';
import {schemaErrors,validateMemory,retrieveContext,memoryStats,collectWarnings} from '../../server/memory-model.mjs';
import {validateHypotheses} from '../../server/hypotheses.mjs';
import {vocabularySurvey} from '../../server/profile-inspection.mjs';
import {loadGuidance} from '../../server/guidance.mjs';
import {cycleArtifacts,renderQueue} from '../../server/cycle-artifacts.mjs';
import {validateVocabulary,dependencyErrors,requireCapabilities} from '../../server/core-policies.mjs';
import {instancePath} from '../../server/application-profile.mjs';
import {canonical,digest,matches,checkPage,changeIdentity} from '../../server/memory-contract.mjs';
import {validateTask,validateLearning,validateContext,validateResult} from '../../server/cognitive-task.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
export async function execute(operation,input){
  switch(operation){
    case 'parse-source':return parseSource(input.path,input.text);
    case 'schema':return schemaErrors(input.value);
    case 'validate':return validateMemory(input.graph,input);
    case 'context':return retrieveContext(input.graph,input.options);
    case 'stats':return memoryStats(input.graph,input.sources,input.ledger,input.queue);
    case 'warnings':return collectWarnings(input.graph,input.options);
    case 'hypotheses':return validateHypotheses(input.value,input.graph);
    case 'vocabulary':validateVocabulary(input);return {valid:true};
    case 'vocabulary-survey':return vocabularySurvey(input.graph,input.options);
    case 'canonical':return {text:canonical(input),sha256:digest(input)};
    case 'path':return instancePath(input);
    case 'dependencies':return dependencyErrors(input);
    case 'capabilities':return requireCapabilities(input.status,input.required);
    case 'selector':return matches(input.record,input.selector);
    case 'page':checkPage(input);return {valid:true};
    case 'change-identity':return changeIdentity(input);
    case 'render-queue':return renderQueue(input);
    case 'cycle-artifacts':{const r=cycleArtifacts(input.changes,input.state,input.graph,input.lease);return {...r,writes:Object.fromEntries(r.writes)};}
    case 'guidance':return loadGuidance(null,{kinds:input.kinds,read:async path=>{if(!Object.hasOwn(input.files,path))throw Object.assign(Error('missing '+path),{code:'ENOENT'});return Buffer.from(input.files[path]);}});
    case 'validate-task':return validateTask(input);
    case 'validate-learning':return validateLearning(input.proposal,input.task,input.trusted);
    case 'validate-context':return validateContext(input.bundle,input.binding);
    case 'validate-result':return validateResult(input.result,input.task,input.trusted);
    default:throw Error('Unsupported portable operation: '+operation);
  }
}
export async function respond(request){
  try{return {id:request.id,result:await execute(request.operation,request.input)};}
  catch(e){return {id:request.id,error:e.message};}
}
export async function verify({command,operations}={}){
  const corpus=JSON.parse(readFileSync(resolve(root,'portability/fixtures/cases.json'),'utf8'));
  const cases=corpus.cases.filter(c=>!operations||operations.includes(c.operation));
  if(!cases.length)throw Error('No selected fixture cases');
  const requests=cases.map(c=>({protocol_version:1,id:c.id,operation:c.operation,input:c.input}));
  let candidate;
  if(command){
    if(!Array.isArray(command)||!command.length||command.some(v=>typeof v!=='string'))throw Error('--command must be a JSON argv array');
    const r=spawnSync(command[0],command.slice(1),{input:requests.map(r=>JSON.stringify(r)).join('\n')+'\n',encoding:'utf8',timeout:60000,maxBuffer:16*1024*1024,shell:false});
    if(r.error||r.status!==0)throw Error('Alternative adapter failed: '+(r.error?.message??r.stderr));
    candidate=r.stdout.trim().split('\n').map(s=>JSON.parse(s));
    if(candidate.length!==cases.length)throw Error('Alternative response count mismatch');
  }
  const results=[];
  for(const [i,c]of cases.entries()){
    const reference=await respond(requests[i]);
    for(const actual of [reference,...(candidate?[candidate[i]]:[])]){
      if(actual.id!==c.id)throw Error(c.id+': response ID mismatch');
      if(c.error){if(typeof actual.error!=='string'||!actual.error.includes(c.error)||Object.hasOwn(actual,'result'))throw Error(c.id+': expected error '+c.error);}
      else if(actual.error||!Object.hasOwn(c,'expected')||!equal(actual.result,c.expected))throw Error(c.id+': golden mismatch\n'+JSON.stringify(actual));
    }
    results.push({id:c.id,passed:true,result_sha256:digest(reference)});
  }
  return {contract_version:corpus.contract_version,status:operations?'partial':'reference-verified',cases:results,alternative:!!command};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const args=process.argv.slice(2),options={};
    for(let i=0;i<args.length;i+=2){if(!['--command','--operations'].includes(args[i])||args[i+1]===undefined||options[args[i]]!==undefined)throw Error('Expected --command JSON_ARGV and/or --operations comma-list');options[args[i]]=args[i+1];}
    console.log(JSON.stringify(await verify({command:options['--command']?JSON.parse(options['--command']):undefined,operations:options['--operations']?.split(',')}),null,2));
  }catch(e){console.error(e.message);process.exitCode=1;}
}
