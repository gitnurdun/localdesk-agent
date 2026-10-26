import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

export async function findExe(name) {
  const candidates = (process.env.PATH??'').split(path.delimiter).flatMap(dir => [path.join(dir,name),path.join(dir,name+'.exe')]);
  const pf=process.env.ProgramFiles??'C:\\Program Files';
  const local=process.env.LOCALAPPDATA??'';
  const known={bash:path.join(pf,'Git','bin','bash.exe'),pandoc:path.join(local,'Pandoc','pandoc.exe'),ollama:path.join(local,'Programs','Ollama','ollama.exe')};
  if(known[name]) candidates.unshift(known[name]);
  for (const p of candidates) {try {if((await fs.stat(p)).isFile()) return p;}catch{}}
  return null;
}
export async function runProcess(exe,args,{cwd,signal,timeoutMs=20000,maxBytes=24000,input}={}) {
  if (signal?.aborted) throw Error('Cancelled');
  return new Promise((resolve,reject)=>{
    const child=spawn(exe,args,{cwd,shell:false,windowsHide:true,stdio:[input===undefined?'ignore':'pipe','pipe','pipe'],env:{...process.env,GIT_TERMINAL_PROMPT:'0',GIT_OPTIONAL_LOCKS:'0',PAGER:'cat',GIT_PAGER:'cat'}});
    if(child.stdin){child.stdin.on('error',()=>{});child.stdin.end(input);}
    let stdout='',stderr='',bytes=0,truncated=false,timedOut=false,finished=false;
    const kill=()=>{
      if(finished)return;
      if(process.platform==='win32' && child.pid){const k=spawn('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});k.on('error',()=>child.kill());}
      else child.kill('SIGKILL');
    };
    const timer=setTimeout(()=>{timedOut=true;kill();},timeoutMs);
    const abort=()=>kill();signal?.addEventListener('abort',abort,{once:true});
    const collect=which=>buf=>{bytes+=buf.length;if(bytes>maxBytes){truncated=true;kill();return;}if(which==='out')stdout+=buf.toString();else stderr+=buf.toString();};
    child.stdout.on('data',collect('out'));child.stderr.on('data',collect('err'));
    const cleanup=()=>{finished=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);};
    child.on('error',e=>{cleanup();reject(e);});
    child.on('close',code=>{cleanup();resolve({exitCode:code,stdout,stderr,truncated,timedOut,cancelled:signal?.aborted??false});});
  });
}
