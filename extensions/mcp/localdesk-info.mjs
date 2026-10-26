// Example local MCP server. No dependency install required.
import readline from 'node:readline';
const reader=readline.createInterface({input:process.stdin});
for await(const line of reader){let message;try{message=JSON.parse(line);}catch{continue;}if(message.id===undefined)continue;let result,error;
  if(message.method==='initialize')result={protocolVersion:'2025-06-18',serverInfo:{name:'localdesk-example',version:'1.0.0'},capabilities:{tools:{}}};
  else if(message.method==='tools/list')result={tools:[{name:'local_clock',description:'Return the current local time and UTC time.',inputSchema:{type:'object',properties:{},additionalProperties:false}}]};
  else if(message.method==='tools/call'&&message.params?.name==='local_clock')result={content:[{type:'text',text:JSON.stringify({utc:new Date().toISOString(),local:new Date().toString()})}]};
  else if(message.method==='ping')result={};else error={code:-32601,message:'Method not found'};
  process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:message.id,...(error?{error}:{result})})+'\n');
}
