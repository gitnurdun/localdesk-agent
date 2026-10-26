import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Policy } from './policy.mjs';
import { findExe,runProcess } from './process.mjs';
import { str,int,choice,obj,list,validate,clip,hash,readJSON,writeJSON } from './util.mjs';
import { readText,walk,writeText,listFiles,searchFiles,textExtensions } from './files.mjs';
import { rank } from './store.mjs';
import { toolPermitted } from './scope.mjs';
import { webSearch,fetchPage,stripHTML } from './web.mjs';

export const definitions={};
function define(name,group,description,schema,run){definitions[name]={name,group,description,schema,run};}
const filePath=str('Path relative to workspace, or absolute inside configured roots',2048);
const shellSafe=p=>p.replaceAll('\\','/');
async function execute(ctx,program,args,options={}){
  const exe=await findExe(program);if(!exe)throw Error(`${program} is not installed or not discoverable. No installation was attempted.`);
  return runProcess(exe,args,{cwd:ctx.config.workspace,signal:ctx.signal,...options});
}
async function outputTarget(ctx,p){
  const target=await ctx.policy.resolve(p,'write');
  try{await fs.stat(target);throw Error('Output exists. Choose a new name to preserve the original.');}catch(e){if(e.code!=='ENOENT')throw e;}
  await fs.mkdir(path.dirname(target),{recursive:true});return target;
}
function checkedProcess(r){if(r.exitCode!==0||r.timedOut||r.cancelled)throw Error(clip(r.stderr||r.stdout||'Command failed or timed out',2000));return r;}
async function extractDocument(ctx,file){
  if(path.extname(file).toLowerCase()==='.pdf')return checkedProcess(await execute(ctx,'pdftotext',['-layout',file,'-'],{maxBytes:100000})).stdout;
  if(textExtensions.has(path.extname(file).toLowerCase()))return readText(file);
  if(!['.docx','.odt','.epub','.rtf'].includes(path.extname(file).toLowerCase()))throw Error('Supported: text, PDF (pdftotext), DOCX, ODT, EPUB, RTF.');
  return checkedProcess(await execute(ctx,'pandoc',['--sandbox',file,'-t','plain','--wrap=none'],{maxBytes:100000})).stdout;
}

