import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {loadConfig,APP} from '../src/config.mjs';

const config=await loadConfig();const url=`http://127.0.0.1:${config.port}`;
async function running(){
  let response;try{response=await fetch(url+'/api/session',{signal:AbortSignal.timeout(800)});}catch{return false;}
  let session;try{session=await response.json();}catch{throw Error('This port is occupied by another application');}
  if(!response.ok||typeof session.token!=='string')throw Error('This port is occupied by another application');
  const status=await fetch(url+'/api/status',{headers:{'X-LocalDesk-Token':session.token},signal:AbortSignal.timeout(1500)});
  const data=await status.json();if(!status.ok||!data.version||!data.workspace)throw Error('Existing server is not a compatible LocalDesk instance');return true;
}
try{
  if(!await running()){
    const logs=path.join(config.data,'logs');await fs.mkdir(logs,{recursive:true});
    const out=await fs.open(path.join(logs,'dashboard.stdout.log'),'a'),err=await fs.open(path.join(logs,'dashboard.stderr.log'),'a');
    const child=spawn(process.execPath,['src/cli.mjs','serve'],{cwd:APP,windowsHide:true,detached:true,stdio:['ignore',out.fd,err.fd]});let error;child.on('error',e=>error=e);child.unref();await out.close();await err.close();
    let ready=false;for(let n=0;n<160;n++){if(error)throw error;if(await running()){ready=true;break;}await new Promise(r=>setTimeout(r,250));}if(!ready)throw Error('Server is not ready yet. Check data/logs/dashboard.stderr.log.');
  }
  console.log('LocalDesk is ready: '+url);
  if(!process.argv.includes('--no-browser')){
    if(process.platform==='win32'){const browser=spawn(path.join(process.env.SystemRoot??'C:\\Windows','explorer.exe'),[url],{windowsHide:true,detached:true,stdio:'ignore'});browser.on('error',()=>console.log('Open '+url+' in your browser.'));browser.unref();}
    else console.log('Open '+url+' in your browser.');
  }
}catch(e){console.error(e.message);process.exitCode=1;}
