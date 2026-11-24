// Portable logical stream. Import stages data in a host-owned isolated receiver;
// no provider selection, cutover, backup or migration is performed by Harness.
import {collections,pages,evidenceBytes,digest,bytesDigest,canonical} from './memory-contract.mjs';
import {snapshotDigest,validateSnapshot} from './provider-validation.mjs';
export async function* exportMemory(provider,snapshotIds){
  if(!Array.isArray(snapshotIds)||!snapshotIds.length||new Set(snapshotIds).size!==snapshotIds.length)throw Error('Explicit unique snapshots required');
  let chain=digest({format:'golem-logical-memory',version:1});
  const event=value=>{chain=digest([chain,value]);return {...value,checksum:chain};};
  yield event({type:'manifest',format:'golem-logical-memory',version:1,logical_version:2,normalization:'canonical-json-keys-v1; records sorted by ID; evidence exact bytes',snapshots:snapshotIds});
  for(const snapshot of snapshotIds){
    const meta=await provider.open({snapshot});
    yield event({type:'snapshot',origin_snapshot:snapshot,meta,logical_digest:await snapshotDigest(provider,snapshot)});
    for(const collection of collections)for await(const record of pages(provider,snapshot,collection,{},'export'))yield event({type:'record',origin_snapshot:snapshot,collection,record});
    for await(const s of pages(provider,snapshot,'observations',{},'export')){
      let offset=0;while(true){const p=await provider.evidence({snapshot,id:s.id,offset,max_bytes:65536});if(p.status!=='found')throw Error('Cannot export unavailable evidence: '+s.id);
        const bytes=Buffer.from(p.base64,'base64');if(bytes.length>65536||!bytes.length&&offset<p.total_bytes)throw Error('Invalid evidence page');
        yield event({type:'evidence',origin_snapshot:snapshot,id:s.id,offset,total_bytes:p.total_bytes,base64:p.base64});offset+=bytes.length;if(offset===p.total_bytes)break;
      }
    }
    yield event({type:'end_snapshot',origin_snapshot:snapshot});
  }
  yield {type:'end',checksum:chain};
}
// Receiver methods are host API v2, not an agent API. No target mutation may
// occur before publish; abort must discard every staging artifact. Snapshot IDs
// returned by publish are aliases, never claims of physical identity equality.
export async function importMemory(stream,receiver){
  for(const name of ['begin','snapshot','record','evidence','seal','publish','abort'])if(typeof receiver?.[name]!=='function')throw Error('Missing transfer receiver: '+name);
  let chain=digest({format:'golem-logical-memory',version:1}),manifest,active=null,ended=false;
  const completed=new Set(),expected=new Map(),offsets=new Map();
  try{
    for await(const entry of stream){
      if(ended)throw Error('Data after transfer end');
      if(entry.type==='end'){if(entry.checksum!==chain||active||completed.size!==manifest?.snapshots.length)throw Error('Incomplete transfer');ended=true;continue;}
      const {checksum,...value}=entry;chain=digest([chain,value]);if(checksum!==chain)throw Error('Transfer checksum mismatch');
      if(!manifest){if(value.type!=='manifest'||value.format!=='golem-logical-memory'||value.version!==1||value.logical_version!==2||!Array.isArray(value.snapshots)||new Set(value.snapshots).size!==value.snapshots.length)throw Error('Unsupported transfer manifest');manifest=value;await receiver.begin(value);continue;}
      if(value.type==='snapshot'){
        if(active||completed.has(value.origin_snapshot)||!manifest.snapshots.includes(value.origin_snapshot))throw Error('Unexpected transfer snapshot');active=value.origin_snapshot;expected.set(active,value.logical_digest);await receiver.snapshot(value);continue;
      }
      if(value.origin_snapshot!==active||!active)throw Error('Transfer snapshot scope mismatch');
      if(value.type==='record'){if(!collections.includes(value.collection))throw Error('Unknown transfer collection');await receiver.record(value);}
      else if(value.type==='evidence'){
        const key=active+'/'+value.id,prior=offsets.get(key)??{offset:0,total:value.total_bytes},bytes=Buffer.from(value.base64,'base64');
        if(prior.offset!==value.offset||prior.total!==value.total_bytes||bytes.length>65536||prior.offset+bytes.length>prior.total||!bytes.length&&prior.offset<prior.total)throw Error('Invalid transfer evidence sequence');
        offsets.set(key,{offset:value.offset+bytes.length,total:value.total_bytes});await receiver.evidence(value);
      }else if(value.type==='end_snapshot'){
        for(const [key,v]of offsets)if(key.startsWith(active+'/')&&v.offset!==v.total)throw Error('Truncated source bytes');
        const {provider,snapshot_id}=await receiver.seal(active);
        const errors=await validateSnapshot(provider,snapshot_id);if(errors.length)throw Error('Invalid imported memory: '+errors.join('\n'));
        if(await snapshotDigest(provider,snapshot_id)!==expected.get(active))throw Error('Logical export/import equivalence failed');
        completed.add(active);active=null;
      }else throw Error('Unknown transfer entry');
    }
    if(!ended)throw Error('Truncated transfer');
    return await receiver.publish({source_snapshots:manifest.snapshots,stream_checksum:chain});
  }catch(e){await receiver.abort();throw e;}
}