define('files_list','files','List a folder (up to 200 entries).',obj({path:filePath},[]),listFiles);
define('files_read','files','Read the first 80 lines of a text file. Only supply path.',obj({path:filePath}),async(ctx,a)=>{
  const p=await ctx.policy.resolve(a.path);const text=await readText(p);const lines=text.split(/\r?\n/);
  return {content:clip(lines.slice(0,80).join('\n'),7000),totalLines:lines.length,more:lines.length>80,path:p,sha256:hash(text)};
});
define('files_page','files','Read later lines of a long file after files_read says more=true.',obj({path:filePath,startLine:int(1,1000000),lines:int(1,100)},['path','startLine']),async(ctx,a)=>{
  const p=await ctx.policy.resolve(a.path);const text=await readText(p);const lines=text.split(/\r?\n/);const start=(a.startLine??1)-1;
  return {content:clip(lines.slice(start,start+(a.lines??60)).join('\n'),7000),startLine:start+1,totalLines:lines.length,path:p,sha256:hash(text)};
});
define('files_search','files','Find literal text in files; returns paths, lines, snippets.',obj({query:str('Literal text',300),path:filePath},['query']),searchFiles);
define('files_write','files','Create a NEW text file. For existing files use files_replace.',obj({path:filePath,content:str('Exact new file content',20000)}),async(ctx,a)=>writeText(ctx,a.path,a.content));
define('files_replace','files','Replace one exact occurrence; fails if missing or ambiguous.',obj({path:filePath,oldText:str('',10000),newText:str('',10000)}),async(ctx,a)=>{
  if(a.oldText===a.newText)throw Error('No change requested: oldText and newText are identical. If the previous edit succeeded, read it to verify and finish.');
  if(!a.oldText)throw Error('oldText cannot be empty');const p=await ctx.policy.resolve(a.path,'write');const text=await readText(p);
  if(text.split(a.oldText).length!==2)throw Error('oldText must match exactly once. Read the file and refine the selection.');
  return writeText(ctx,a.path,text.replace(a.oldText,()=>a.newText));
});
define('files_copy','files','Copy a file to a new destination; never overwrite.',obj({source:filePath,destination:filePath}),async(ctx,a)=>{
  const src=await ctx.policy.resolve(a.source);const dest=await outputTarget(ctx,a.destination);
  if((await fs.stat(src)).size>100*1024*1024)throw Error('Copy limit is 100 MB');
  await fs.copyFile(src,dest,fs.constants.COPYFILE_EXCL);return {source:src,destination:dest,bytes:(await fs.stat(dest)).size};
});
define('files_trash','files','Recoverably remove ONE file in writable roots; returns backup ID.',obj({path:filePath}),async(ctx,a)=>{
  const p=await ctx.policy.resolve(a.path,'write');const backupId=await ctx.store.backup(p);if(!backupId)throw Error('File does not exist');
  await fs.unlink(p);return {removed:p,backupId,recoverable:true};
});
define('files_restore','files','Restore a backup by ID; backs up the current version first.',obj({backupId:str('',36)}),async(ctx,a)=>{
  if(!/^[0-9a-f-]{36}$/.test(a.backupId))throw Error('Invalid backup ID');
  const meta=await readJSON(path.join(ctx.config.data,'backups',a.backupId+'.json'),null);if(!meta)throw Error('Backup not found');
  const p=await ctx.policy.resolve(meta.original,'write');const undo=await ctx.store.backup(p);await fs.mkdir(path.dirname(p),{recursive:true});
  await fs.copyFile(path.join(ctx.config.data,'backups',a.backupId+'.bin'),p);return {restored:p,undoBackupId:undo};
});
define('memory_search','common','Retrieve relevant long-term notes and prior tasks.',obj({query:str('',500)}),async(ctx,a)=>ctx.store.memory(a.query));
define('memory_store','common','Save an explicitly useful fact or preference with provenance.',obj({text:str('',2000),tags:list(str('',50),8)},['text']),async(ctx,a)=>ctx.store.remember(a.text,a.tags??[],ctx.task.id,'agent-note-unverified'));
define('task_plan','common','Save concise steps for a multi-step task; preserve evidence.',obj({steps:list(obj({text:str('',160),status:choice('todo','doing','done')}),12)}),async(ctx,a)=>{
  ctx.task.plan=a.steps;await ctx.store.saveTask(ctx.task);return {saved:true,steps:a.steps};
});
define('task_read','common','Read the full original request or earlier tool evidence in pages.',obj({section:choice('goal','events'),offset:int(0,1000000)},['section']),async(ctx,a)=>{
  const text=a.section==='goal'?ctx.task.goal:JSON.stringify(await ctx.store.events(ctx.task.id,150));const offset=a.offset??0;
  return {totalCharacters:text.length,offset,text:text.slice(offset,offset+3500),more:offset+3500<text.length};
});
define('calculate','common','Accurate arithmetic or statistics; JavaScript never evaluates code.',obj({operation:choice('sum','mean','min','max','product','percentage'),numbers:list({type:'number'},1000)}),async(ctx,a)=>{
  if(!a.numbers.length||!a.numbers.every(Number.isFinite))throw Error('Use a nonempty finite number array');
  const n=a.numbers;const v={sum:()=>n.reduce((x,y)=>x+y,0),mean:()=>n.reduce((x,y)=>x+y,0)/n.length,min:()=>Math.min(...n),max:()=>Math.max(...n),product:()=>n.reduce((x,y)=>x*y,1),percentage:()=>{if(n.length!==2||n[1]===0)throw Error('percentage requires [part, nonzero whole]');return n[0]/n[1]*100;}}[a.operation]();
  if(!Number.isFinite(v))throw Error('Result exceeds finite range');return {result:v};
});
define('system_info','system','Inspect CPU, RAM, OS, uptime and workspace disk space.',obj({}),async(ctx)=>{
  const disk=await fs.statfs(ctx.config.workspace);return {platform:os.platform(),release:os.release(),architecture:os.arch(),cpu:os.cpus()[0]?.model,logicalCPUs:os.cpus().length,totalRAMGB:+(os.totalmem()/2**30).toFixed(2),freeRAMGB:+(os.freemem()/2**30).toFixed(2),uptimeHours:+(os.uptime()/3600).toFixed(1),workspace:ctx.config.workspace,diskFreeGB:+(disk.bavail*disk.bsize/2**30).toFixed(2)};
});
define('gpu_info','system','Inspect NVIDIA GPU memory, load and temperature.',obj({}),async(ctx)=>{const r=await execute(ctx,'nvidia-smi',['--query-gpu=name,memory.total,memory.used,utilization.gpu,temperature.gpu','--format=csv,noheader,nounits']);return {...r,devices:r.stdout.trim().split(/\r?\n/).filter(Boolean).map(line=>{const [name,total,used,load,temp]=line.split(',').map(s=>s.trim());const number=v=>Number.isFinite(Number(v))?Number(v):null;return {name,memoryTotalMiB:number(total),memoryUsedMiB:number(used),utilizationPercent:number(load),temperatureC:number(temp)};})};});
define('process_list','system','List the 25 processes using most working memory.',obj({}),async(ctx)=>{
  if(process.platform!=='win32')return execute(ctx,'ps',['-eo','pid,comm,rss','--sort=-rss']);
  return execute(ctx,'powershell',['-NoProfile','-NonInteractive','-Command','Get-Process | Sort-Object WorkingSet64 -Descending | Select-Object -First 25 ProcessName,Id,@{n="MemoryMB";e={[math]::Round($_.WorkingSet64/1MB)}} | ConvertTo-Json -Compress']);
});
define('software_list','system','List registered Windows applications (no serials or keys).',obj({}),async(ctx)=>{
  if(process.platform!=='win32')throw Error('Software registry inspection is Windows only');
  return execute(ctx,'powershell',['-NoProfile','-NonInteractive','-Command',"Get-ItemProperty 'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' -ErrorAction SilentlyContinue | Where-Object DisplayName | Select-Object DisplayName,DisplayVersion | Sort-Object DisplayName -Unique | ConvertTo-Json -Compress"],{maxBytes:30000});
});
define('cli_inventory','system','Find installed tools, including Git Bash, qpdf, Pandoc and Python.',obj({}),async()=>{
  const names=['git','bash','qpdf','pandoc','pdftotext','node','python','ffmpeg','rg','ollama','docker'];return Object.fromEntries(await Promise.all(names.map(async n=>[n,await findExe(n)])));
});
define('document_read','documents','Extract text from PDF/DOCX/ODT/EPUB/RTF or text; paginated.',obj({path:filePath,offset:int(0,10000000)},['path']),async(ctx,a)=>{
  const p=await ctx.policy.resolve(a.path);const text=await extractDocument(ctx,p);const offset=a.offset??0;return {path:p,totalCharacters:text.length,offset,text:text.slice(offset,offset+5000),more:offset+5000<text.length};
});
define('document_convert','documents','Convert local documents with Pandoc; no PDF output or plugins.',obj({source:filePath,destination:filePath,format:choice('markdown','plain','html','docx','odt','rtf','latex')}),async(ctx,a)=>{
  const src=await ctx.policy.resolve(a.source);const dest=await outputTarget(ctx,a.destination);
  if(!['.md','.txt','.html','.docx','.odt','.rtf','.tex','.rst'].includes(path.extname(src).toLowerCase()))throw Error('Input format is not supported');
  const r=checkedProcess(await execute(ctx,'pandoc',['--sandbox',src,'-t',a.format,'-o',dest],{timeoutMs:40000}));
  return {path:dest,bytes:(await fs.stat(dest)).size,stderr:r.stderr,verified:true};
});
define('pdf_info','documents','Check PDF validity and count pages with qpdf.',obj({path:filePath}),async(ctx,a)=>{
  const p=await ctx.policy.resolve(a.path);const pages=await execute(ctx,'qpdf',['--show-npages',p]);const check=await execute(ctx,'qpdf',['--check',p]);return {pages:pages.stdout.trim(),pageExitCode:pages.exitCode,check};
});
define('pdf_extract','documents','Extract PDF pages, e.g. 1-3,5 or 1-z, to a new PDF.',obj({source:filePath,pages:str('',100),destination:filePath}),async(ctx,a)=>{
  if(!/^[0-9z,r-]+$/.test(a.pages))throw Error('Invalid page selection');
  const src=await ctx.policy.resolve(a.source);const dest=await outputTarget(ctx,a.destination);
  const r=await execute(ctx,'qpdf',[src,'--pages','.',a.pages,'--',dest]);if(![0,3].includes(r.exitCode))checkedProcess(r);
  return {path:dest,bytes:(await fs.stat(dest)).size,warning:r.stderr};
});
define('pdf_merge','documents','Merge a list of PDFs into a new PDF.',obj({sources:list(filePath,20),destination:filePath}),async(ctx,a)=>{
  if(a.sources.length<2)throw Error('Provide at least two PDFs');
  const src=await Promise.all(a.sources.map(p=>ctx.policy.resolve(p)));const dest=await outputTarget(ctx,a.destination);
  const r=await execute(ctx,'qpdf',['--empty','--pages',...src.flatMap(p=>[p,'1-z']),'--',dest]);if(![0,3].includes(r.exitCode))checkedProcess(r);
  return {path:dest,bytes:(await fs.stat(dest)).size,warning:r.stderr};
});
define('git_inspect','developer','Read Git status, log or diff. No Git writes or hooks.',obj({path:filePath,operation:choice('status','log','diff')}),async(ctx,a)=>{
  const p=await ctx.policy.resolve(a.path);const args={status:['status','--short'],log:['log','-8','--format=%h %s'],diff:['diff','--no-ext-diff','--no-textconv','--stat']}[a.operation];
  return execute(ctx,'git',['-c','core.fsmonitor=false','-c','core.hooksPath=',...args],{cwd:p});
});
define('bash_text','developer','Use Git Bash utilities on a file: wc, sort, head, tail, sha256sum.',obj({path:filePath,operation:choice('count','sort','head','tail','sha256'),lines:int(1,200)},['path','operation']),async(ctx,a)=>{
  const p=shellSafe(await ctx.policy.resolve(a.path));
  const [program,...args]={count:['wc','-lwm','--',p],sort:['sort','--',p],head:['head','-n',String(a.lines??30),'--',p],tail:['tail','-n',String(a.lines??30),'--',p],sha256:['sha256sum','--',p]}[a.operation];
  // Fixed script. Every model-derived value is a positional argument, never shell source.
  return execute(ctx,'bash',['--noprofile','--norc','-c','exec "$@"','localdesk',program,...args]);
});
define('recipe_list','developer','List owner-configured additional executable recipes.',obj({}),async(ctx)=>Object.entries(ctx.config.recipes).map(([name,r])=>({name,description:r.description,inputs:r.inputs??[]})));
define('recipe_run','developer','Run an owner-configured recipe; fixed executable and arguments.',obj({name:str('',80),inputs:list(str('',2048),10)},['name']),async(ctx,a)=>{
  const r=ctx.config.recipes[a.name];if(!r)throw Error('Unknown recipe. Owner must configure it in config.json.');
  const values=a.inputs??[];if(values.length!==(r.inputs??[]).length)throw Error('Wrong input count');
  const checked=[];for(let i=0;i<values.length;i++){
    const kind=r.inputs[i];if(kind==='readPath'||kind==='writePath')checked.push(await ctx.policy.resolve(values[i],kind==='readPath'?'read':'write'));
    else if(kind==='text'&&!values[i].includes('\0'))checked.push(values[i]);else throw Error('Invalid recipe input type');
  }
  if(!path.isAbsolute(r.executable))throw Error('Recipe executable must be an absolute owner-configured path');
  const args=(r.args??[]).map(v=>v.replace(/\{(\d+)\}/g,(_,i)=>{if(checked[i]===undefined)throw Error('Missing recipe input');return checked[i];}));
  return runProcess(r.executable,args,{cwd:ctx.config.workspace,signal:ctx.signal,timeoutMs:Math.min(r.timeoutMs??20000,60000)});
});
define('knowledge_index','research','Index text/document chunks locally for search; no embedding model.',obj({path:filePath}),async(ctx,a)=>{
  const indexFile=path.join(ctx.config.data,'memory','knowledge.json');const records=await readJSON(indexFile,[]);const root=await ctx.policy.resolve(a.path);
  const stat=await fs.stat(root);const files=[];if(stat.isFile())files.push(root);else for await(const f of walk(ctx.policy,root,150))files.push(f);
  let indexed=0,skipped=0;let next=records;let chunks=0;
  for(const file of files){
    ctx.signal?.throwIfAborted();let text;
    try{if((await fs.stat(file)).size>2*1024*1024){skipped++;continue;}text=await extractDocument(ctx,file);}catch{skipped++;continue;}
    next=next.filter(r=>r.path!==file);const fingerprint=hash(text);
    for(let i=0;i<Math.min(text.length,100000);i+=1000){next.push({path:file,offset:i,text:text.slice(i,i+1200),hash:fingerprint,indexedAt:new Date().toISOString(),trust:'document-data'});chunks++;}
    indexed++;
  }
  await writeJSON(indexFile,next.slice(-10000));return {indexed,skipped,chunks,totalChunks:Math.min(next.length,10000),note:'Text snapshots. Reindex after changing source documents.'};
});
define('knowledge_search','research','Retrieve relevant indexed document snippets with file citations.',obj({query:str('',500)}),async(ctx,a)=>{
  const records=await readJSON(path.join(ctx.config.data,'memory','knowledge.json'),[]);const matches=rank(records,a.query,5);const allowed=[];
  for(const m of matches){try{await ctx.policy.resolve(m.path);allowed.push(m);}catch{}}
  return allowed;
});
define('web_fetch','research','Fetch text from an HTTPS host explicitly allowed in config.fetchHosts.',obj({url:str('',2000)}),async(ctx,a)=>{
  const u=new URL(a.url);if(u.protocol!=='https:'||u.username||u.password||u.port||!ctx.config.fetchHosts.includes(u.hostname))throw Error('Host not enabled in config.fetchHosts. Offline is the default.');
  const r=await fetch(u,{redirect:'error',signal:AbortSignal.any([ctx.signal??new AbortController().signal,AbortSignal.timeout(15000)])});
  if(!r.ok)throw Error(`HTTP ${r.status}`);const type=r.headers.get('content-type')??'';if(!/text|json|xml/.test(type))throw Error('Only text responses supported');
  let bytes=0;const chunks=[];for await(const b of r.body){bytes+=b.length;if(bytes>100000)break;chunks.push(b);}
  const text=Buffer.concat(chunks).toString('utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,'').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ');
  return {url:u.href,text:clip(text,6000),trust:'untrusted-web-data'};
});

