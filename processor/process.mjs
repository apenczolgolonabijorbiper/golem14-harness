import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import core from './index-core.cjs';
export const {index,indexerLock,publishEvidence}=core;
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{const {values}=parseArgs({options:{root:{type:'string'}}});if(!values.root)throw Error('--root is required');index(values.root);}
  catch(e){console.error(e.message);process.exitCode=1;}
}
