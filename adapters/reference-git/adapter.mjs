import {createJsonProvider} from '../reference-json/provider.mjs';
import {createProviderReadView} from '../../server/cognitive-reference.mjs';
import {createMemoryReadView} from '../../server/cognitive-reference.mjs';
import {validateLearning,cognitiveCapabilities} from '../../server/cognitive-task.mjs';
import {readApplicationSource,compareSource,managedPaths,mapReader,installPath,sourceMetadata} from '../../server/application-source.mjs';
import {loadGuidance,guidanceIdentity,assertRetainedGuidance} from '../../server/guidance.mjs';
import {operationMetrics} from '../../server/operation-metrics.mjs';
import {resolveLayout} from '../../server/instance-layout.mjs';
import {boundedSpawn} from '../../server/subprocess.mjs';
import {createHash,randomUUID} from 'node:crypto';
import {existsSync,readFileSync,writeFileSync,mkdirSync,rmSync,lstatSync,readdirSync,realpathSync,mkdtempSync,statSync} from 'node:fs';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseSource} from '../../processor/memory-tool.mjs';
import {loadProfile,instancePath,utf8,sha256,within,physicallyWithin} from '../../server/application-profile.mjs';

const defaultHarness=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const LEASE='memory/processing-lock.json',LEDGER='memory/processed.json';
const mandatory=['memory/graph.json','memory/index.md','questions/queue.json','questions/queue.md'];
const json=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const hash=bytes=>bytes===null?null:createHash('sha256').update(bytes).digest('hex');
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export class AdapterError extends Error {}
function runChild(...args){try{return boundedSpawn(...args);}catch(e){throw new AdapterError(e.message);}}

