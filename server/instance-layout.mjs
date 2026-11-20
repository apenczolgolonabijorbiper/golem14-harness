import {readInstanceFile} from './application-profile.mjs';

export const instanceFiles = {
  purpose: ['instance/purpose.md','persona/identity.md'],
  hypotheses: ['memory/hypotheses.json','persona/hypotheses.json'],
};
// Resolve without migrating, duplicating or rewriting any instance file.
export async function resolveLayout(root,{read=path=>readInstanceFile(root,path)}={}) {
  const result={};
  for(const [name,paths] of Object.entries(instanceFiles)){
    const found=[];
    for(const path of paths){try{found.push({path,bytes:await read(path)});}catch(e){if(e.code!=='ENOENT')throw e;}}
    if(!found.length)throw Error('Missing instance '+name+': '+paths.join(' or '));
    if(found.length>1)throw Error('Conflicting instance '+name+' paths; select one authoritative file before processing');
    result[name+'_path']=found[0].path;
  }
  return result;
}
