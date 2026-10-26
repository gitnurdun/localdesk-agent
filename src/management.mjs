import fs from 'node:fs/promises';
import path from 'node:path';
import {Policy} from './policy.mjs';
import {createToolContext,runTool} from './tools.mjs';
import {knowledgeSources,retrieve,removeKnowledge} from './retrieval.mjs';
import {id,writeJSON} from './util.mjs';

export async function management({route,method,body,config,store,skills,mcp}){
  const result=(data,status=200)=>({data,status});
  if(route==='/api/memory'){
    if(method==='GET')return result(await store.allMemory());
    if(method==='POST'){if(typeof body.text!=='string'||!body.text.trim()||body.text.length>2000)throw Error('Memory must be 1..2000 characters');return result(await store.remember(body.text,[],'dashboard-user','user'),201);}
    if(method==='DELETE'){await store.forget(body.id);return result({deleted:true});}
  }
  if(route==='/api/knowledge'&&method==='GET')return result(await knowledgeSources(config));
  if(route==='/api/knowledge'&&method==='DELETE'){await removeKnowledge(config,body.path);return result({removed:true});}
  if(route==='/api/knowledge/search'&&method==='POST')return result(await retrieve(config,body.query));
  if(route==='/api/knowledge/index'&&method==='POST'){
    const task=await store.newTask('Index '+body.path,'knowledge-panel',{mode:'work'});try{const r=await runTool('knowledge_index',{path:body.path},createToolContext(config,store,task,new AbortController().signal));task.status='completed';task.result=JSON.stringify(r);await store.saveTask(task);return result(r);}catch(e){task.status='failed';task.result=e.message;await store.saveTask(task);throw e;}
  }
  if(route==='/api/skills'&&method==='GET')return result(await skills.list());
  if(route.startsWith('/api/skills/')&&method==='GET')return result(await skills.get(route.split('/').at(-1)));
  if(route==='/api/skills'&&method==='POST')return result(await skills.save(body),201);
  if(route==='/api/mcp'&&method==='GET')return result(await mcp.list());
  if(route==='/api/mcp'&&method==='POST')return result(await mcp.save({...body,enabled:false}),201);
  if(route==='/api/mcp'&&method==='DELETE'){await mcp.remove(body.id);return result({removed:true});}
  if(route==='/api/mcp/connect'&&method==='POST')return result(await mcp.setEnabled(body.id,true));
  if(route==='/api/mcp/disconnect'&&method==='POST'){await mcp.setEnabled(body.id,false);return result({disconnected:true});}
  if(route==='/api/mcp/demo'&&method==='POST'){const cfg={id:'localdesk-demo',name:'Local clock example',transport:'stdio',command:process.execPath,args:[path.join(config.app,'extensions','mcp','localdesk-info.mjs')],allowedTools:['local_clock'],writeTools:[],enabled:false};await mcp.save(cfg);return result(await mcp.setEnabled(cfg.id,true),201);}
  if(route==='/api/settings'&&method==='GET')return result({webSearch:config.webSearch,contextTokens:config.contextTokens,workspace:config.workspace,readRoots:config.readRoots,writeRoots:config.writeRoots});
  if(route==='/api/settings/web'&&method==='POST'){
    if(!['duckduckgo','searxng'].includes(body.provider)||typeof body.enabled!=='boolean')throw Error('Invalid search settings');
    if(body.provider==='searxng'){const u=new URL(body.url);if(u.username||u.password||!['http:','https:'].includes(u.protocol)||u.protocol==='http:'&&!['localhost','127.0.0.1','[::1]'].includes(u.hostname))throw Error('Remote search endpoints must use HTTPS');}
    config.webSearch={enabled:body.enabled,provider:body.provider,url:body.url??''};await writeJSON(path.join(config.data,'integrations','web.json'),config.webSearch);return result(config.webSearch);
  }
  if(route==='/api/upload'&&method==='POST'){
    if(typeof body.name!=='string'||typeof body.base64!=='string'||body.base64.length>7*1024*1024||!/^[A-Za-z0-9+/=\s]*$/.test(body.base64))throw Error('Invalid upload');
    const name=path.basename(body.name).replace(/[^\p{L}\p{N}_. -]/gu,'_').slice(0,120)||'attachment.txt';const file=await new Policy(config).resolve(path.join('uploads',id()+'-'+name),'write');const bytes=Buffer.from(body.base64,'base64');if(bytes.length>5*1024*1024)throw Error('Upload limit is 5 MB');await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,bytes,{flag:'wx'});return result({path:file,name,bytes:bytes.length},201);
  }
}
