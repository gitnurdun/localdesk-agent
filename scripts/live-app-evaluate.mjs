import path from 'node:path';
import fs from 'node:fs/promises';
import {loadConfig,APP} from '../src/config.mjs';
import {Store} from '../src/store.mjs';
import {startServer} from '../src/server.mjs';
import {writeJSON} from '../src/util.mjs';
const runId=new Date().toISOString().replace(/[:.]/g,'-');const root=path.join(APP,'data','app-evaluations',runId);
const config=await loadConfig({workspace:path.join(root,'workspace'),data:path.join(root,'state'),skillsDir:path.join(root,'skills'),readRoots:[],writeRoots:[],port:4328});
const store=new Store(config);await fs.writeFile(path.join(config.workspace,'notes.md'),'The project codename is Silverfin. Its budget is 420 dollars.');
const app=await startServer(config,store);const token=(await (await fetch(app.url+'/api/session')).json()).token;const headers={'Content-Type':'application/json','X-LocalDesk-Token':token};
const request=async(route,body)=>{const r=await fetch(app.url+'/api'+route,{method:body?'POST':'GET',headers,body:body?JSON.stringify(body):undefined});const data=await r.json();if(!r.ok)throw Error(data.error);return data;};
async function wait(id){for(let n=0;n<900;n++){const {task}=await request('/tasks/'+id);if(!['queued','running'].includes(task.status)){await new Promise(r=>setTimeout(r,50));return task;}await new Promise(r=>setTimeout(r,200));}throw Error('Task wait timed out');}
const report=[];async function run(name,conversationId,content,options,check){const start=Date.now();const task=await request('/conversations/'+conversationId+'/messages',{content,...options});const done=await wait(task.id);const events=(await request('/tasks/'+task.id)).events;const thread=await request('/conversations/'+conversationId);let passed=false;try{passed=done.status==='completed'&&await check(done,events,thread);}catch{}const row={name,passed,status:done.status,seconds:+((Date.now()-start)/1000).toFixed(1),answer:done.result,taskId:done.id,tools:events.filter(e=>e.type==='tool_call').map(e=>e.tool)};report.push(row);console.log(JSON.stringify(row));await writeJSON(path.join(APP,'data','latest-app-evaluation.json'),{runId,model:config.model,contextTokens:config.contextTokens,results:report});}
try{
  const c=await request('/conversations',{});
  await run('chat-mode',c.id,'Explain what a local language model is in two sentences.',{mode:'chat'},async(t,e)=>/computer|device|locally|offline|Ollama/i.test(t.result)&&!t.result.includes('[S')&&!e.some(e=>e.type==='tool_call'));
  await run('conversation-followup',c.id,'My project is named Bluejay. Acknowledge that in one sentence.',{mode:'chat'},async(t,e)=>/acknowledge|Bluejay/i.test(t.result)&&!e.some(e=>e.type==='tool_call'));
  await run('conversation-recall',c.id,'What is my project named?',{mode:'chat'},async t=>/Bluejay/i.test(t.result));
  await run('work-without-tools',c.id,'Hi! Give me a friendly one-sentence greeting.',{mode:'work'},async(_t,e)=>!e.some(e=>e.type==='tool_call'));
  await run('work-output-in-chat',c.id,'Create hello.txt containing exactly: Hello local world',{mode:'work'},async(_t,_e,c)=> (await fs.readFile(path.join(config.workspace,'hello.txt'),'utf8')).trim()==='Hello local world'&&c.messages.at(-1).role==='assistant'&&c.messages.at(-1).status==='completed');
  await run('current-computer-facts',c.id,'Inspect my CPU, RAM and GPU and report all three.',{mode:'work'},async t=>/12700H/.test(t.result)&&/3050/.test(t.result));
  await request('/knowledge/index',{path:'notes.md'});const rag=await request('/conversations',{});
  await run('retrieval-grounded-chat',rag.id,'According to my indexed notes, what is the project codename and budget?',{mode:'chat',rag:true},async t=>/Silverfin/.test(t.result)&&/420/.test(t.result)&&t.citations?.length>0);
  await request('/skills',{id:'one-line',name:'One line',description:'One concise sentence',triggers:[],modes:['chat'],content:'Answer in exactly one short sentence. Do not add bullets or headings.'});
  await run('selected-skill',rag.id,'Explain why local models are useful.',{mode:'chat',rag:false,skillIds:['one-line']},async t=>t.usedSkills.includes('one-line')&&t.result.length<500&&(t.result.match(/[.!?。！？]+/g)??[]).length<=1);
  await request('/mcp/demo',{});const mc=await request('/conversations',{});
  await run('real-mcp-tool',mc.id,'Use the local_clock tool from the connected MCP example and tell me the local time.',{mode:'work',rag:false},async(_t,e)=>e.some(e=>e.type==='tool_result'&&e.tool.startsWith('mcp_')&&e.ok));
  await run('schedule-from-work-chat',mc.id,'Schedule a CPU and RAM report every 60 minutes in Work mode.',{mode:'work',rag:false},async(_t,e)=>e.some(e=>e.type==='tool_result'&&e.tool==='schedule_create'&&e.ok)&& (await request('/schedules')).some(s=>s.minutes===60&&s.enabled&&s.mode==='work'&&!/^Schedule\b/i.test(s.goal)));
  const scheduled=(await request('/schedules')).find(s=>s.minutes===60);
  if(scheduled){const all=await request('/schedules');all.find(s=>s.id===scheduled.id).nextRun=new Date(Date.now()-1000).toISOString();await writeJSON(path.join(config.data,'schedules.json'),all);await app.tick();let thread;for(let i=0;i<100;i++){thread=await request('/conversations/'+scheduled.conversationId);if(thread.messages.at(-1)?.taskId)break;await new Promise(r=>setTimeout(r,100));}const done=await wait(thread.messages.at(-1).taskId);const events=(await request('/tasks/'+done.id)).events;const saved=await request('/conversations/'+scheduled.conversationId);const passed=done.status==='completed'&&events.some(e=>e.type==='tool_result'&&e.tool==='system_info'&&e.ok)&&!events.some(e=>e.type==='tool_call'&&e.tool==='schedule_create')&&saved.messages.at(-2).scheduled&&saved.messages.at(-1).status==='completed'&&(await request('/schedules')).length===all.length;const row={name:'scheduled-work-posts-to-chat',passed,status:done.status,answer:done.result,taskId:done.id};report.push(row);console.log(JSON.stringify(row));await writeJSON(path.join(APP,'data','latest-app-evaluation.json'),{runId,model:config.model,contextTokens:config.contextTokens,results:report});}
}finally{await app.close();}
console.log(report.filter(r=>r.passed).length+'/'+report.length+' live app checks passed');if(report.some(r=>!r.passed))process.exitCode=1;