// The local filesystem implementation supports one dedicated, attached-branch instance clone.
// Hooks are factory-only test seams, never CLI-loaded executable configuration.
export function createAdapter({instance,harness=defaultHarness,git='git',node=process.execPath,now=()=>Date.now(),hooks={},timings=false,sourceGuard}={}) {
  const metrics=operationMetrics(timings);
  const root=realpathSync(resolve(instance)),engine=realpathSync(harness);
  if(within(engine,root)||within(root,engine)||physicallyWithin(engine,root)||physicallyWithin(root,engine))throw new AdapterError('Instance must be outside the installed engine');
  const exec=(args,{input,env={},encoding=null}={})=>{
    const inherited={...process.env};for(const name of ['GIT_INDEX_FILE','GIT_DIR','GIT_WORK_TREE','GIT_COMMON_DIR','GIT_OBJECT_DIRECTORY','GIT_ALTERNATE_OBJECT_DIRECTORIES'])delete inherited[name];
    const r=metrics.git(args[0],()=>runChild(git,['-C',root,...args],{input,encoding,env:{...inherited,GIT_OPTIONAL_LOCKS:'0',...env},maxBuffer:64*1024*1024}));
    if(r.error||r.status!==0)throw new AdapterError('Git operation refused: '+args[0]);
    return encoding?r.stdout:r.stdout;
  };
  const gitText=args=>exec(args,{encoding:'utf8'}).trim();
  const actualRoot=statSync(root,{bigint:true}),gitRoot=statSync(realpathSync(gitText(['rev-parse','--show-toplevel'])),{bigint:true});
  if(actualRoot.dev!==gitRoot.dev||actualRoot.ino!==gitRoot.ino)throw new AdapterError('Instance must be the dedicated Git repository root');
  const ref=gitText(['symbolic-ref','HEAD']),gitdir=resolve(root,gitText(['rev-parse','--git-dir']));
  const marker=join(gitdir,'golem-adapter-pending.json'),mutex=join(gitdir,'golem-adapter-operation.lock');
  const head=()=>{if(gitText(['symbolic-ref','HEAD'])!==ref)throw new AdapterError('Active branch changed; reopen the adapter on the intended instance branch');return gitText(['rev-parse',ref]);};
  const stamp=()=>new Date(now()).toISOString();
  function file(path,{optional=false}={}) {
    instancePath(path);let current=root;
    try {
      const parts=path.split('/');
      for(let i=0;i<parts.length;i++) {
        current=join(current,parts[i]);const stat=lstatSync(current);
        if(stat.isSymbolicLink()||i<parts.length-1&&!stat.isDirectory()||i===parts.length-1&&!stat.isFile())throw new AdapterError('Unsafe instance file: '+path);
      }
      return readFileSync(current);
    }catch(e){if(optional&&e.code==='ENOENT')return null;throw e;}
  }
  function safeWrite(path,bytes) {
    instancePath(path);let current=root;
    if(bytes===null){if(file(path,{optional:true})!==null)rmSync(join(root,path));return;}
    for(const part of path.split('/').slice(0,-1)) {
      current=join(current,part);
      if(!existsSync(current))mkdirSync(current);
      if(lstatSync(current).isSymbolicLink()||!lstatSync(current).isDirectory())throw new AdapterError('Unsafe protocol directory');
    }
    file(path,{optional:true});writeFileSync(join(root,path),bytes);
  }
  // One raw batch per immutable tree: no checkout filters, no process per file.
  const snapshots=new Map();
  function snapshot(commit){return metrics.sync('snapshot',()=>captureSnapshot(commit));}
  function captureSnapshot(commit){
    if(snapshots.has(commit))return snapshots.get(commit);
    const rows=exec(['ls-tree','-r','-z',commit]).toString('utf8').split('\0').filter(Boolean).map(row=>{
      const m=row.match(/^(100644|100755) blob ([0-9a-f]+)\t([\s\S]+)$/);if(!m)throw new AdapterError('Candidate contains unsupported Git objects');
      return {mode:m[1],sha:m[2],path:instancePath(m[3])};
    });
    const hashes=[...new Set(rows.map(r=>r.sha))],bytes=exec(['cat-file','--batch'],{input:hashes.join('\n')+(hashes.length?'\n':'')}),objects=new Map();let offset=0;
    for(const sha of hashes){
      const end=bytes.indexOf(10,offset),header=bytes.subarray(offset,end).toString('ascii'),m=header.match(/^([0-9a-f]+) blob ([0-9]+)$/);
      if(end<0||!m||m[1]!==sha)throw new AdapterError('Invalid Git object batch');
      const size=Number(m[2]),start=end+1,finish=start+size;if(!Number.isSafeInteger(size)||finish>=bytes.length||bytes[finish]!==10)throw new AdapterError('Truncated Git object batch');
      objects.set(sha,bytes.subarray(start,finish));offset=finish+1;
    }
    if(offset!==bytes.length)throw new AdapterError('Unexpected Git batch bytes');
    const result=new Map(rows.map(row=>[row.path,{...row,bytes:objects.get(row.sha)}]));
    snapshots.set(commit,result);while(snapshots.size>2)snapshots.delete(snapshots.keys().next().value);return result;
  }
  function blob(commit,path,optional=false){
    instancePath(path);const row=snapshot(commit).get(path);
    if(!row){if(optional)return null;throw new AdapterError('Committed file missing: '+path);}return row.bytes;
  }
  function state(commit=head()) {
    const lease=JSON.parse(utf8(blob(commit,LEASE))),ledger=JSON.parse(utf8(blob(commit,LEDGER)));
    if(lease.schema_version!==1||ledger.schema_version!==1||!Array.isArray(ledger.observations))throw new AdapterError('Invalid committed protocol state');
    const seen=new Set();for(const row of ledger.observations){if(!uuid.test(row.id)||seen.has(row.id)||row.status!=='processed'||row.source_file!==`inbox/${row.id}.md`||!/^[0-9a-f]{64}$/.test(row.source_sha256))throw new AdapterError('Invalid committed ledger row');seen.add(row.id);}
    const held=lease.status==='processing'&&Number.isFinite(Date.parse(lease.expires_at))&&Date.parse(lease.expires_at)>now();
    if(!['idle','processing','error'].includes(lease.status)||!Array.isArray(lease.observation_ids))throw new AdapterError('Invalid committed lease');
    if(lease.status==='processing'&&(!uuid.test(lease.run_id)||!Number.isFinite(Date.parse(lease.expires_at))||!Array.isArray(lease.sources)||lease.sources.length!==lease.observation_ids.length||lease.sources.some((s,i)=>s.id!==lease.observation_ids[i]||s.path!==`inbox/${s.id}.md`||!/^[0-9a-f]{64}$/.test(s.sha256))))throw new AdapterError('Invalid committed processing lease');
    return {head:commit,lease,ledger,held};
  }
  function own(s,run,{expired=false}={}) {
    if(!uuid.test(run??'')||s.lease.run_id!==run||s.lease.status!=='processing'||!expired&&!s.held)throw new AdapterError('Run does not own an unexpired processing lease');
  }
  function assertLocalProtocol(s) {
    for(const path of [LEASE,LEDGER])if(hash(file(path))!==hash(blob(s.head,path)))throw new AdapterError('Stale or edited local protocol file: '+path+'. Preserve local changes, then restore this file and its index entry from HEAD; do not reset other paths.');
  }
  function scan(s) {return metrics.sync('scan',()=>scanImpl(s));}
  function scanImpl(s) {
    const ready=[],waiting_for_age=[],malformed=[],processed=[],map=new Map(s.ledger.observations.map(r=>[r.id,r]));
    // Reading committed processed sources too detects deletions, including a vanished directory entry.
    for(const row of s.ledger.observations) {
      try {const bytes=file(row.source_file);if(hash(bytes)!==row.source_sha256)throw Error();processed.push(row.id);}
      catch {malformed.push({id:row.id,path:row.source_file,reason:'Processed source changed or missing; intervention required'});}
    }
    file('memory/graph.json');
    const inbox=join(root,'inbox');let names=[];try{const st=lstatSync(inbox);if(st.isSymbolicLink()||!st.isDirectory())throw new AdapterError('Unsafe inbox directory');names=readdirSync(inbox);}catch(e){if(e.code!=='ENOENT')throw e;}
    for(const name of names.filter(n=>n.endsWith('.md')).sort()) {
      const path='inbox/'+name;
      try {
        const bytes=file(path),source=parseSource(path,utf8(bytes));
        if(map.has(source.id))continue;
        const entry={id:source.id,path,sha256:hash(bytes),recorded_at:source.recorded_at,...(source.kind?{kind:source.kind}:{})};
        (now()-Date.parse(source.recorded_at)>=60000?ready:waiting_for_age).push(entry);
      }catch{malformed.push({path,reason:'Malformed observation; intervention required'});}
    }
    ready.sort((a,b)=>Date.parse(a.recorded_at)-Date.parse(b.recorded_at)||a.id.localeCompare(b.id));
    return {ready,waiting_for_age,malformed,processed:processed.length};
  }
  function indexEntries(paths) {
    const raw=exec(['ls-files','--stage','-z','--',...paths]).toString('utf8');
    return raw.split('\0').filter(Boolean).map(row=>{const m=row.match(/^(\d+) ([0-9a-f]+) (\d)\t([\s\S]+)$/);return {mode:m[1],sha:m[2],stage:m[3],path:m[4]};});
  }
  function assertIndexClean(paths,commit) {return metrics.sync('index_check',()=>assertIndexCleanImpl(paths,commit));}
  function assertIndexCleanImpl(paths,commit) {
    const current=new Map(indexEntries(paths).map(row=>[row.path,row])),originals=snapshot(commit);
    for(const path of paths){
      const row=current.get(path),original=originals.get(path);
      if(row ? row.stage!=='0'||!original||row.mode!==original.mode||row.sha!==original.sha : Boolean(original))throw new AdapterError('Preserve staged changes before processing: '+path);
    }
  }
  function resetEntries(paths,commit) {
    const originals=snapshot(commit),zero='0'.repeat(originals.values().next().value?.sha.length??40);
    const rows=paths.map(path=>{
      const row=originals.get(path);return row?`${row.mode} ${row.sha}\t${path}\0`:`0 ${zero}\t${path}\0`;
    }).join('');
    exec(['update-index','-z','--index-info'],{input:rows});
  }
  function finishPending() {return metrics.sync('recovery',()=>finishPendingImpl());}
  function finishPendingImpl() {
    if(!existsSync(marker))return;
    const pending=JSON.parse(readFileSync(marker,'utf8')),current=head();
    if(current===pending.old){rmSync(marker);return;}
    if(current!==pending.next)throw new AdapterError('Published state advanced during recovery; preserve drafts and reconcile protocol files/index from current HEAD before removing '+marker);
    for(const {path,before,after} of pending.writes){
      const actual=hash(file(path,{optional:true}));
      if(actual===after)continue;
      if(actual!==before)throw new AdapterError('Published state is valid; preserve edited '+path+' and restore it from HEAD before retrying recovery');
      safeWrite(path,blob(current,path,true));
    }
    // Only update index entries still at their captured pre-publication or committed values.
    const index=new Map(indexEntries(pending.paths).map(row=>[row.path,row])),beforeTree=snapshot(pending.old??current),afterTree=snapshot(current);
    for(const path of pending.paths){const row=index.get(path),before=beforeTree.get(path),after=afterTree.get(path);
      if(row){if(row.stage!=='0'||![before,after].some(original=>original&&original.sha===row.sha&&original.mode===row.mode))throw new AdapterError('Preserve edited index entries before recovery');}
      else if(before&&after)throw new AdapterError('Preserve staged deletion before recovery');
    }
    resetEntries(pending.paths,current);rmSync(marker);
  }
  async function locked(action) {
    try{mkdirSync(mutex);}catch{throw new AdapterError('Another local adapter operation is running; a stale lock requires operator inspection: '+mutex);}
    try{finishPending();return await action();}finally{rmSync(mutex,{recursive:true,force:true});}
  }
  function treeFrom(commit,entries) {return metrics.sync('build_tree',()=>buildTree(commit,entries));}
  function buildTree(commit,entries) {
    const temporary=mkdtempSync(join(gitdir,'golem-tree-')),index=join(temporary,'index'),env={GIT_INDEX_FILE:index};
    try{
      exec(['read-tree',commit],{env});
      const originals=snapshot(commit),rows=[];
      for(const [path,bytes]of entries){
        if(bytes===null){rows.push(`0 ${'0'.repeat(originals.values().next().value?.sha.length??40)}\t${path}\0`);continue;}
        const id=exec(['hash-object','-w','--stdin'],{input:bytes}).toString().trim();
        const mode=originals.get(path)?.mode??'100644';
        rows.push(`${mode} ${id}\t${path}\0`);
      }
      exec(['update-index','-z','--index-info'],{input:rows.join(''),env});
      return {tree:exec(['write-tree'],{env}).toString().trim(),temporary};
    }catch(e){rmSync(temporary,{recursive:true,force:true});throw e;}
  }
  function dirty() {
    return exec(['status','--porcelain=v1','-z','--untracked-files=all']).toString('utf8').split('\0').filter(Boolean).map(row=>row.slice(3));
  }
  function publish(s,entries,writes,label,tree) {return metrics.sync('publish',()=>publishImpl(s,entries,writes,label,tree));}
  function publishImpl(s,entries,writes,label,tree) {
    if(head()!==s.head)throw new AdapterError('Head changed; re-read, merge and revalidate; lease retained');
    assertIndexClean([...entries.keys()],s.head);
    const built=tree?null:treeFrom(s.head,entries);
    try{
      const env={GIT_AUTHOR_NAME:'golem-adapter',GIT_AUTHOR_EMAIL:'golem-adapter@localhost',GIT_COMMITTER_NAME:'golem-adapter',GIT_COMMITTER_EMAIL:'golem-adapter@localhost'};
      const next=exec(['commit-tree',tree??built.tree,'-p',s.head],{input:label+'\n',env}).toString().trim();
      const pending={old:s.head,next,paths:[...entries.keys()],writes:writes.map(path=>({path,before:hash(file(path,{optional:true})),after:hash(entries.get(path))}))};
      writeFileSync(marker,json(pending),{flag:'wx'});
      try {exec(['update-ref',ref,next,s.head]);}catch(e){rmSync(marker);throw new AdapterError('Head changed; re-read, merge and revalidate; lease retained');}
      hooks.afterPublish?.({head:next,operation:label});
      finishPending();return next;
    }finally{if(built)rmSync(built.temporary,{recursive:true,force:true});}
  }
  function readAt(commit) {
    return async path=>{const data=blob(commit,path,true);if(data===null){const error=Error('Committed instance file missing: '+path);error.code='ENOENT';throw error;}return data;};
  }
  async function profileAt(commit,kinds) {
    return loadGuidance(root,{read:readAt(commit),kinds});
  }
  function parseOutputs(value) {
    const paths=Array.isArray(value)?value:typeof value==='string'?value.split(','):[];
    const forbidden=[LEASE,LEDGER,'golem.config.json'];
    for(const path of paths){instancePath(path);if(forbidden.includes(path)||path.startsWith('inbox/')||path.startsWith('vendor/')||path.startsWith('profiles/')||path.startsWith('instance/')||path.startsWith('persona/')&&path!=='persona/hypotheses.json')throw new AdapterError('Output path is reserved: '+path);file(path);}
    return [...new Set(paths)];
  }
  function sourceCheck(s) {return metrics.sync('source_check',()=>sourceCheckImpl(s));}
  function sourceCheckImpl(s) {
    for(const source of s.lease.sources){try{const bytes=file(source.path);const parsed=parseSource(source.path,utf8(bytes));if(hash(bytes)!==source.sha256||parsed.id!==source.id)throw Error();}catch{throw new AdapterError('Claimed source changed; inputs remain pending');}}
  }
  function errorLease(s,run,diagnostic) {
    own(s,run,{expired:true});
    const lease={schema_version:1,status:'error',observation_ids:[],last_run_id:run,completed_at:stamp(),reason:typeof diagnostic==='string'&&/^[A-Za-z0-9_ .:()[\]\/-]+$/.test(diagnostic)?diagnostic.slice(0,200):'Processing failed; inputs remain pending'};
    return publish(s,new Map([[LEASE,json(lease)]]),[LEASE],`release-error ${run}`);
  }
  async function candidate(s,run,outputs) {return metrics.async('candidate',()=>buildCandidate(s,run,outputs));}
  async function buildCandidate(s,run,outputs) {
    own(s,run);assertLocalProtocol(s);
    if(s.lease.guidance_version?.schema_version!==2)throw new AdapterError('Unsupported guidance format; release and reclaim');
    const layout=await resolveLayout(root);
    const paths=parseOutputs(outputs),reserved=await managedPaths(root,{read:readAt(s.head)});
    for(const path of paths)if(reserved.includes(path))throw new AdapterError('Output path is reserved: '+path);
    const journal=`memory/runs/${run}.md`,journalBytes=file(journal);
    sourceCheck(s);
    if(scan(s).malformed.length)throw new AdapterError('Processed source changed or missing; intervention required');
    const entries=new Map();
    for(const path of [...mandatory,layout.hypotheses_path,journal,...paths])entries.set(path,file(path));
    for(const source of s.lease.sources){entries.set(source.path,file(source.path));const evidence=`evidence/${source.id}.json`;const bytes=file(evidence,{optional:true});if(bytes)entries.set(evidence,bytes);}
    if(s.lease.guidance_version){
      const bound=await profileAt(s.head,[...new Set(s.lease.sources.map(x=>x.kind).filter(Boolean))]);
      if(JSON.stringify(bound?.guidance_version)!==JSON.stringify(s.lease.guidance_version))throw new AdapterError('Claimed profile changed; release and reclaim before completion');
      if(s.lease.guidance_version.schema_version!==2)throw new AdapterError('Unsupported guidance format; release and reclaim');
      const identity=guidanceIdentity(s.lease.guidance_version);
      if(!utf8(journalBytes).split('\n').includes('guidance_version: '+identity))throw new AdapterError('Journal guidance_version missing or mismatched');
      const path=`memory/runs/${run}.guidance.json`,bytes=blob(s.head,path),snapshot=JSON.parse(utf8(bytes));
      assertRetainedGuidance(snapshot,s.lease.guidance_version);
      if(JSON.stringify(snapshot)!==JSON.stringify(bound))throw new AdapterError('Retained guidance text differs from claim snapshot');
      if(hash(file('instance/purpose.md'))!==hash(blob(s.head,'instance/purpose.md')))throw new AdapterError('Dirty purpose; restore claimed bytes before completion');
      entries.set(path,bytes);
    }
    const ledger={...s.ledger,updated_at:stamp(),observations:[...s.ledger.observations,...s.lease.sources.map(source=>({id:source.id,source_file:source.path,source_sha256:source.sha256,status:'processed',processed_at:stamp(),outputs:paths,run:journal}))]};
    if(new Set(ledger.observations.map(r=>r.id)).size!==ledger.observations.length)throw new AdapterError('Claim already processed');
    entries.set(LEDGER,json(ledger));entries.set(LEASE,json({schema_version:1,status:'idle',observation_ids:[],last_run_id:run,completed_at:stamp()}));
    assertIndexClean([...entries.keys()],s.head);
    const built=treeFrom(s.head,entries),stage=join(built.temporary,'snapshot');mkdirSync(stage);
    try{
      // Read blobs, never checkout filters; all candidate bytes equal committed bytes.
      metrics.sync('materialize',()=>{const tree=snapshot(built.tree);metrics.count('candidate_tree_files',tree.size);metrics.count('candidate_tree_bytes',[...tree.values()].reduce((sum,row)=>sum+row.bytes.length,0));for(const [path,row]of tree){mkdirSync(dirname(join(stage,path)),{recursive:true});writeFileSync(join(stage,path),row.bytes);}});
      // Runtime-required empty directories are not represented in Git trees.
      mkdirSync(join(stage,'inbox'),{recursive:true});
      const previous=join(built.temporary,'previous.json');writeFileSync(previous,blob(s.head,'memory/graph.json'));
      const r=metrics.sync('validator',()=>runChild(node,[join(engine,'processor/memory-tool.mjs'),'validate','--root',stage,'--previous',previous],{encoding:'utf8',maxBuffer:8*1024*1024}));
      if(r.error||r.status!==0){const first=(r.stderr??'').split('\n')[0];throw new AdapterError('Candidate validation failed: '+(first.startsWith('Memory validation failed: ')?first.slice(26,526):first.startsWith('Hypotheses file invalid: ')?first.slice(0,500):'invalid snapshot; inspect with memory-tool validate'));}
      const validation=JSON.parse(r.stdout);
      metrics.count('candidate_output_files',entries.size);metrics.count('claimed_sources',s.lease.sources.length);
      for(const key of ['entities','claims','sources'])metrics.count('graph_'+key,validation[key]);
      return {...built,entries,validation,files:[...entries.keys()],left_uncommitted:dirty().filter(p=>!entries.has(p))};
    }catch(e){rmSync(built.temporary,{recursive:true,force:true});throw e;}
  }
  async function profileStatus(source) {
    const s=state(),recovery_required=existsSync(marker)||[LEASE,LEDGER].some(path=>hash(file(path,{optional:true}))!==hash(blob(s.head,path)));
    let bundle;try{bundle=await readApplicationSource(source,{git});}catch(e){return {state:'source-invalid',error:e.message,head:s.head,recovery_required};}
    const committed=await compareSource(root,bundle,{read:readAt(s.head)}),working=await compareSource(root,bundle);
    const paths=[...new Set([...bundle.files.keys(),...committed.stale_managed_paths])];
    const dirtyPaths=paths.filter(path=>hash(file(path,{optional:true}))!==hash(blob(s.head,path,true)));
    const config=blob(s.head,'golem.config.json',true);
    const installed=config!==null&&JSON.parse(utf8(config)).profile!=null;
    return {state:!installed&&JSON.parse(utf8(bundle.files.get('golem.config.json'))).profile!=null?'not-installed':committed.state!=='in-sync'?'drift':dirtyPaths.length?'dirty':'in-sync',head:s.head,recovery_required,committed,working,dirty_paths:dirtyPaths,files:paths.map(path=>({path,source_sha256:hash(bundle.files.get(path)??null),head_sha256:hash(blob(s.head,path,true)),working_sha256:hash(file(path,{optional:true}))}))};
  }
  async function validateInstall(s,entries){
    const built=treeFrom(s.head,entries),stage=join(built.temporary,'snapshot');mkdirSync(stage);
    try{
      for(const [path,row]of snapshot(built.tree)){mkdirSync(dirname(join(stage,path)),{recursive:true});writeFileSync(join(stage,path),row.bytes);}
      mkdirSync(join(stage,'inbox'),{recursive:true});
      const previous=join(built.temporary,'previous.json');writeFileSync(previous,blob(s.head,'memory/graph.json'));
      const result=runChild(node,[join(engine,'processor/memory-tool.mjs'),'validate','--root',stage,'--previous',previous],{encoding:'utf8',maxBuffer:8*1024*1024});
      if(result.status!==0)throw new AdapterError('Profile candidate validation failed: '+(result.stderr??'').split('\n')[0]);
      return built;
    }catch(e){rmSync(built.temporary,{recursive:true,force:true});throw e;}
  }
  function memoryProvider(instance_id) {
    const load=async commit=>{
      const current=head(),selected=commit??current;
      if(!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(selected)||gitText(['rev-parse',selected+'^{commit}'])!==selected)throw new AdapterError('Snapshot unavailable');
      exec(['merge-base','--is-ancestor',selected,current]);
      return {snapshot_id:selected,files:new Map([...snapshot(selected)].map(([path,row])=>[path,Buffer.from(row.bytes)]))};
    };
    return createJsonProvider({instance_id,now,store:{load,transaction:action=>locked(async()=>{
      const s=state();assertLocalProtocol(s);
      const check=async change=>{
        if(head()!==s.head)throw new AdapterError('Base snapshot changed');
        own(state(),change.run_id);sourceCheck(s);
        if(scan(s).malformed.length)throw new AdapterError('Processed source changed');
        const kinds=[...new Set(s.lease.sources.map(x=>x.kind).filter(Boolean))];
        const bound=await profileAt(s.head,kinds),working=await loadGuidance(root,{kinds});
        if(guidanceIdentity(bound.guidance_version)!==change.policy_id||guidanceIdentity(working.guidance_version)!==change.policy_id)throw new AdapterError('Policy changed');
      };
      let change;
      return action({load:()=>load(s.head),checkBindings:async c=>{change=c;await check(c);},publish:async(files,label)=>{
        await hooks.beforeMemoryPublish?.({head:s.head});
        await check(change);assertLocalProtocol(s);
        const entries=new Map(),original=snapshot(s.head);
        for(const [path,bytes]of files){instancePath(path);const before=original.get(path)?.bytes??null;
          if(hash(before)!==hash(bytes)){
            if(hash(file(path,{optional:true}))!==hash(before))throw new AdapterError('Preserve local changes before provider publication: '+path);
            entries.set(path,bytes);
          }
        }
        for(const path of original.keys())if(!files.has(path))throw new AdapterError('Provider removed retained state');
        // No asynchronous callback occurs between these final fences and CAS.
        own(state(),change.run_id);sourceCheck(s);assertLocalProtocol(s);
        const next=publish(s,entries,[...entries.keys()],label);
        return next;
      }});
    })}});
  }
  async function cognitionView(instance_id,commit=head()) {
    return createProviderReadView(memoryProvider(instance_id),commit);
  }
  const api={
    async openMemory({instance_id}={}){return memoryProvider(instance_id);},
    async openCognition({instance_id}={}){return cognitionView(instance_id);},
    async publishLearning({task,proposal,authorization}={}){return locked(async()=>{
      // Authorization is a trusted host decision, never read from model output.
      if(authorization?.task_id!==task?.task_id||authorization?.proposal_id!==proposal?.proposal_id||authorization?.allowed!==true)throw new AdapterError('Learning publication is not authorized');
      const s=state(),receiptPath='memory/learning/'+hash(json(proposal?.proposal_id))+'.json';
      const prior=blob(s.head,receiptPath,true);
      if(prior){const receipt=JSON.parse(utf8(prior));if(JSON.stringify(receipt.proposal)!==JSON.stringify(proposal)||receipt.task_id!==task.task_id||receipt.instance_id!==task.binding.instance_id)throw new AdapterError('Learning retry differs from receipt');return {status:'already_published',head:s.head,receipt_path:receiptPath};}
      if(s.held||s.lease.status==='processing')throw new AdapterError('Release processing lease before learning publication');
      assertLocalProtocol(s);if(scan(s).malformed.length)throw new AdapterError('Processed source changed or missing');
      const view=await cognitionView(task.binding.instance_id,s.head);
      const graph=JSON.parse(utf8(blob(s.head,'memory/graph.json')));
      const errors=validateLearning(proposal,task,{binding:view.binding,claims:graph.claims});if(errors.length)throw new AdapterError(errors.join('; '));
      const layout=await resolveLayout(root,{read:readAt(s.head)}),path=layout.hypotheses_path;
      const hypotheses=JSON.parse(utf8(blob(s.head,path))),old=hypotheses.hypotheses.find(h=>h.id===proposal.target_id);
      if(hypotheses.hypotheses.some(h=>h.id===proposal.hypothesis_id||h.statement===proposal.statement))throw new AdapterError('Duplicate learning hypothesis');
      if(proposal.operation==='correct_hypothesis'){
        if(!old||old.status==='withdrawn')throw new AdapterError('Correction target missing or withdrawn');
        old.status='withdrawn';old.updated_at=stamp();
      }
      const h={confidence:null,id:proposal.hypothesis_id,statement:proposal.statement,status:'open',updated_at:stamp(),support:proposal.support,refutation:proposal.refutation,confidence_basis:('Unknown confidence. '+proposal.uncertainty.join('; ')).slice(0,4000)};
      hypotheses.hypotheses.push(h);hypotheses.updated_at=stamp();
      const receipt={protocol_version:1,task_id:task.task_id,instance_id:task.binding.instance_id,proposal,published_at:stamp(),authorization_reference:authorization.reference??null};
      const entries=new Map([[path,json(hypotheses)],[receiptPath,json(receipt)]]);
      for(const [p]of entries)if(hash(file(p,{optional:true}))!==hash(blob(s.head,p,true)))throw new AdapterError('Preserve local learning changes before publication');
      assertIndexClean([...entries.keys()],s.head);
      const built=await validateInstall(s,entries);
      try{return {status:'published',head:publish(s,entries,[...entries.keys()],'reviewed-learning '+proposal.proposal_id,built.tree),receipt_path:receiptPath};}
      finally{rmSync(built.temporary,{recursive:true,force:true});}
    });},
    async status(){const s=state();return {contract_version:1,capabilities:[...cognitiveCapabilities,'memory-provider-v1','candidate-validation-v1','purpose-guidance-v2','profile-install-v1','core-policies-v2'],head:s.head,lease:{...s.lease,held:s.held},...scan(s),recovery_required:existsSync(marker)||[LEASE,LEDGER].some(path=>hash(file(path,{optional:true}))!==hash(blob(s.head,path)))};},
    async 'profile-status'({source}={}){if(!source)throw new AdapterError('--source is required');return profileStatus(source);},
    async 'profile-install'({source}={}){return locked(async()=>{
      if(!source)throw new AdapterError('--source is required');
      const s=state();assertLocalProtocol(s);if(s.held)throw new AdapterError('An unexpired processing lease is held');
      if(s.lease.status==='processing')throw new AdapterError('Release the expired processing lease before installing guidance');
      const bundle=await readApplicationSource(source,{git}),read=readAt(s.head);
      const old=await managedPaths(root,{read});
      if(old.length&&JSON.parse(utf8(bundle.files.get('golem.config.json'))).profile==null)throw new AdapterError('Implicit profile deselection refused');
      const stale=old.filter(path=>!bundle.files.has(path));for(const path of stale)if(path!=='golem.config.json')installPath(path);
      const entries=new Map(bundle.files);for(const path of stale)entries.set(path,null);
      // A newly owned path must not erase an unrelated local file. Previously selected
      // guidance and canonical purpose are explicitly restored by this operation.
      for(const [path,bytes]of entries){
        const local=file(path,{optional:true}),committed=blob(s.head,path,true);
        if(!old.includes(path)&&path!=='instance/purpose.md'&&path!=='golem.config.json'&&local!==null&&hash(local)!==hash(committed)&&hash(local)!==hash(bytes))throw new AdapterError('Preserve unowned local file before installation: '+path);
      }
      assertIndexClean([...entries.keys()],s.head);
      const changed=[...entries].some(([path,bytes])=>hash(bytes)!==hash(blob(s.head,path,true)));
      const restored=[...entries].filter(([path,bytes])=>hash(file(path,{optional:true}))!==hash(bytes)).map(([path])=>path);
      if(!changed){
        // Use the same durable reconciliation record even when no new commit is needed.
        const writes=restored.map(path=>({path,before:hash(file(path,{optional:true})),after:hash(entries.get(path))}));
        if(writes.length){writeFileSync(marker,json({old:null,next:s.head,paths:[...entries.keys()],writes}),{flag:'wx'});finishPending();}
        return {status:'unchanged',head:s.head,restored_paths:restored,source:sourceMetadata(bundle)};
      }
      const built=await validateInstall(s,entries);
      try{await hooks.beforeInstall?.({head:s.head,tree:built.tree});
        const next=publish(s,entries,[...entries.keys()],'profile-install '+JSON.stringify(sourceMetadata(bundle)),built.tree);
        return {status:'installed',head:next,restored_paths:restored,removed_paths:stale,source:sourceMetadata(bundle)};
      }finally{rmSync(built.temporary,{recursive:true,force:true});}
    });},
    async claim({max=20,required_capabilities=[]}={}){return locked(async()=>{
      if(!Number.isInteger(Number(max))||Number(max)<1||Number(max)>20)throw new AdapterError('max must be an integer in 1..20');
      const s=state();assertLocalProtocol(s);
      for(const capability of required_capabilities)if(!['memory-provider-v1','candidate-validation-v1','purpose-guidance-v2','profile-install-v1','core-policies-v2'].includes(capability))throw new AdapterError('Required capability unavailable: '+capability);
      if(sourceGuard){const checked=await profileStatus(sourceGuard);if(checked.state!=='in-sync'||checked.recovery_required)throw new AdapterError('Reviewed source drift; run profile-install for this instance');}
      if(hash(file('instance/purpose.md'))!==hash(blob(s.head,'instance/purpose.md')))throw new AdapterError('Commit instance purpose before claiming');
      const layout=await resolveLayout(root),committedLayout=await resolveLayout(root,{read:readAt(s.head)});
      if(JSON.stringify(layout)!==JSON.stringify(committedLayout))throw new AdapterError('Commit instance layout changes before claiming');
      if(s.held)throw new AdapterError('An unexpired processing lease is held');
      const inventory=scan(s);if(inventory.malformed.length)throw new AdapterError('Malformed or changed source requires intervention');
      const sources=inventory.ready.slice(0,Number(max));
      const profile=await profileAt(s.head,[...new Set(sources.map(s=>s.kind).filter(Boolean))]);
      // Dirty configured guidance cannot silently be ignored in favor of older committed instructions.
      const config=blob(s.head,'golem.config.json',true);
      if(hash(file('golem.config.json',{optional:true}))!==hash(config))throw new AdapterError('Commit profile configuration before claiming');
      if(config&&JSON.parse(utf8(config)).profile){const cfg=JSON.parse(utf8(config)).profile;for(const path of [cfg.path,...(cfg.sections??[]).map(s=>s.path),...(cfg.vocabulary?[cfg.vocabulary]:[])])if(hash(file(path))!==hash(blob(s.head,path)))throw new AdapterError('Commit selected profile files before claiming');}
      assertIndexClean(['instance/purpose.md','golem.config.json',...await managedPaths(root,{read:readAt(s.head)})],s.head);
      if(!sources.length)return {status:'no-work'};
      const run=randomUUID(),lease={schema_version:1,run_id:run,status:'processing',claimed_at:stamp(),expires_at:new Date(now()+900000).toISOString(),observation_ids:sources.map(s=>s.id),sources,...(profile?{guidance_version:profile.guidance_version}:{})};
      const entries=new Map([[LEASE,json(lease)]]),writes=[LEASE];
      if(required_capabilities.includes('memory-provider-v1'))for(const source of sources)entries.set(source.path,file(source.path));
      if(profile){const path=`memory/runs/${run}.guidance.json`;entries.set(path,json(profile));writes.push(path);}
      const next=publish(s,entries,writes,`claim ${run}`);
      return {status:'claimed',run_id:run,head:next,expires_at:lease.expires_at,sources,...(profile?{guidance:profile.guidance,guidance_version:profile.guidance_version,guidance_boundary:profile.guidance_boundary,guidance_identity:guidanceIdentity(profile.guidance_version),guidance_path:`memory/runs/${run}.guidance.json`}:{})};
    });},
    async renew({run}={}){return locked(async()=>{const s=state();assertLocalProtocol(s);own(s,run);const lease={...s.lease,expires_at:new Date(now()+900000).toISOString()};const next=publish(s,new Map([[LEASE,json(lease)]]),[LEASE],`renew ${run}`);return {head:next,expires_at:lease.expires_at};});},
    async 'release-error'({run}={}){return locked(async()=>{const s=state();assertLocalProtocol(s);const next=errorLease(s,run);return {status:'error',head:next};});},
    async validate({run,outputs}={}){
      if(!run){const s=state(),tmp=mkdtempSync(join(gitdir,'golem-validate-'));try{const previous=join(tmp,'previous.json');writeFileSync(previous,blob(s.head,'memory/graph.json'));const r=runChild(node,[join(engine,'processor/memory-tool.mjs'),'validate','--root',root,'--previous',previous],{encoding:'utf8',maxBuffer:8*1024*1024});if(r.status!==0)throw new AdapterError('Working-tree validation failed: '+(r.stderr??'').split('\n')[0].slice(0,500));return {ok:true,mode:'working-tree',head:s.head,output:JSON.parse(r.stdout)};}finally{rmSync(tmp,{recursive:true,force:true});}}
      const s=state();const built=await candidate(s,run,outputs);try{return {ok:true,mode:'candidate',head:s.head,output:built.validation,files:built.files,left_uncommitted:built.left_uncommitted};}finally{rmSync(built.temporary,{recursive:true,force:true});}
    },
    async commit({run,outputs}={}){return locked(async()=>{
      const s=state();assertLocalProtocol(s);own(s,run);
      // Preflight errors keep the lease for correction; source/integrity errors release it.
      parseOutputs(outputs);file(`memory/runs/${run}.md`);
      let built;
      try{built=await candidate(s,run,outputs);}catch(e){if(/source|Source|Candidate validation/.test(e.message)&&head()===s.head)errorLease(s,run,e.message);throw e;}
      try{
        await hooks.beforeCommit?.({head:s.head,tree:built.tree});
        if(head()!==s.head)throw new AdapterError('Head changed; re-read, merge and revalidate; lease retained');
        own(state(),run);try{sourceCheck(s);}catch(e){errorLease(s,run);throw new AdapterError('Claimed source changed; inputs remain pending');}
        const next=publish(s,built.entries,[LEDGER,LEASE],`complete ${run}`,built.tree);
        const saved=state(next);for(const source of s.lease.sources)if(!saved.ledger.observations.some(r=>r.id===source.id&&r.source_sha256===source.sha256))throw new AdapterError('Persisted completion verification failed');
        return {status:'committed',head:next,processed:s.lease.observation_ids,files:built.files,left_uncommitted:dirty(),warnings:built.validation.warnings??[],warning_summary:built.validation.warning_summary};
      }finally{rmSync(built.temporary,{recursive:true,force:true});}
    });}
  };
  const setup=metrics.report();
  if(timings)for(const [name,action]of Object.entries(api))api[name]=async (...args)=>{
    metrics.reset();
    try {const result=await action(...args);return {...result,timings:{operation:name,setup,...metrics.report()}};}
    catch(error){error.timings={operation:name,setup,...metrics.report()};throw error;}
  };
  return api;
}

export async function run(args=process.argv.slice(2)) {
  const command=args.shift(),options={};
  if(!['status','claim','renew','validate','commit','release-error','profile-status','profile-install'].includes(command))throw new AdapterError('Expected status|claim|renew|validate|commit|release-error|profile-status|profile-install');
  for(let i=0;i<args.length;i+=2){const key=args[i]?.slice(2);if(!args[i]?.startsWith('--')||args[i+1]===undefined||!['instance','harness','max','run','outputs','reason','timings','git','node','source','source-guard'].includes(key)||Object.hasOwn(options,key))throw new AdapterError('Unknown, duplicate or incomplete option');options[key]=args[i+1];}
  if(!options.instance)throw new AdapterError('--instance is required');
  if(options.timings!==undefined&&!['true','false'].includes(options.timings))throw new AdapterError('--timings must be true or false');
  return createAdapter({...options,sourceGuard:options['source-guard'],timings:options.timings==='true'})[command](options);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))run().then(r=>console.log(JSON.stringify(r,null,2))).catch(e=>{if(e.timings)console.error('GOLEM_TIMINGS '+JSON.stringify(e.timings));console.error(e instanceof AdapterError?e.message:'Adapter operation failed; inspect local configuration and protocol state');process.exitCode=1;});
