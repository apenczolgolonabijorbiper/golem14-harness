import {collections,bytesDigest,digest} from '../../../server/memory-contract.mjs';
import {parseSource} from '../../../server/observation.mjs';
export const run='10000000-0000-4000-8000-000000000001',attempt='attempt-one';
export const at='2026-01-02T12:00:00.000Z';
export function corpus(){
  const rows=Object.fromEntries(collections.map(c=>[c,[]])),evidence=new Map();
  for(let n=1;n<=2;n++){
    const id=`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,path=`inbox/${id}.md`;
    const raw=Buffer.from(`---\nid: ${id}\nrecorded_at: 2026-01-0${n}T10:00:00.000Z\nkind: note\n---\n${n===1?'Alpha at location A.':'Alpha moved to B.\nExact Unicode zażółć 😀.'}\n`),{body,...s}=parseSource(path,raw.toString());
    rows.observations.push(s);evidence.set(id,raw);
  }
  const s=rows.observations[0];rows.sources.push({id:s.id,path:s.path,sha256:s.sha256,recorded_at:s.recorded_at});
  rows.processed.push({id:s.id,source_file:s.path,source_sha256:s.sha256,status:'processed'});
  rows.entities.push({id:'ent-alpha',type:'other',label:'Alpha',aliases:['First'],source_ids:[s.id],external_ids:[{scheme:'work',namespace:'team-a',value:'42'}],created_at:s.recorded_at,uncertainty:[]});
  rows.claims.push({id:'clm-old',subject_id:'ent-alpha',attributed_to_id:'ent-alpha',predicate:'location',object:{value:'A'},classification:'source_assertion',sources:[{observation_id:s.id,quote:'Alpha at location A.'}],asserted_at:s.recorded_at,valid_time:{from:s.recorded_at,to:null,expression:'at recording',precision:'exact'},status:'active',supersedes:[],depends_on:[],uncertainty:[],created_at:s.recorded_at});
  const policy={guidance:'Synthetic memory conformance purpose.',vocabulary:{schema_version:2,predicates:['location'],single_valued:['location'],external_id_schemes:[{scheme:'work',prefixes:['WI-']}]}};
  return {meta:{snapshot_id:'record:baseline',instance_id:'synthetic-instance',logical_version:2,updated_at:at,policy_id:'policy:'+digest(policy),policy},rows,evidence};
}
export function changeFor(meta,observations){
  const s=observations[1],record={...corpus().rows.claims[0],id:'clm-new',object:{value:'B'},sources:[{observation_id:s.id,quote:'Alpha moved to B.'}],asserted_at:s.recorded_at,valid_time:{from:s.recorded_at,to:null,expression:'moved',precision:'exact'},created_at:at,supersedes:['clm-old']};
  return {provider_version:1,base_snapshot:meta.snapshot_id,policy_id:meta.policy_id,lease_id:run,run_id:run,attempt_id:attempt,idempotency_key:'cycle-one',sources:[{id:s.id,sha256:s.sha256}],at,operations:[
    {op:'extend_entity',id:'ent-alpha',source_ids:[s.id]},
    {op:'set_claim_status',id:'clm-old',status:'superseded'},
    {op:'add_claim',record},
    {op:'put_question',record:{id:'q-check',text:'Where is Alpha?',status:'closed',source_observation_id:s.id,analysis:{status:'answered',source_observation_ids:[s.id]}}},
    {op:'put_hypothesis',record:{id:'hyp-one',statement:'The move may be lasting.',status:'open',confidence:null,support:['clm-new'],refutation:[],updated_at:at}},
    {op:'append_event',record:{id:'event-one',observation_id:s.id,question_id:'q-check',answer:'Reviewed move.',answered_at:at}},
    {op:'append_journal',record:{id:run,policy_id:meta.policy_id,review:'Reviewed exact sources, correction and uncertainty.',verification_id:attempt,model:'unknown'}},
    {op:'append_verification',record:{id:attempt,run_id:run,result:'Deterministic fixture validated; no actual model execution.',limitations:['synthetic'],observed_at:at}},
  ]};
}
