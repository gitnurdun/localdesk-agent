import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {readJSON,writeJSON,clip,hash,validate} from './util.mjs';
import {rank} from './store.mjs';
import {toolPermitted} from './scope.mjs';

const VERSION='2025-06-18';
export function checkMcpConfig(input){
  if(!/^[a-z][a-z0-9-]{0,39}$/.test(input.id??''))throw Error('MCP ID must be lowercase letters, numbers and hyphens');
  if(!['stdio','http'].includes(input.transport))throw Error('MCP transport must be stdio or http');
  const cfg={id:input.id,name:clip(input.name??input.id,80),transport:input.transport,enabled:input.enabled===true,allowedTools:(input.allowedTools??[]).slice(0,100),writeTools:(input.writeTools??[]).slice(0,100)};
  if(!cfg.allowedTools.every(x=>typeof x==='string')||!cfg.writeTools.every(x=>typeof x==='string'))throw Error('Tool permissions must be arrays of names');
  if(input.transport==='stdio'){
    if(!path.isAbsolute(input.command??'')||/\.(cmd|bat)$/i.test(input.command))throw Error('Use an absolute executable path, not npx/npm or a shell script');
    if(!Array.isArray(input.args??[])||!(input.args??[]).every(a=>typeof a==='string'&&!a.includes('\0'))||(input.args??[]).length>30)throw Error('Invalid MCP arguments');
    cfg.command=input.command;cfg.args=input.args??[];
    cfg.env={};for(const [k,v] of Object.entries(input.env??{})){if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)||typeof v!=='string'||v.length>4000)throw Error('Invalid MCP environment');cfg.env[k]=v;}
  }else{
    const u=new URL(input.url);if(u.username||u.password||!['https:','http:'].includes(u.protocol)||(u.protocol==='http:'&&!['127.0.0.1','localhost','[::1]'].includes(u.hostname)))throw Error('MCP HTTP endpoint must use HTTPS or localhost HTTP');
    cfg.url=u.href;cfg.headers={};for(const [k,v] of Object.entries(input.headers??{})){if(!/^[A-Za-z0-9-]+$/.test(k)||typeof v!=='string'||/[\r\n]/.test(v))throw Error('Invalid MCP header');cfg.headers[k]=v;}
  }return cfg;
}

