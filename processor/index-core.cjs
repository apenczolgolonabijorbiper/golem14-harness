/** Synchronous Node evidence core, also consumed directly by hosts. */
const fs=require('node:fs'),path=require('node:path');
const {createHash,randomUUID}=require('node:crypto');
const utf8=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});
const whitespace='[\\t\\n\\v\\f\\r \\u001c-\\u001f\\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]';
const trim=text=>text.replace(new RegExp('^'+whitespace+'+|'+whitespace+'+$','g'),'');
const busy=()=>Error('Indexer busy: another process holds this instance indexer lock');

// Nonblocking Lamport bakery mutex, with one immutable-identity register per
// contender. Dead registers are removed individually; no shared lock is stolen
// or unlinked. PID reuse/permission ambiguity fails closed. Local filesystem and
// a single OS PID namespace/identity are required (as for the reference adapter).
function indexerLock(root){
  const directory=path.join(root,'.golem-indexer-locks');
  fs.mkdirSync(directory,{recursive:true,mode:0o700});
  if(fs.lstatSync(directory).isSymbolicLink())throw Error('Linked indexer lock directory refused');
  const identity=`${process.pid}-${randomUUID()}`,mine=path.join(directory,identity);
  const fd=fs.openSync(mine,'wx',0o600);
  const release=()=>{try{fs.unlinkSync(mine);}catch(e){if(e.code!=='ENOENT')throw e;}};
  function contenders(){
    const rows=[];
    for(const name of fs.readdirSync(directory)){
      if(!/^\d+-[a-f0-9-]{36}$/.test(name))throw Error('Invalid indexer lock register');
      const pid=Number(name.split('-')[0]),file=path.join(directory,name);
      try{process.kill(pid,0);}catch(e){if(e.code==='ESRCH'){try{fs.unlinkSync(file);}catch(x){if(x.code!=='ENOENT')throw x;}continue;}if(e.code!=='EPERM')throw e;}
      try{
        const text=fs.readFileSync(file,'utf8');
        rows.push({name,ticket:/^[1-9][0-9]*\n$/.test(text)?BigInt(text.trim()):null});
      }catch(e){if(e.code!=='ENOENT')throw e;}
    }
    return rows;
  }
  try{
    let ticket=1n;
    for(const row of contenders())if(row.ticket!==null&&row.ticket>=ticket)ticket=row.ticket+1n;
    fs.writeSync(fd,`${ticket}\n`);fs.closeSync(fd);
    for(const row of contenders())if(row.name!==identity&&(row.ticket===null||row.ticket<ticket||(row.ticket===ticket&&row.name<identity)))throw busy();
    return release;
  }catch(e){try{fs.closeSync(fd);}catch{}release();throw e;}
}

function publishEvidence(target,evidence,{beforePublish}={}){
  const temporary=path.join(path.dirname(target),`.golem-index-${randomUUID()}.tmp`);
  let fd;
  try{
    fd=fs.openSync(temporary,'wx',0o600);
    fs.writeFileSync(fd,JSON.stringify(evidence,null,2)+'\n');fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;
    beforePublish?.(temporary,target);
    fs.renameSync(temporary,target);
  }finally{if(fd!==undefined)fs.closeSync(fd);fs.rmSync(temporary,{force:true});}
}
function index(root,{log=console.log,beforePublish,afterPublish}={}){
  root=fs.realpathSync(root);
  const release=indexerLock(root);
  try{
    const directory=path.join(root,'evidence');fs.mkdirSync(directory,{recursive:true});
    for(const name of fs.readdirSync(directory))if(/^\.golem-index-.*\.tmp$/.test(name))fs.unlinkSync(path.join(directory,name));
    let names=[];try{names=fs.readdirSync(path.join(root,'inbox'));}catch(e){if(e.code!=='ENOENT')throw e;}
    let count=0;
    for(const name of names.filter(n=>n.endsWith('.md')).sort()){
      const raw=fs.readFileSync(path.join(root,'inbox',name)),content=utf8.decode(raw).replace(/\r\n?/g,'\n');
      const end=content.indexOf('\n---\n',4);
      if(!content.startsWith('---\n')||end<0){log('Malformed: '+name);continue;}
      const fields=Object.create(null);
      for(const m of content.slice(4,end).matchAll(new RegExp('^([a-z_]+):'+whitespace+'*([^\\n]*)$','gm')))fields[m[1]]=m[2];
      const id=fields.id??'';
      if(!/^[0-9a-fA-F-]{36}$/.test(id)){log('Invalid ID: '+name);continue;}
      const target=path.join(directory,id+'.json');if(fs.existsSync(target))continue;
      const evidence={id,source_file:'inbox/'+name,sha256:createHash('sha256').update(raw).digest('hex'),recorded_at:fields.recorded_at??null,event_date:fields.event_date??null,kind:fields.kind??null,text:trim(content.slice(end+5)),interpretation:'not_inferred'};
      if(fields.question_id){let text=fields.question_text??'""';try{text=JSON.parse(text);}catch{}evidence.question={id:fields.question_id,text,source:fields.question_source??null};}
      publishEvidence(target,evidence,{beforePublish});afterPublish?.(target);log('Indexed: '+id);count++;
    }
    return count;
  }finally{release();}
}

module.exports={index,indexerLock,publishEvidence};
