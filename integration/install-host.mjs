/** Install a verified release without initializing state or starting inference. */
import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
const source=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const BEGIN='<!-- GOLEM-HARNESS:BEGIN -->',END='<!-- GOLEM-HARNESS:END -->';
function checked(value){
  const absolute=path.resolve(value);
  for(let p=absolute;;p=path.dirname(p)){
    try{if(fs.lstatSync(p).isSymbolicLink())throw Error('Symlink paths are not supported: '+p);}catch(e){if(e.code!=='ENOENT')throw e;}
    if(p===path.dirname(p))break;
  }
  return absolute;
}
function within(parent,child){const rel=path.relative(parent,child);return rel===''||(!path.isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('..'+path.sep));}
export function verify(root){
  checked(root);
  const manifest=JSON.parse(fs.readFileSync(path.join(root,'RELEASE.json'),'utf8'));
  if(manifest.schema_version!==1||!manifest.files)throw Error('Invalid release manifest');
  for(const [name,hash]of Object.entries(manifest.files)){
    if(!name||path.isAbsolute(name)||name.split('/').some(p=>!p||p==='..'||p==='.')||name.includes('\\')||name.includes(':'))throw Error('Unsafe manifest path');
    if(createHash('sha256').update(fs.readFileSync(checked(path.join(root,name)))).digest('hex')!==hash)throw Error('Engine hash mismatch: '+name);
  }
  const actual=[];
  function walk(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const p=checked(path.join(dir,entry.name));if(entry.isDirectory())walk(p);else if(entry.isFile())actual.push(path.relative(root,p).split(path.sep).join('/'));else throw Error('Unsupported engine file');}}
  walk(root);
  if(JSON.stringify(actual.sort())!==JSON.stringify([...Object.keys(manifest.files),'RELEASE.json'].sort()))throw Error('Unexpected or missing engine files; use a clean extracted release');
  return manifest;
}
function atomicWrite(target,bytes){
  fs.mkdirSync(path.dirname(target),{recursive:true});const temporary=target+'.'+randomUUID()+'.tmp';
  try{fs.writeFileSync(temporary,bytes,{flag:'wx'});fs.renameSync(temporary,target);}finally{fs.rmSync(temporary,{force:true});}
}
export function install(repo,instance,host){
  repo=checked(repo);instance=checked(instance);
  const manifest=verify(source),engine=checked(path.join(repo,'vendor/golem-harness'));
  if(within(engine,instance)||within(source,instance))throw Error('Instance must be outside the engine');
  if(within(source,repo))throw Error('Application repository must not be inside the release');
  const agentPath=checked(path.join(repo,'AGENTS.md')),rulePath=path.join(repo,'.cursor/rules/golem-harness.mdc');if(host==='cursor')checked(rulePath);
  let relative=path.relative(repo,instance),description='relative to the application root';
  if(path.isAbsolute(relative)){relative=instance;description='absolute path';}
  relative=relative.split(path.sep).join('/');if(/[\r\n`]/.test(relative))throw Error('Unsupported instance path characters');
  const block=fs.readFileSync(path.join(source,'integration/host-block.md'),'utf8').replace('{{INSTANCE}}',relative).replace('{{PATH_DESCRIPTION}}',description).replace('{{VERSION}}',manifest.version);
  const existing=fs.existsSync(agentPath)?fs.readFileSync(agentPath):Buffer.alloc(0),text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(existing);
  let agents=Buffer.concat([existing,Buffer.from((existing.length?'\n\n':'')+block)]);
  if(text.includes(BEGIN)||text.includes(END)){
    if(text.split(BEGIN).length!==2||text.split(END).length!==2||text.indexOf(BEGIN)>=text.indexOf(END))throw Error('Existing Golem instructions differ; review manually, no files changed');
    const start=text.indexOf(BEGIN),end=text.indexOf(END)+END.length,managed=text.slice(start,end),normalized=managed.replaceAll('\r\n','\n');
    const legacy=block.trimEnd().replace('## Golem engine integration\n','## Golem engine integration (Cursor Desktop / Claude)\n').replace('The active host agent supplies inference','Claude supplies inference').replace('schedule. For guided setup, read HARNESS_ROOT/integration/SETUP.codex.md in Codex or HARNESS_ROOT/integration/SETUP.work.md in ChatGPT Work. Before state writes','schedule. Before state writes');
    if(normalized===block.trimEnd())agents=existing;
    else if(normalized===legacy){const replacement=block.trimEnd().replaceAll('\n',managed.includes('\r\n')?'\r\n':'\n');agents=Buffer.from(text.slice(0,start)+replacement+text.slice(end));}
    else throw Error('Existing Golem instructions differ; review manually, no files changed');
  }
  const rule=fs.readFileSync(path.join(source,'integration/cursor-rule.mdc'));
  if(host==='cursor'&&fs.existsSync(rulePath)&&!fs.readFileSync(rulePath).equals(rule))throw Error('Existing Cursor Golem rule differs; review manually, no files changed');
  if(fs.existsSync(engine)){verify(engine);if(!fs.readFileSync(path.join(engine,'RELEASE.json')).equals(fs.readFileSync(path.join(source,'RELEASE.json'))))throw Error('Different engine already installed; use an explicitly authorized upgrade');}
  const warnings=[],override=path.join(repo,'AGENTS.override.md');
  if(host==='codex'&&fs.existsSync(override)&&fs.statSync(override).size)warnings.push('Root AGENTS.override.md masks AGENTS.md; review the active instructions and explicitly load AGENTS.md before using the harness');
  if(host==='codex'&&agents.length>32768)warnings.push('Root AGENTS.md exceeds the default Codex 32 KiB instruction limit; verify the Golem block is loaded in your configured host');
  const plans=[];
  if(!fs.existsSync(engine))for(const name of [...Object.keys(manifest.files),'RELEASE.json'])plans.push([checked(path.join(engine,name)),fs.readFileSync(path.join(source,name))]);
  if(!agents.equals(existing))plans.push([agentPath,agents]);
  if(host==='cursor'&&!fs.existsSync(rulePath))plans.push([rulePath,rule]);
  for(const [target,bytes]of plans)atomicWrite(target,bytes);
  verify(engine);
  return {host,discovery_warnings:warnings,version:manifest.version,engine,instance,files_written:plans.length,instance_initialized:false,inference_started:false};
}
export function run(host){try{const {values}=parseArgs({options:{repo:{type:'string'},'instance-root':{type:'string'}}});if(!values.repo||!values['instance-root'])throw Error('--repo and --instance-root are required');console.log(JSON.stringify(install(values.repo,values['instance-root'],host),null,2));}catch(e){console.error(e.message);process.exitCode=1;}}
