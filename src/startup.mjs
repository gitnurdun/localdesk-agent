import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { findExe } from './process.mjs';

export async function ensureOllama(config){
  const ready=async()=>{try{const r=await fetch(config.ollamaUrl+'/api/tags',{signal:AbortSignal.timeout(1200)});return r.ok;}catch{return false;}};
  if(await ready())return {started:false};
  const exe=await findExe('ollama');if(!exe)throw Error('Ollama executable not found. Install/start Ollama first.');
  const log=await fs.open(path.join(config.data,'ollama.log'),'a');
  const url=new URL(config.ollamaUrl);
  const child=spawn(exe,['serve'],{cwd:config.workspace,windowsHide:true,detached:true,stdio:['ignore',log.fd,log.fd],env:{...process.env,OLLAMA_HOST:`127.0.0.1:${url.port||11434}`,OLLAMA_NUM_PARALLEL:'1',OLLAMA_CONTEXT_LENGTH:String(config.contextTokens)}});
  await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});child.unref();await log.close();
  for(let n=0;n<20;n++){if(await ready())return {started:true,pid:child.pid};await new Promise(resolve=>setTimeout(resolve,500));}
  throw Error('Ollama did not become ready. See data/ollama.log.');
}
