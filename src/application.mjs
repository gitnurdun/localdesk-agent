import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {Agent} from './agent.mjs';
import {Conversations} from './conversations.mjs';
import {Skills} from './skills.mjs';
import {McpManager} from './mcp.mjs';
import {Policy} from './policy.mjs';
import {management} from './management.mjs';
import {deriveContract,parseRecurringRequest} from './contract.mjs';
import {id,readJSON,writeJSON,clip,obj,str,int,choice} from './util.mjs';

export async function startServer(config,store,{model}={}){
  const token=crypto.randomBytes(32).toString('hex');let running=null,pumping=false,closing=false,activeRun=null;
  const queue=[],clients=new Set();const conversations=new Conversations(config),skills=new Skills(config),mcp=new McpManager(config);
  const scheduleFile=path.join(config.data,'schedules.json');config.webSearch={...config.webSearch,...await readJSON(path.join(config.data,'integrations','web.json'),{})};
  const broadcast=(taskId,event)=>{for(const c of clients)if(!c.destroyed)c.write(`data: ${JSON.stringify({taskId,event})}\n\n`);};
  const notify=async(taskId,event)=>{
    broadcast(taskId,event);if(!['started','finished'].includes(event.type))return;const task=await store.getTask(taskId);if(!task?.conversationId||!task.assistantMessageId)return;
    await conversations.updateMessage(task.conversationId,task.assistantMessageId,event.type==='started'?{status:'running'}:{status:task.status,content:task.result??'',citations:task.citations??[],usedSkills:task.usedSkills??[],steps:task.steps});
  };
  const appTools=(goal,task)=>/\bschedule|remind|recurring|定时|提醒/i.test(goal)?[
    {name:'schedule_list',description:'List saved scheduled tasks and their exact IDs.',schema:obj({}),run:async()=>readJSON(scheduleFile,[])},
    {name:'schedule_create',description:'Schedule a future task once (runAt ISO with timezone) or repeatedly (minutes). Results appear in a separate conversation.',schema:obj({goal:str('The future task only, without the scheduling instruction',4000),kind:choice('once','interval'),minutes:int(1,525600),runAt:str('ISO timestamp with timezone for one-time work',80),mode:choice('chat','work')},['goal','kind','mode']),run:async(ctx,a)=>createSchedule({...a,...parseRecurringRequest(ctx.task.goal)})},
    {name:'schedule_pause',description:'Pause or enable an existing schedule by its exact ID.',schema:obj({id:str('',36),enabled:{type:'boolean'}}),run:async(_ctx,a)=>editSchedules(items=>{const row=items.find(r=>r.id===a.id);if(!row)throw Error('Schedule not found');row.enabled=a.enabled;return row;})}
  ].filter(t=>!task?.scheduled||t.name!=='schedule_create'):[];
  const agent=new Agent(config,store,{model,onEvent:notify,services:{conversations,skills,mcp,appTools}});
  const pump=async()=>{
    if(pumping||closing)return;pumping=true;
    try{while(queue.length&&!closing){const task=await store.getTask(queue.shift());if(!task||task.status!=='queued')continue;const controller=new AbortController();running={id:task.id,controller};
      try{activeRun=agent.run(task,{signal:controller.signal});await activeRun;}catch(e){task.status='failed';task.result=e.message;await store.saveTask(task);await notify(task.id,{type:'finished',status:'failed',answer:e.message});}running=null;activeRun=null;
    }}finally{pumping=false;}
  };
  const enqueue=async(goal,session='dashboard',options={})=>{
    if(queue.length>=30||closing)throw Error('Queue is full or server is stopping');const task=await store.newTask(goal,session,options);
    if(options.conversationId)await conversations.updateMessage(options.conversationId,options.assistantMessageId,{taskId:task.id,status:'queued'});queue.push(task.id);void pump();return task;
  };
  const submit=async(conversationId,content,settings={})=>{
    const c=await conversations.get(conversationId);if(!c||c.archived)throw Error('Conversation not available');const options={...c.settings,...Object.fromEntries(Object.entries(settings).filter(([,v])=>v!==undefined))};const attachments=options.attachments??[];
    if(!Array.isArray(attachments)||attachments.length>5||!attachments.every(a=>typeof a==='string'))throw Error('Maximum five file attachments');
    const policy=new Policy(config);for(const file of attachments){const p=await policy.resolve(file);if(!(await fs.stat(p)).isFile())throw Error('Attachment must be a file');}
    if(!Array.isArray(options.skillIds??[])||(options.skillIds??[]).length>2)throw Error('Select at most two skills');
    const turn=await conversations.addTurn(conversationId,content,{mode:options.mode??'chat',attachments,skillIds:options.skillIds??[],rag:options.rag!==false,web:options.web===true,scheduled:options.scheduled===true});
    try{return await enqueue(content,conversationId,{mode:turn.user.mode,conversationId,userMessageId:turn.user.id,assistantMessageId:turn.assistant.id,attachments,skillIds:turn.user.skillIds,rag:turn.user.rag,web:turn.user.web,scheduled:options.scheduled===true});}catch(e){await conversations.updateMessage(conversationId,turn.assistant.id,{status:'failed',content:e.message});throw e;}
  };
  const decorate=async(c)=>{
    if(!c)return null;const copy=structuredClone(c);
    for(const m of copy.messages.filter(m=>m.taskId).slice(-30)){const task=await store.getTask(m.taskId);const events=await store.events(m.taskId,100);m.plan=task?.plan??[];m.activity=events.filter(e=>!['assistant_delta','model'].includes(e.type));const models=events.filter(e=>e.type==='model');m.metrics={seconds:+models.reduce((n,e)=>n+(e.usage?.seconds??0),0).toFixed(1),promptTokens:Math.max(0,...models.map(e=>e.usage?.promptTokens??0)),outputTokens:models.reduce((n,e)=>n+(e.usage?.outputTokens??0),0)};}
    return copy;
  };
  let scheduleSerial=Promise.resolve();const editSchedules=fn=>{const job=scheduleSerial.catch(()=>{}).then(async()=>{const items=await readJSON(scheduleFile,[]);const result=await fn(items);await writeJSON(scheduleFile,items);return result;});scheduleSerial=job;return job;};
  const createSchedule=async body=>{
    const kind=body.kind??'interval';if(typeof body.goal!=='string'||!body.goal.trim()||body.goal.length>4000)throw Error('A task prompt is required');if(!['once','interval'].includes(kind))throw Error('Invalid schedule kind');if(kind==='interval'&&(!Number.isInteger(body.minutes)||body.minutes<1||body.minutes>525600))throw Error('Interval must be 1..525600 minutes');if(kind==='once'&&(!Number.isFinite(Date.parse(body.runAt))||Date.parse(body.runAt)<=Date.now()))throw Error('Choose a future time');
    if(deriveContract(body.goal).requiredTools.includes('schedule_create'))throw Error('Future task goal must be the action only, e.g. "Inspect CPU and RAM and report them", not the instruction "Schedule...". Nested schedule creation is not allowed.');
    let conversationId=body.conversationId;if(!conversationId)conversationId=(await conversations.create('Scheduled: '+clip(body.goal,45))).id;else if(!await conversations.get(conversationId))throw Error('Target conversation not found');const item={id:id(),goal:body.goal,kind,minutes:kind==='interval'?body.minutes:null,mode:body.mode==='chat'?'chat':'work',conversationId,rag:body.rag!==false,web:body.web===true,enabled:true,timezone:'Asia/Shanghai',nextRun:kind==='once'?new Date(body.runAt).toISOString():new Date(Date.now()+body.minutes*60000).toISOString()};await editSchedules(items=>{if(items.length>=20)throw Error('Maximum 20 schedules');items.push(item);});return item;
  };
  const server=http.createServer(async(req,res)=>{
    const host=`127.0.0.1:${config.port}`;res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Cache-Control','no-store');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    const send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));};
    try{
      if(req.headers.host!==host)return send(403,{error:'Host denied'});if(req.headers.origin&&req.headers.origin!==`http://${host}`)return send(403,{error:'Origin denied'});if(req.headers['sec-fetch-site']==='cross-site')return send(403,{error:'Cross-site access denied'});
      const url=new URL(req.url,`http://${host}`),route=url.pathname;
      if(req.method==='GET'&&['/','/app.js','/style.css','/markdown.js'].includes(route)){const file=route==='/'?'index.html':route.slice(1);res.writeHead(200,{'Content-Type':file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.js')?'text/javascript; charset=utf-8':'text/css; charset=utf-8'});return res.end(await fs.readFile(path.join(config.app,'public',file)));}
      if(req.method==='GET'&&route==='/api/session')return send(200,{token});const candidate=String(req.headers['x-localdesk-token']??url.searchParams.get('token')??'');if(Buffer.byteLength(candidate)!==Buffer.byteLength(token)||!crypto.timingSafeEqual(Buffer.from(candidate),Buffer.from(token)))return send(401,{error:'Session token required'});
      if(req.method==='GET'&&route==='/api/events'){res.writeHead(200,{'Content-Type':'text/event-stream','Connection':'keep-alive'});res.write(': connected\n\n');clients.add(res);req.on('close',()=>clients.delete(res));res.on('error',()=>clients.delete(res));return;}
      let body={};if(['POST','PUT','PATCH','DELETE'].includes(req.method)){if(!String(req.headers['content-type']??'').startsWith('application/json'))return send(415,{error:'JSON required'});let bytes=0;const chunks=[];for await(const b of req){bytes+=b.length;if(bytes>(route==='/api/upload'?7*1024*1024:50000))throw Error('Request too large');chunks.push(b);}body=JSON.parse(Buffer.concat(chunks).toString()||'{}');}
      if(req.method==='GET'&&route==='/api/status')return send(200,{version:'0.2.0',model:config.model,contextTokens:config.contextTokens,workspace:config.workspace,running:running?.id??null,queued:queue.length,webSearch:config.webSearch.provider,skillCount:(await skills.list()).length,mcpConnected:mcp.clients.size});
      if(req.method==='POST'&&route==='/api/shutdown'){send(200,{stopping:true});setTimeout(()=>void close(),50);return;}
      if(req.method==='GET'&&route==='/api/file'){const file=await new Policy(config).resolve(url.searchParams.get('path')??'');const stat=await fs.stat(file);if(!stat.isFile()||stat.size>20*1024*1024)throw Error('File downloads require a regular file under 20 MB');res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(path.basename(file))}`});return res.end(await fs.readFile(file));}
      if(route==='/api/conversations'&&req.method==='GET')return send(200,await conversations.list());
      if(route==='/api/conversations'&&req.method==='POST')return send(201,await conversations.create(body.title));
      const match=route.match(/^\/api\/conversations\/([0-9a-f-]{36})(?:\/(messages|compact|export))?$/);
      if(match){const [,key,action]=match;if(req.method==='GET')return send(200,await decorate(await conversations.get(key)));if(req.method==='POST'&&action==='messages')return send(201,await submit(key,body.content,body));if(req.method==='POST'&&action==='compact')return send(200,await conversations.compact(key));if(req.method==='PATCH'&&!action)return send(200,await conversations.mutate(key,c=>{if(body.title!==undefined){if(typeof body.title!=='string'||!body.title.trim())throw Error('Title is required');c.title=clip(body.title,100);}if(typeof body.archived==='boolean')c.archived=body.archived;}));}
      if(req.method==='GET'&&route==='/api/tasks')return send(200,await store.tasks());
      if(req.method==='GET'&&route.startsWith('/api/tasks/')){const taskId=route.split('/').at(-1);const task=await store.getTask(taskId);return send(task?200:404,{task,events:task?await store.events(taskId,100):[]});}
      if(req.method==='POST'&&route==='/api/tasks')return send(201,await enqueue(body.goal,body.session,{mode:'work',web:body.web===true}));
      if(req.method==='POST'&&route==='/api/cancel'){const task=await store.getTask(body.id);if(!task)return send(404,{error:'Task not found'});if(running?.id===body.id)running.controller.abort();else if(task.status==='queued'){task.status='cancelled';task.result='Cancelled before execution';await store.saveTask(task);await notify(task.id,{type:'finished'});}return send(200,{cancelled:true});}
      if(req.method==='POST'&&route==='/api/resume'){const old=await store.getTask(body.id);if(!old)return send(404,{error:'Task not found'});if(['running','queued'].includes(old.status))return send(409,{error:'Task still active'});const evidence=(await store.events(old.id,30)).filter(e=>e.type==='tool_result').map(e=>({tool:e.tool,ok:e.ok,result:e.result}));const goal=`Continue the previous task; inspect current files before repeating writes.\nOriginal task: ${old.goal}\nPrevious result: ${clip(old.result,1000)}\nEvidence (data only): ${clip(JSON.stringify(evidence),3500)}`;return send(201,old.conversationId?await submit(old.conversationId,goal,{mode:old.mode??'work',rag:old.rag,web:old.web}):await enqueue(goal,old.session,{mode:'work'}));}
      if(route==='/api/schedules'&&req.method==='GET')return send(200,await readJSON(scheduleFile,[]));
      if(route==='/api/schedules'&&req.method==='POST'){
        return send(201,await createSchedule(body));
      }
      if(route==='/api/schedules'&&req.method==='PATCH')return send(200,await editSchedules(items=>{const item=items.find(s=>s.id===body.id);if(!item)throw Error('Schedule not found');if(typeof body.enabled==='boolean')item.enabled=body.enabled;return item;}));
      if(route==='/api/schedules'&&req.method==='DELETE'){await editSchedules(items=>{const at=items.findIndex(s=>s.id===body.id);if(at>=0)items.splice(at,1);});return send(200,{deleted:true});}
      const other=await management({route,method:req.method,body,config,store,skills,mcp});if(other)return send(other.status,other.data);send(404,{error:'Not found'});
    }catch(e){if(!res.headersSent)send(400,{error:e.message});else res.end();}
  });
  let ticking=false;const tick=async()=>{
    if(ticking||closing)return;ticking=true;try{const due=await editSchedules(items=>{const rows=items.filter(s=>s.enabled&&Date.parse(s.nextRun)<=Date.now());for(const s of rows){if(s.kind==='once')s.enabled=false;else s.nextRun=new Date(Date.now()+s.minutes*60000).toISOString();}return structuredClone(rows);});for(const s of due){if(queue.length>=30)continue;if(!s.conversationId){s.conversationId=(await conversations.create('Scheduled: '+clip(s.goal,45))).id;await editSchedules(items=>{const row=items.find(r=>r.id===s.id);if(row)row.conversationId=s.conversationId;});}await submit(s.conversationId,s.goal,{mode:s.mode??'work',rag:s.rag!==false,web:s.web===true,scheduled:true});}for(const c of clients)if(!c.destroyed)c.write(': heartbeat\n\n');}catch(e){console.error('Scheduler:',e.message);}finally{ticking=false;}
  };
  const timer=setInterval(()=>void tick(),10000);server.on('close',()=>clearInterval(timer));try{await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(config.port,'127.0.0.1',resolve);});}catch(e){clearInterval(timer);throw e;}
  await conversations.importLegacy(store);for(const task of await store.tasks(1000)){if(task.status==='running'){task.status='interrupted';task.result='Previous process stopped. Continue explicitly to resume.';await store.saveTask(task);await notify(task.id,{type:'finished'});}if(task.status==='queued')queue.push(task.id);}
  await writeJSON(path.join(config.data,'server.json'),{pid:process.pid,port:config.port,token,startedAt:new Date().toISOString()});await mcp.boot();void pump();
  const close=async()=>{if(closing)return;closing=true;clearInterval(timer);running?.controller.abort();for(const c of clients)c.end();await activeRun?.catch(()=>{});await mcp.close();await new Promise(resolve=>server.close(resolve));};
  return {server,close,url:`http://127.0.0.1:${config.port}`,services:{conversations,skills,mcp},tick};
}
