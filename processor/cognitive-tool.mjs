// JSON-lines reference host: no HTTP/MCP/model dependency and no write operations.
// First line: {task, instance_id}. Following lines: {id,operation,options}.
import {createInterface} from 'node:readline';
import {createAdapter} from '../adapters/reference-git/adapter.mjs';
import {createCognitiveSession} from '../server/cognitive-task.mjs';
const args=process.argv.slice(2);
if(args.length!==2||args[0]!=='--instance')throw Error('Usage: node processor/cognitive-tool.mjs --instance INSTANCE < requests.jsonl');
let session,view;
for await(const line of createInterface({input:process.stdin,crlfDelay:Infinity})){
  try{
    if(Buffer.byteLength(line)>1024*1024)throw Error('Request exceeds 1 MiB');
    const request=JSON.parse(line);let result;
    if(!view){view=await createAdapter({instance:args[1]}).openCognition({instance_id:request.instance_id});if(request.task)session=createCognitiveSession(request.task,view);result={binding:view.binding,guidance:view.guidance};}
    else if(!session){session=createCognitiveSession(request.task,view);result={binding:view.binding};}
    else if(request.operation==='round'){session.beginRound();result=session.receipt().usage;}
    else if(request.operation==='context')result=await session.context(request.options);
    else if(request.operation==='source')result=await session.source(request.options.id,request.options);
    else if(request.operation==='receipt')result=session.receipt();
    else if(request.operation==='finish')result=session.finish(request.result);
    else throw Error('Unsupported operation');
    console.log(JSON.stringify({id:request.id??null,result}));
  }catch(e){console.log(JSON.stringify({error:e.message}));process.exitCode=1;}
}
