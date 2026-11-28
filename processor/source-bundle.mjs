// Public source snapshot helper for host tools; stdout is a captured byte snapshot.
import {readApplicationSource,readPurpose,sourceMetadata} from '../server/application-source.mjs';
const [source,purpose]=process.argv.slice(2);
try {
  const bundle=source?await readApplicationSource(source,{purposeFile:purpose||undefined}):{files:new Map(),source:null,origins:{},provenance:{revision:null,dirty:null}};
  if(!source&&purpose){bundle.files.set('instance/purpose.md',await readPurpose(purpose));bundle.origins['instance/purpose.md']=purpose;}
  console.log(JSON.stringify({files:Object.fromEntries([...bundle.files].map(([p,b])=>[p,b.toString('base64')])),metadata:sourceMetadata(bundle)}));
}catch(e){console.error(e.message);process.exitCode=1;}
