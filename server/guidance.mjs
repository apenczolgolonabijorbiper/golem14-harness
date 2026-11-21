import {loadProfile,readInstanceFile,sha256,utf8,guidanceBoundary} from './application-profile.mjs';
import {instanceFiles} from './instance-layout.mjs';
export const guidanceIdentity = version => sha256(JSON.stringify(version,null,2)+'\n');
// v2 binds purpose even when no profile is selected. Revision is provenance, never identity.
export async function loadGuidance(root,{read=path=>readInstanceFile(root,path),kinds=[]}={}) {
  const purpose_path=instanceFiles.purpose[0],purpose=await read(purpose_path),text=utf8(purpose);
  if(!text.trim())throw Error('Instance purpose must be nonempty UTF-8');
  const profile=await loadProfile(root,{read,kinds});
  let config=null;try{config=await read('golem.config.json');}catch(e){if(e.code!=='ENOENT')throw e;}
  const guidance=text+(profile?'\n\n'+profile.guidance:'');
  const guidance_version={schema_version:2,purpose_path,purpose_sha256:sha256(purpose),config_sha256:config===null?null:sha256(config),profile:profile?.guidance_version??null,delivered_sha256:sha256(guidance)};
  return {guidance,guidance_boundary:guidanceBoundary,guidance_version,...(profile?.vocabulary?{vocabulary:profile.vocabulary}:{})};
}
export function assertRetainedGuidance(snapshot,version) {
  if(version?.schema_version!==2)throw Error('Unsupported guidance format; release the lease before upgrade and start a fresh supported run');
  if(JSON.stringify(snapshot.guidance_version)!==JSON.stringify(version)||sha256(snapshot.guidance)!==version.delivered_sha256)throw Error('Claimed guidance provenance mismatch');
}
