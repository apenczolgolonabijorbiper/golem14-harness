/** Create a new private instance; refuse nonempty destinations. Node-only runtime. */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {readApplicationSource,readPurpose,sourceMetadata} from '../server/application-source.mjs';

export async function initialize(destination,{profile=false,profileFrom,purposeFrom,now=()=>new Date()}={}) {
  if(profile&&profileFrom)throw Error('--profile and --profile-from are mutually exclusive');
  const bundle=profileFrom?await readApplicationSource(profileFrom,{purposeFile:purposeFrom}):{files:new Map(),source:null,origins:{},provenance:{revision:null,dirty:null}};
  if(!profileFrom&&purposeFrom){bundle.files.set('instance/purpose.md',await readPurpose(purposeFrom));bundle.origins['instance/purpose.md']=purposeFrom;}
  destination=path.resolve(destination);
  for(let current=destination;;current=path.dirname(current)){
    try{if(fs.lstatSync(current).isSymbolicLink())throw Error('Linked destination ancestor refused');}catch(e){if(e.code!=='ENOENT')throw e;}
    if(path.dirname(current)===current)break;
  }
  if(fs.existsSync(destination)&&(!fs.statSync(destination).isDirectory()||fs.readdirSync(destination).length))throw Error('Destination must be absent or empty; existing instances are never reset');
  fs.mkdirSync(path.dirname(destination),{recursive:true});
  const staging=fs.mkdtempSync(path.join(path.dirname(destination),'.golem-init-')),root=path.join(staging,'instance');
  try{
    fs.mkdirSync(root);
    for(const name of ['inbox','evidence','memory/events','memory/runs','questions','instance','profiles'])fs.mkdirSync(path.join(root,name),{recursive:true});
    const at=now().toISOString(),files={
      'memory/graph.json':{schema_version:2,updated_at:at,sources:[],entities:[],claims:[]},
      'memory/processed.json':{schema_version:1,updated_at:at,observations:[]},
      'memory/processing-lock.json':{schema_version:1,status:'idle',observation_ids:[]},
      'questions/queue.json':{schema_version:1,updated_at:at,questions:[]},
      'memory/hypotheses.json':{schema_version:1,updated_at:at,hypotheses:[]},
      'instance/purpose.md':'# Instance purpose\n\nDefine the purpose, scope, language and review priorities of this memory.\n',
      'memory/index.md':'# Memory\n\nNo analyzed observations.\n',
      'questions/queue.md':'# Questions\n\nNo questions.\n'
    };
    if(profile){files['profiles/default.md']='# Purpose\n\nDescribe the memory purpose.\n\n## Entity kinds\n\n## Predicates\n\n## Evidence rules\n\n## Review focus\n';files['golem.config.json']={schema_version:1,profile:{path:'profiles/default.md'}};}
    for(const [name,value]of Object.entries(files))fs.writeFileSync(path.join(root,name),typeof value==='string'?value:JSON.stringify(value,null,2)+'\n',{flag:'wx'});
    for(const [name,bytes]of bundle.files){fs.mkdirSync(path.dirname(path.join(root,name)),{recursive:true});fs.writeFileSync(path.join(root,name),bytes);}
    const existed=fs.existsSync(destination);
    if(existed)fs.rmdirSync(destination);
    try{fs.renameSync(root,destination);}catch(e){if(existed&&!fs.existsSync(destination))fs.mkdirSync(destination);throw e;}
    return {root:destination,source:sourceMetadata(bundle)};
  }finally{fs.rmSync(staging,{recursive:true,force:true});}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const {values}=parseArgs({options:{root:{type:'string'},profile:{type:'boolean'},'profile-from':{type:'string'},'purpose-from':{type:'string'},json:{type:'boolean'}}});
    if(!values.root)throw Error('--root is required');
    const result=await initialize(values.root,{profile:values.profile,profileFrom:values['profile-from'],purposeFrom:values['purpose-from']});
    console.log(values.json?JSON.stringify(result):result.root);
  }catch(e){console.error(e.message);process.exitCode=1;}
}