define('folder_scan','organize','Find largest files and total size; bounded to 2,000 files.',obj({path:filePath}),async(ctx,a)=>{
  const rows=[];let bytes=0;
  for await(const file of walk(ctx.policy,a.path,2000)){ctx.signal?.throwIfAborted();try{const s=await fs.stat(file);bytes+=s.size;rows.push({path:file,bytes:s.size});}catch{}}
  return {filesScanned:rows.length,totalBytes:bytes,limitReached:rows.length===2000,largest:rows.sort((a,b)=>b.bytes-a.bytes).slice(0,20)};
});
define('duplicate_files','organize','Find identical files by SHA-256. Reports only; does not delete.',obj({path:filePath}),async(ctx,a)=>{
  const bySize=new Map();let scanned=0;
  for await(const file of walk(ctx.policy,a.path,500)){ctx.signal?.throwIfAborted();const s=await fs.stat(file);scanned++;if(s.size>20*1024*1024||s.size===0)continue;const group=bySize.get(s.size)??[];group.push(file);bySize.set(s.size,group);}
  const byHash=new Map();let bytesHashed=0;
  for(const candidates of bySize.values()){if(candidates.length<2)continue;for(const file of candidates){ctx.signal?.throwIfAborted();const buf=await fs.readFile(file);if(bytesHashed+buf.length>100*1024*1024)continue;bytesHashed+=buf.length;const h=hash(buf);const group=byHash.get(h)??[];group.push(file);byHash.set(h,group);}}
  return {scanned,bytesHashed,limits:'500 files; 20 MB each; 100 MB hashed total',duplicates:[...byHash].filter(([,files])=>files.length>1).map(([sha256,files])=>({sha256,files}))};
});
define('files_move','organize','Move/rename ONE file with backup; destination must be new.',obj({source:filePath,destination:filePath}),async(ctx,a)=>{
  const src=await ctx.policy.resolve(a.source,'write');const dest=await outputTarget(ctx,a.destination);const backupId=await ctx.store.backup(src);if(!backupId)throw Error('Source not found');
  await fs.copyFile(src,dest,fs.constants.COPYFILE_EXCL);const oldHash=hash(await fs.readFile(src));if(hash(await fs.readFile(dest))!==oldHash)throw Error('Copy verification failed; source preserved');
  await fs.unlink(src);return {source:src,path:dest,backupId,verified:true};
});
define('text_pipeline','developer','Transform file text with Git Bash: filter, exclude, sort, unique, head, tail, count.',obj({source:filePath,steps:list(obj({operation:choice('filter','exclude','sort','unique','head','tail','count'),value:str('Filter text or line count',300)},['operation']),8),destination:filePath},['source','steps']),async(ctx,a)=>{
  const source=await ctx.policy.resolve(a.source);let text=await readText(source,200000);
  for(const step of a.steps){
    const count=Number(step.value??20);if(['head','tail'].includes(step.operation)&&(!Number.isInteger(count)||count<1||count>1000))throw Error('Line count must be 1..1000');
    const [program,...args]={filter:['grep','-F','--',step.value??''],exclude:['grep','-F','-v','--',step.value??''],sort:['sort'],unique:['uniq'],head:['head','-n',String(count)],tail:['tail','-n',String(count)],count:['wc','-lwm']}[step.operation];
    const r=await execute(ctx,'bash',['--noprofile','--norc','-c','exec "$@"','localdesk',program,...args],{input:text,maxBytes:200000});
    if(r.truncated||r.timedOut||r.cancelled||!(r.exitCode===0||r.exitCode===1&&['filter','exclude'].includes(step.operation)))throw Error(r.stderr||'Pipeline step failed or exceeded its output limit');
    text=r.stdout;
  }
  const output=a.destination?await writeText(ctx,await outputTarget(ctx,a.destination),text):null;
  return {text:clip(text,5000),characters:text.length,...output};
});
define('system_health','system','Read disk health, Windows Defender status and battery charge.',obj({}),async(ctx)=>{
  if(process.platform!=='win32')throw Error('This health recipe is Windows only');
  return execute(ctx,'powershell',['-NoProfile','-NonInteractive','-Command',"$ErrorActionPreference='SilentlyContinue'; $d=Get-PhysicalDisk | Select-Object FriendlyName,HealthStatus,OperationalStatus; $m=Get-MpComputerStatus; $b=Get-CimInstance Win32_Battery; [pscustomobject]@{Disks=@($d);Defender=[pscustomobject]@{Enabled=$m.AntivirusEnabled;RealTimeProtection=$m.RealTimeProtectionEnabled;DefinitionsAgeDays=$m.AntivirusSignatureAge};BatteryPercent=$b.EstimatedChargeRemaining} | ConvertTo-Json -Depth 4 -Compress"],{timeoutMs:30000});
});

