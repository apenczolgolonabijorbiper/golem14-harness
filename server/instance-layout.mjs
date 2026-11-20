import {readInstanceFile} from './application-profile.mjs';
export const instanceFiles={purpose:['instance/purpose.md'],hypotheses:['memory/hypotheses.json']};
export async function resolveLayout(root,{read=path=>readInstanceFile(root,path)}={}){
  const result={};for(const [name,[path]]of Object.entries(instanceFiles)){
    try{await read(path);}catch(e){if(e.code==='ENOENT')throw Error('Missing instance '+name+': '+path);throw e;}
    result[name+'_path']=path;
  }return result;
}
