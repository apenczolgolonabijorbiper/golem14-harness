import {createHash} from 'node:crypto';
export function parseSource(path,text){
  const match=text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);if(!match)throw Error('Incomplete source: '+path);
  const fields=Object.create(null);for(const line of match[1].split('\n')){const m=line.match(/^([a-z_]+):\s*(.*?)\s*$/);if(!m)throw Error('Invalid source header: '+path);if(Object.hasOwn(fields,m[1]))throw Error('Duplicate source field: '+path);let value=m[2];if(value.startsWith('"')){try{value=JSON.parse(value);}catch{throw Error('Invalid quoted header: '+path);}}fields[m[1]]=value;}
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(fields.id)||path!==`inbox/${fields.id}.md`||!match[2].trim()||!Number.isFinite(Date.parse(fields.recorded_at)))throw Error('Invalid source: '+path);
  return {...fields,path,body:match[2],sha256:createHash('sha256').update(text,'utf8').digest('hex')};
}
