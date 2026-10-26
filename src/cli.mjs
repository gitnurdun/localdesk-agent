#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline/promises';
import { stdin,stdout } from 'node:process';
import { loadConfig } from './config.mjs';
import { Store } from './store.mjs';
import { Agent } from './agent.mjs';
import { doctor } from './doctor.mjs';
import { startServer } from './server.mjs';
import { ensureOllama } from './startup.mjs';
import { readJSON } from './util.mjs';
import {Conversations} from './conversations.mjs';
import {McpManager} from './mcp.mjs';

const [command='serve',...args]=process.argv.slice(2);
try{
  const config=await loadConfig();const store=new Store(config);
  if(command==='doctor')console.log(JSON.stringify(await doctor(config),null,2));
  else if(command==='serve'){
    const ollama=await ensureOllama(config);if(ollama.started)console.log('Started the installed local Ollama service.');
    const app=await startServer(config,store);console.log(`LocalDesk is ready: ${app.url}\nModel: ${config.model} | Context: ${config.contextTokens}\nWorkspace: ${config.workspace}\nPress Ctrl+C to stop.`);
    process.on('SIGINT',()=>void app.close());process.on('SIGTERM',()=>void app.close());
  }else if(command==='run'||command==='chat'){
    await ensureOllama(config);
    const mcp=new McpManager(config);await mcp.boot();const conversations=new Conversations(config);
    const agent=new Agent(config,store,{services:{mcp,conversations},onEvent:(_id,e)=>{if(e.type==='tool_call')console.log(`  > ${e.role}: ${e.tool}`);if(e.type==='tool_result'&&!e.ok)console.log(`  ! ${JSON.stringify(e.result)}`);}});
    let controller=new AbortController();process.on('SIGINT',()=>controller.abort());
    if(command==='run'){
      if(!args.length)throw Error('Usage: node src/cli.mjs run "Your task"');
      const task=await store.newTask(args.join(' '),'cli',{mode:'work'});const result=await agent.run(task,{signal:controller.signal});console.log(`\n${result.result}\n[${result.status}] Task ${result.id}`);if(result.status!=='completed')process.exitCode=1;
    }else{
      const rl=readline.createInterface({input:stdin,output:stdout});console.log('LocalDesk. /chat and /work switch modes. /exit, /tasks, /memory, /doctor. Ctrl+C cancels.');
      const thread=await conversations.create('Terminal conversation');const session=thread.id;let mode='chat';
      for(;;){let line;try{line=await rl.question('\nYou > ');}catch{break;}if(!line.trim())continue;if(line==='/exit')break;
        if(line==='/tasks'){console.log((await store.tasks(10)).map(t=>`${t.id} ${t.status}: ${t.goal}`).join('\n'));continue;}
        if(line==='/memory'){console.log(await store.allMemory());continue;}
        if(line==='/doctor'){console.log(await doctor(config));continue;}
        if(['/chat','/work'].includes(line)){mode=line.slice(1);console.log('Mode: '+mode);continue;}
        const turn=await conversations.addTurn(session,line,{mode});controller=new AbortController();const task=await store.newTask(line,session,{mode,conversationId:session,userMessageId:turn.user.id,assistantMessageId:turn.assistant.id});await conversations.updateMessage(session,turn.assistant.id,{taskId:task.id});const result=await agent.run(task,{signal:controller.signal});await conversations.updateMessage(session,turn.assistant.id,{content:result.result,status:result.status,citations:result.citations??[]});console.log(`\nLocalDesk > ${result.result}\n[${result.status}]`);
      }rl.close();
    }
    await mcp.close();
  }else if(command==='stop'){
    const saved=await readJSON(path.join(config.data,'server.json'),null);if(!saved)throw Error('No saved server instance');
    const r=await fetch(`http://127.0.0.1:${saved.port}/api/shutdown`,{method:'POST',headers:{'Content-Type':'application/json','X-LocalDesk-Token':saved.token},body:'{}',signal:AbortSignal.timeout(5000)});if(!r.ok)throw Error('Server did not accept shutdown');console.log('LocalDesk is stopping. Ollama stays available.');
  }else if(command==='memory'){
    if(args[0]==='add')console.log(await store.remember(args.slice(1).join(' '),[],'cli-user','user'));
    else if(args[0]==='search')console.log(await store.memory(args.slice(1).join(' ')));
    else if(args[0]==='forget'){await store.forget(args[1]);console.log('Memory removed.');}
    else console.log(await store.allMemory());
  }else if(command==='tasks')console.log((await store.tasks(20)).map(t=>`${t.id} [${t.status}] ${t.goal}`).join('\n'));
  else if(command==='export'){
    const task=await store.getTask(args[0]);if(!task)throw Error('Task not found');console.log(JSON.stringify({task,events:await store.events(task.id,1000)},null,2));
  }else if(command==='help'||command==='--help')console.log('LocalDesk: serve | stop | chat | run "task" | doctor | tasks | memory [add|search|forget] | export TASK_ID');
  else throw Error('Unknown command. Run: node src/cli.mjs help');
}catch(e){console.error(e.message);process.exitCode=1;}