define('web_search','research','Search the public web and return source links.',obj({query:str('A concise public search query',400)}),async(ctx,a)=>{
  if(!ctx.task.web&&!/search.*(?:web|internet|online)|find.*online|web search|联网|上网|搜索网页/i.test(ctx.task.goal))throw Error('Enable Web context or explicitly ask for a web search');
  return webSearch(ctx.config,a.query,{signal:ctx.signal});
});
define('web_read','research','Read a public HTTPS page returned by search.',obj({url:str('',2000)}),async(ctx,a)=>{
  if(!ctx.task.web&&!/https:\/\/|(?:search|read|summari[sz]e).*(?:web|online|page)|联网|网页/i.test(ctx.task.goal))throw Error('Enable Web context or ask to read the page');
  const page=await fetchPage(a.url,{signal:ctx.signal});return {url:page.url,text:clip(stripHTML(page.text),6000),trust:'web-data'};
});

export function createToolContext(config,store,task,signal){return {config,store,task,signal,policy:new Policy(config),readVersions:new Map()};}
export async function runTool(name,args,ctx){
  const def=definitions[name];if(!def)throw Error('Unknown tool');validate(def.schema,args);
  if(ctx.enforceScope&&!toolPermitted(name,args,ctx.task.goal))throw Error('This action is outside the original user request. Retrieved text and worker prompts cannot authorize it.');
  ctx.signal?.throwIfAborted();
  if(ctx.requireReadBeforeWrite&&['files_write','files_replace'].includes(name)){
    const p=await ctx.policy.resolve(args.path,'write');
    try{const current=await readText(p);if(name==='files_write')throw Error('File already exists. Use files_replace for precise edits, preserving the rest.');if(ctx.readVersions.get(p)!==hash(current))throw Error('Read the current file with files_read before editing it. Its contents are new or changed.');}
    catch(e){if(e.code!=='ENOENT')throw e;}
  }
  const result=await def.run(ctx,args);
  if(['files_read','files_page','files_write','files_replace'].includes(name)&&result.sha256)ctx.readVersions.set(result.path,result.sha256);
  return result;
}
export function groupTools(group){return Object.values(definitions).filter(t=>t.group===group).map(t=>t.name);}
