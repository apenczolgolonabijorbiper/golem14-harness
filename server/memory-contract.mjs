// Public logical contract. No provider configuration or physical storage access.
import {createHash} from 'node:crypto';
export const memoryContract = Object.freeze({provider_version:1,logical_version:2,host_api_version:2,
  capabilities:['record-reads-v1','paged-evidence-v1','semantic-changes-v1','candidate-isolation-v1','portable-export-v1']});
export const collections = Object.freeze(['observations','sources','entities','claims','processed','questions','hypotheses','events','journals','verification','receipts','artifacts']);
export const tokens = text => String(text).normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replaceAll('ł','l').match(/[\p{L}\p{N}_-]+/gu)||[];
export function canonical(value){
  if(value===null||typeof value!=='object'){const s=JSON.stringify(value);if(s===undefined||typeof value==='number'&&!Number.isFinite(value))throw Error('Non-JSON contract value');return s;}
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
  return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
}
export const digest = value => createHash('sha256').update(canonical(value)).digest('hex');
export const bytesDigest = bytes => createHash('sha256').update(bytes).digest('hex');
export function fields(value,allowed,label){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!allowed.includes(k)))throw Error('Invalid '+label);}
export function assertProvider(provider){
  const d=provider?.describe?.();
  if(d?.provider_version!==1||d?.logical_version!==2||memoryContract.capabilities.some(c=>!d.capabilities?.includes(c)))throw Error('Unsupported memory provider version/capabilities');
  for(const key of ['open','read','scan','counts','evidence','prepare','publish','abort','recover'])if(typeof provider[key]!=='function')throw Error('Missing provider operation: '+key);
  return provider;
}
export function checkPage({limit=100,cursor=null}={}){if(!Number.isInteger(limit)||limit<1||limit>100||cursor!==null&&typeof cursor!=='string')throw Error('Invalid page');}
// Physical matching only. No top-k, recency, conflict resolution or authorization here.
export function matches(record,selector={}){
  fields(selector,['ids','refs','group','external','tokens'],'selector');
  if(selector.ids&&!selector.ids.includes(record.id))return false;
  if(selector.refs&&!selector.refs.some(id=>[record.subject_id,record.attributed_to_id,record.object?.entity_id,...(record.source_ids??[]),...(record.sources??[]).map(s=>s.observation_id),...(record.supersedes??[]),...(record.depends_on??[])].includes(id)))return false;
  if(selector.group&&(record.subject_id!==selector.group.subject_id||record.predicate!==selector.group.predicate))return false;
  if(selector.external&&!(record.external_ids??[]).some(x=>canonical(x)===canonical(selector.external)))return false;
  if(selector.tokens&&!selector.tokens.some(t=>tokens([record.id,record.label,...(record.aliases??[]),...(record.external_ids??[]).map(x=>x.value),record.kind,record.predicate,record.object?.value,...(record.sources??[]).map(s=>s.quote)].filter(x=>x!==undefined).join(' ')).includes(t)))return false;
  return true;
}
export async function* pages(provider,snapshot,collection,selector={},purpose='audit'){
  if(!collections.includes(collection))throw Error('Unknown collection');
  let cursor=null;const seen=new Set();
  do{
    const result=await provider.scan({snapshot,collection,selector,purpose,limit:100,cursor});
    if(!Array.isArray(result.items)||result.items.length>100||result.next_cursor!==null&&typeof result.next_cursor!=='string'||result.next_cursor!==null&&seen.has(result.next_cursor))throw Error('Invalid provider continuation');
    for(const row of result.items)yield row;
    cursor=result.next_cursor;if(cursor!==null)seen.add(cursor);
  }while(cursor!==null);
}
export async function records(provider,snapshot,collection,selector={},purpose='audit'){
  const result=[];for await(const row of pages(provider,snapshot,collection,selector,purpose))result.push(row);return result;
}
export async function get(provider,snapshot,collection,id,{optional=false}={}){
  const r=await provider.read({snapshot,collection,id});
  if(r.status==='unknown'&&optional)return null;
  if(r.status!=='found')throw Error((r.status==='unavailable'?'Evidence unavailable: ':'Record missing: ')+collection+'/'+id);
  if(r.record?.id!==id)throw Error('Provider returned mismatched record');return r.record;
}
export async function evidenceBytes(provider,snapshot,id){
  const parts=[];let offset=0;
  while(true){const p=await provider.evidence({snapshot,id,offset,max_bytes:65536});
    if(p.status!=='found')throw Error('Evidence '+p.status+': '+id);
    const bytes=Buffer.from(p.base64,'base64');if(bytes.length>65536||!Number.isSafeInteger(p.total_bytes)||p.total_bytes<offset+bytes.length||!bytes.length&&offset<p.total_bytes)throw Error('Invalid evidence page');
    parts.push(bytes);offset+=bytes.length;if(offset===p.total_bytes)return Buffer.concat(parts);
  }
}
export function changeIdentity(change){
  fields(change,['provider_version','base_snapshot','policy_id','lease_id','run_id','attempt_id','idempotency_key','sources','operations','at'],'semantic change set');
  if(change.provider_version!==1)throw Error('Unsupported semantic change-set version');
  for(const k of ['base_snapshot','policy_id','lease_id','run_id','attempt_id','idempotency_key','at'])if(typeof change[k]!=='string'||!change[k].trim()||change[k].length>1000)throw Error('Invalid change identity: '+k);
  if(!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(change.at)||!Number.isFinite(Date.parse(change.at)))throw Error('Invalid change time');
  if(!Array.isArray(change.sources)||change.sources.length>20||!Array.isArray(change.operations)||change.operations.length>20000)throw Error('Invalid change bounds');
  const ids=new Set();for(const s of change.sources){fields(s,['id','sha256'],'source identity');if(typeof s.id!=='string'||!/^[0-9a-f]{64}$/.test(s.sha256)||ids.has(s.id))throw Error('Invalid/duplicate source identity');ids.add(s.id);}
  return digest(change);
}
