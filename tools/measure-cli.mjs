// Isolated CLI memory probe used only by the synthetic capacity benchmark.
import {run} from '../processor/memory-tool.mjs';
const result=await run(process.argv.slice(2)),rendered=JSON.stringify(result,null,2)+'\n';
console.log(JSON.stringify({peak_rss_mib:Math.round(process.resourceUsage().maxRSS/1024),rendered_output_bytes:Buffer.byteLength(rendered)}));