export class McpClient {
  constructor(config,workspace){this.config=config;this.workspace=workspace;this.pending=new Map();this.sequence=0;this.tools=[];this.connected=false;this.session=null;this.logs='';}
  async connect(){
    if(this.config.transport==='stdio'){
      if(!(await fs.stat(this.config.command)).isFile())throw Error('MCP executable not found');
      this.child=spawn(this.config.command,this.config.args,{shell:false,windowsHide:true,cwd:this.workspace,stdio:['pipe','pipe','pipe'],env:{...process.env,...this.config.env}});
      this.child.stdout.setEncoding('utf8');this.child.stderr.setEncoding('utf8');let buffer='';
      this.child.stdout.on('data',text=>{buffer+=text;if(Buffer.byteLength(buffer)>2*1024*1024){this.fail(Error('MCP stdout limit exceeded'));void this.close();return;}const lines=buffer.split('\n');buffer=lines.pop();for(const line of lines){if(!line.trim())continue;try{this.handle(JSON.parse(line));}catch(e){this.fail(Error('MCP returned invalid JSON-RPC: '+e.message));}}});
      this.child.stderr.on('data',text=>{this.logs=clip(this.logs+text,2000);});
      this.child.on('error',e=>this.fail(e));this.child.on('close',()=>{this.connected=false;this.fail(Error('MCP process exited'));});this.child.stdin.on('error',e=>this.fail(e));
    }
    try{
      const init=await this.request('initialize',{protocolVersion:VERSION,capabilities:{roots:{listChanged:false}},clientInfo:{name:'LocalDesk',version:'0.2.0'}});
      if(init.protocolVersion!==VERSION&&init.protocolVersion!=='2025-03-26')throw Error('Unsupported MCP protocol version: '+init.protocolVersion);
      this.version=init.protocolVersion;this.serverInfo=init.serverInfo;this.capabilities=init.capabilities??{};await this.notify('notifications/initialized');this.connected=true;
      await this.refreshTools();return this;
    }catch(e){await this.close();throw e;}
  }
  fail(error){for(const p of this.pending.values())p.reject(error);this.pending.clear();}
  handle(message){
    if(message.method&&message.id!==undefined){
      let reply;if(message.method==='ping')reply={result:{}};
      else if(message.method==='roots/list')reply={result:{roots:[{uri:pathToFileURL(this.workspace).href,name:'LocalDesk workspace'}]}};
      else reply={error:{code:-32601,message:'LocalDesk does not support server-initiated '+message.method}};
      if(this.child)this.child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:message.id,...reply})+'\n');else void this.httpMessage({jsonrpc:'2.0',id:message.id,...reply}).catch(()=>{});return;
    }
    if(message.id!==undefined){const pending=this.pending.get(message.id);if(pending){this.pending.delete(message.id);message.error?pending.reject(Error(message.error.message??'MCP error')):pending.resolve(message.result);}}
    if(message.method==='notifications/tools/list_changed'&&this.connected)void this.refreshTools().catch(e=>this.logs=clip(e.message,2000));
  }
  async httpMessage(message,signal){
    const headers={...this.config.headers,'Content-Type':'application/json','Accept':'application/json, text/event-stream'};
    if(this.session)headers['Mcp-Session-Id']=this.session;if(this.version)headers['MCP-Protocol-Version']=this.version;
    const timeout=AbortSignal.timeout(30000);const response=await fetch(this.config.url,{method:'POST',headers,body:JSON.stringify(message),redirect:'error',signal:signal?AbortSignal.any([signal,timeout]):timeout});
    if(!response.ok)throw Error(`MCP HTTP ${response.status}${response.status===404&&this.session?' (session expired; reconnect in Integrations)':''}`);
    if(response.headers.get('Mcp-Session-Id'))this.session=response.headers.get('Mcp-Session-Id');
    if(response.status===202||message.id===undefined){await response.body?.cancel();return {};}
    const reader=response.body.getReader();const decoder=new TextDecoder();let buf='',bytes=0;
    try{for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>2*1024*1024)throw Error('MCP response limit exceeded');buf+=decoder.decode(value,{stream:true});
      if((response.headers.get('content-type')??'').includes('text/event-stream')){
        const blocks=buf.replaceAll('\r\n','\n').split('\n\n');buf=blocks.pop();
        for(const block of blocks){const data=block.split('\n').filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trimStart()).join('\n');if(!data)continue;const m=JSON.parse(data);if(m.id===message.id&&!m.method){if(m.error)throw Error(m.error.message);return m.result;}this.handle(m);}
      }
    }
    const m=JSON.parse(buf);if(m.id!==message.id)throw Error('MCP response ID mismatch');if(m.error)throw Error(m.error.message);return m.result;
    }finally{await reader.cancel().catch(()=>{});}
  }
  async notify(method,params={}){const message={jsonrpc:'2.0',method,params};if(this.child)this.child.stdin.write(JSON.stringify(message)+'\n');else await this.httpMessage(message);}
  async request(method,params={},signal){
    const requestId=++this.sequence;const message={jsonrpc:'2.0',id:requestId,method,params};
    if(!this.child)return this.httpMessage(message,signal);
    if(signal?.aborted)throw Error('MCP request cancelled');
    return new Promise((resolve,reject)=>{
      const finish=fn=>v=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);this.pending.delete(requestId);fn(v);};
      const abort=()=>{void this.notify('notifications/cancelled',{requestId,reason:'Cancelled'}).catch(()=>{});finish(reject)(Error('MCP request cancelled'));};
      const timer=setTimeout(()=>{void this.notify('notifications/cancelled',{requestId,reason:'Timed out'}).catch(()=>{});finish(reject)(Error('MCP request timed out'));},30000);
      this.pending.set(requestId,{resolve:finish(resolve),reject:finish(reject)});signal?.addEventListener('abort',abort,{once:true});
      this.child.stdin.write(JSON.stringify(message)+'\n',e=>{if(e)finish(reject)(e);});
    });
  }
  async refreshTools(){
    if(!this.capabilities?.tools){this.tools=[];return;}
    const tools=[];let cursor;for(let page=0;page<5;page++){const r=await this.request('tools/list',cursor?{cursor}:{});for(const t of r.tools??[]){if(typeof t.name==='string'&&typeof t.inputSchema==='object')tools.push(t);}cursor=r.nextCursor;if(!cursor)break;}
    this.tools=tools.slice(0,100);
  }
  async close(){
    this.connected=false;this.fail(Error('MCP disconnected'));
    if(this.child){const child=this.child;child.stdin.end();await new Promise(resolve=>{if(child.exitCode!==null)return resolve();const timer=setTimeout(()=>{if(child.exitCode===null){if(process.platform==='win32'){const k=spawn('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});k.on('error',()=>child.kill());}else child.kill('SIGKILL');}resolve();},800);child.once('close',()=>{clearTimeout(timer);resolve();});});this.child=null;}
    else if(this.session){await fetch(this.config.url,{method:'DELETE',headers:{...this.config.headers,'Mcp-Session-Id':this.session,'MCP-Protocol-Version':this.version??VERSION},redirect:'error',signal:AbortSignal.timeout(3000)}).catch(()=>{});this.session=null;}
  }
}

export class McpManager {
  constructor(config){this.config=config;this.file=path.join(config.data,'integrations','mcp.json');this.clients=new Map();this.errors=new Map();}
  async configs(){return readJSON(this.file,[]);}
  async save(input){const cfg=checkMcpConfig(input);const rows=await this.configs();if(rows.length>=10&&!rows.some(r=>r.id===cfg.id))throw Error('Maximum 10 MCP connections');const at=rows.findIndex(r=>r.id===cfg.id);if(at<0)rows.push(cfg);else rows[at]=cfg;await writeJSON(this.file,rows);return cfg;}
  async connect(id){const cfg=(await this.configs()).find(c=>c.id===id);if(!cfg)throw Error('MCP connection not configured');await this.disconnect(id);try{const client=await new McpClient(cfg,this.config.workspace).connect();this.clients.set(id,client);this.errors.delete(id);return this.status(id,cfg);}catch(e){this.errors.set(id,e.message);throw e;}}
  async disconnect(id){const c=this.clients.get(id);if(c)await c.close();this.clients.delete(id);}
  status(id,cfg){const client=this.clients.get(id);return {id,name:cfg.name,transport:cfg.transport,enabled:cfg.enabled,command:cfg.command,args:cfg.args,url:cfg.url,allowedTools:cfg.allowedTools,writeTools:cfg.writeTools,connected:client?.connected??false,error:this.errors.get(id)??null,tools:(client?.tools??[]).map(t=>({name:t.name,description:clip(t.description??'',250),inputSchema:t.inputSchema,allowed:cfg.allowedTools.includes('*')||cfg.allowedTools.includes(t.name)}))};}
  async list(){return (await this.configs()).map(c=>this.status(c.id,c));}
  async boot(){for(const c of await this.configs())if(c.enabled)await this.connect(c.id).catch(()=>{});}
  async remove(id){await this.disconnect(id);await writeJSON(this.file,(await this.configs()).filter(c=>c.id!==id));}
  async setEnabled(id,enabled){const c=(await this.configs()).find(c=>c.id===id);if(!c)throw Error('MCP not found');await this.save({...c,enabled});if(enabled)return this.connect(id);await this.disconnect(id);return this.status(id,c);}
  catalog(){
    const rows=[];for(const [serverId,client] of this.clients){if(!client.connected)continue;const cfg=client.config;for(const tool of client.tools){if(!cfg.allowedTools.includes('*')&&!cfg.allowedTools.includes(tool.name))continue;if(JSON.stringify(tool.inputSchema).length>6000)continue;rows.push({serverId,originalName:tool.name,name:`mcp_${serverId.replaceAll('-','_')}_${tool.name.replace(/[^a-zA-Z0-9_]/g,'_').slice(0,35)}_${hash(tool.name).slice(0,4)}`,description:clip(tool.description??tool.name,180),schema:tool.inputSchema,group:'mcp',effect:cfg.writeTools.includes(tool.name)?'write':'read',client});}}
    return rows;
  }
  select(query,limit=3){const rows=this.catalog();const scored=rank(rows.map(r=>({...r,text:r.originalName+' '+r.description+' '+r.serverId})),query,limit);return scored.length?scored:rows.slice(0,limit);}
  definitions(query,mode='work'){
    return this.select(query).map(r=>({...r,run:async(ctx,args)=>{if(mode!=='work')throw Error('MCP tools execute in Work mode');if(r.effect==='write'&&!toolPermitted('files_write',{},ctx.task.goal))throw Error('This MCP tool is marked as a write; the original request does not authorize writes');validate(r.schema,args);const result=await r.client.request('tools/call',{name:r.originalName,arguments:args},ctx.signal);if(result.isError)throw Error(clip(JSON.stringify(result.content),1200));return {server:r.serverId,tool:r.originalName,content:result.content,structuredContent:result.structuredContent};}}));
  }
  async close(){await Promise.all([...this.clients.keys()].map(id=>this.disconnect(id)));}
}
