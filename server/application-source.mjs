// Explicit application-owned source inputs. Runtime analysis never follows these paths.
import {lstat, readFile, realpath} from 'node:fs/promises';
import {resolve, dirname, parse} from 'node:path';
import {boundedSpawn} from './subprocess.mjs';
import {loadProfile, instancePath, utf8, sha256, readInstanceFile} from './application-profile.mjs';
import {instanceFiles} from './instance-layout.mjs';

export async function rejectLinks(path) {
  let current=resolve(path);
  for (;;) {
    const stat=await lstat(current);
    if(stat.isSymbolicLink())throw Error('Linked source or destination ancestor refused: '+current);
    const parent=dirname(current);if(parent===current)break;current=parent;
  }
}
export function installPath(path) {
  instancePath(path);
  // Deliberately narrower than loadProfile's read contract. Protocol roles cannot be targets.
  if(!/^(profiles|guidance)\/.+/.test(path))throw Error('Install guidance targets must be under profiles/ or guidance/: '+path);
  return path;
}
const missing = path => {const e=Error('Missing captured source file: '+path);e.code='ENOENT';return e;};
export const mapReader = files => async path => {if(!files.has(path))throw missing(path);return files.get(path);};
export function sourceMetadata(bundle) {
  return {source:bundle.source, provenance:bundle.provenance, files:[...bundle.files].map(([path,bytes])=>({path,source_path:bundle.origins[path],sha256:sha256(bytes)}))};
}
export async function readPurpose(path) {
  await rejectLinks(path);
  if(!(await lstat(path)).isFile())throw Error('Purpose must be a regular file');
  const bytes=await readFile(path);if(!utf8(bytes).trim())throw Error('Purpose must be nonempty UTF-8');return bytes;
}
export async function readApplicationSource(directory,{purposeFile,git='git'}={}) {
  await rejectLinks(directory);const source=await realpath(directory),files=new Map(),origins={};
  const capture=async (path,target=path)=>{if(files.has(target))throw Error('Duplicate source target role: '+target);const bytes=await readInstanceFile(source,path);utf8(bytes);files.set(target,bytes);origins[target]=resolve(source,path);return bytes;};
  const config=JSON.parse(utf8(await capture('golem.config.json')));
  // Enumerate explicitly referenced files only. The shared loader validates all selectors/vocabulary.
  if(config.profile!=null){
    const p=config.profile;
    for(const path of [p.path,...(Array.isArray(p.sections)?p.sections.map(s=>s.path):[]),...(p.vocabulary!==undefined?[p.vocabulary]:[])])await capture(installPath(path));
  }
  await loadProfile(source,{read:mapReader(files)});
  const paths=[...files.keys()];for(const a of paths)for(const b of paths)if(a!==b&&(a.toLowerCase()===b.toLowerCase()||b.toLowerCase().startsWith(a.toLowerCase()+'/')))throw Error('Overlapping source target roles');
  let purposeExists=false;try{await lstat(resolve(source,'purpose.md'));purposeExists=true;}catch(e){if(e.code!=='ENOENT')throw e;}
  if(purposeFile&&purposeExists)throw Error('Ambiguous purpose: bundle and --purpose-from both supplied');
  if(purposeExists||purposeFile){const path=resolve(purposeFile||resolve(source,'purpose.md')),target=instanceFiles.purpose[0];files.set(target,await readPurpose(path));origins[target]=path;}
  let provenance={revision:null,dirty:null};
  try {const env={...process.env,GIT_OPTIONAL_LOCKS:'0'};for(const name of ['GIT_INDEX_FILE','GIT_DIR','GIT_WORK_TREE','GIT_COMMON_DIR','GIT_OBJECT_DIRECTORY','GIT_ALTERNATE_OBJECT_DIRECTORIES'])delete env[name];const run=args=>{const result=boundedSpawn(git,['-C',source,...args],{encoding:'utf8',env,timeout:10000,maxBuffer:4*1024*1024});if(result.status!==0)throw Error('Unknown source provenance');return result.stdout;};provenance={revision:run(['rev-parse','HEAD']).trim(),dirty:run(['status','--porcelain','--untracked-files=all','--','.']).length>0};}catch{}
  return {source,files,origins,provenance};
}
export async function managedPaths(root,{read=path=>readInstanceFile(root,path)}={}) {
  const profile=await loadProfile(root,{read});if(!profile)return [];
  const config=JSON.parse(utf8(await read('golem.config.json'))).profile;
  return ['golem.config.json',config.path,...(config.sections??[]).map(s=>s.path),...(config.vocabulary?[config.vocabulary]:[])];
}
export async function compareSource(root,bundle,{read=path=>readInstanceFile(root,path)}={}) {
  let old=[],selectionError;
  try{old=await managedPaths(root,{read});}catch(e){selectionError=e.message;}
  const findings=[];
  for(const [path,bytes]of bundle.files){let installed=null;try{installed=await read(path);}catch(e){if(e.code!=='ENOENT')throw e;}findings.push({path,source_sha256:sha256(bytes),installed_sha256:installed===null?null:sha256(installed),state:installed===null?'missing':sha256(installed)===sha256(bytes)?'in-sync':'differs'});}
  const stale=old.filter(p=>!bundle.files.has(p)).sort();
  return {state:selectionError||stale.length||findings.some(f=>f.state!=='in-sync')?'drift':'in-sync',files:findings,stale_managed_paths:stale,...(selectionError?{selection_error:selectionError}:{}),source:sourceMetadata(bundle)};
}
