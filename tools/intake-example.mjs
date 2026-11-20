// Synthetic producer recipe. This does not persist observations or receipts.
import {randomUUID,createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const hash=text=>createHash('sha256').update(text).digest('hex');
export function buildIntake(records,seen={}, {recordedAt='2026-01-01T00:00:00.000Z',maxCharacters=4000}={}){
  const next={...seen},observations=[];
  for(const record of records){
    for(const key of ['namespace','record','revision','text'])if(typeof record[key]!=='string'||!record[key].trim())throw Error('Missing upstream '+key);
    const key=JSON.stringify([record.namespace,record.record,record.revision]);
    const payload=JSON.stringify([record.namespace,record.record,record.revision,record.author??null,record.eventDate??null,record.text]),fingerprint=hash(payload);
    if(Object.hasOwn(next,key)){if(next[key].fingerprint!==fingerprint)throw Error('Upstream revision changed: '+key);continue;}
    const body=`Record: ${record.record}\nRevision: ${record.revision}\nAuthor: ${record.author??'unknown'}\nEffective date: ${record.eventDate??'unknown'}\n\n${record.text}\n`;
    if(body.length>maxCharacters)throw Error('Revision exceeds producer budget; split semantically with repeated context before intake: '+key);
    const id=randomUUID(),path=`inbox/${id}.md`,text=`---\nid: ${id}\nrecorded_at: ${recordedAt}\nkind: revision\norigin_ref: ${JSON.stringify(key)}\n${record.eventDate?'event_date: '+JSON.stringify(record.eventDate)+'\n':''}---\n${body}`;
    const observation={id,path,text,sha256:hash(text)};next[key]={fingerprint,id,sha256:observation.sha256};observations.push(observation);
  }
  return {observations,receipts:next};
}
export function growthExperiment(){
  const record=n=>({namespace:'https://synthetic.invalid/catalog',record:'R-1',revision:String(n),author:'Synthetic reviewer',eventDate:'2026-01-01',text:'Synthetic revision '+n});
  const fetches=[[record(1),record(2)],[record(1),record(2),record(3)],[record(1),record(2),record(3)]];
  let receipts={},incremental=0,full=0;const rounds=[];
  for(const records of fetches){const batch=buildIntake(records,receipts);receipts=batch.receipts;full+=records.length;incremental+=batch.observations.length;rounds.push({fetched:records.length,emitted:batch.observations.length});}
  return {rounds,full_history_observations:full,incremental_observations:incremental,unique_revisions:Object.keys(receipts).length};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(growthExperiment(),null,2));
