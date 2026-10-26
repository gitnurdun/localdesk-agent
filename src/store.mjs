import fs from 'node:fs/promises';
import path from 'node:path';
import { id, readJSON, writeJSON, appendJSON, clip } from './util.mjs';

export function words(text) {
  const lower=String(text).toLowerCase();
  const latin=lower.match(/[\p{L}\p{N}_-]{2,}/gu)??[];
  const cjk=[...lower].filter(c=>/[\p{Script=Han}]/u.test(c));
  return [...new Set([...latin,...cjk.map((c,i)=>c+(cjk[i+1]??''))])];
}
export function rank(records,query,limit=6) {
  const stop=new Set('the a an to of in is are was were and or for with from this that me my please tell use file files document documents'.split(' '));
  const terms=words(query).filter(w=>!stop.has(w));if(!terms.length)return [];
  const texts=records.map(r=>[r.text,r.goal,r.name,r.description,(r.tags??[]).join(' ')].filter(Boolean).join(' ').toLowerCase());
  const lengths=texts.map(t=>Math.max(1,t.split(/\s+/).length));const average=lengths.reduce((a,b)=>a+b,0)/Math.max(1,texts.length);
  const df=terms.map(w=>texts.reduce((n,t)=>n+(t.includes(w)?1:0),0));
  return records.map((r,i)=>{const text=texts[i];const score=terms.reduce((n,w,j)=>{if(!text.includes(w))return n;const tf=Math.min(10,text.split(w).length-1);const idf=Math.log(1+(texts.length-df[j]+.5)/(df[j]+.5));return n+idf*(tf*2.2)/(tf+1.2*(.25+.75*lengths[i]/average));},0);return {...r,score};}).filter(r=>r.score>0).sort((a,b)=>b.score-a.score).slice(0,limit);
}
export class Store {
  constructor(config){this.config=config;this.root=config.data;this.memorySerial=Promise.resolve();}
  editMemory(fn){const job=this.memorySerial.catch(()=>{}).then(fn);this.memorySerial=job;return job;}
  taskDir(taskId){if(!/^[0-9a-f-]{36}$/.test(taskId))throw Error('Invalid task ID');return path.join(this.root,'tasks',taskId);}
  async newTask(goal,session='default',options={}) {
    if(typeof goal!=='string'||!goal.trim()||goal.length>12000)throw Error('Task must be 1..12000 characters');
    const task={id:id(),session:clip(session,80),goal,status:'queued',createdAt:new Date().toISOString(),plan:[],result:null,steps:0,...options};
    await this.saveTask(task);return task;
  }
  async saveTask(task){task.updatedAt=new Date().toISOString();await writeJSON(path.join(this.taskDir(task.id),'task.json'),task);}
  async getTask(taskId){return readJSON(path.join(this.taskDir(taskId),'task.json'),null);}
  async tasks(limit=100){
    const names=await fs.readdir(path.join(this.root,'tasks'));
    const tasks=await Promise.all(names.filter(n=>/^[0-9a-f-]{36}$/.test(n)).map(n=>this.getTask(n)));
    return tasks.filter(Boolean).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,limit);
  }
  async event(taskId,event){const e={id:id(),at:new Date().toISOString(),...event};await appendJSON(path.join(this.taskDir(taskId),'events.jsonl'),e);return e;}
  async events(taskId,limit=80){
    try {const data=await fs.readFile(path.join(this.taskDir(taskId),'events.jsonl'),'utf8');return data.trim().split('\n').filter(Boolean).map(line=>JSON.parse(line)).slice(-limit);}
    catch(e){if(e.code==='ENOENT')return [];throw e;}
  }
  async remember(text,tags=[],source='user',trust='user'){
    return this.editMemory(async()=>{
    const file=path.join(this.root,'memory','facts.json');const facts=await readJSON(file,[]);
    const existing=facts.find(r=>r.text===text);if(existing)return existing;
    const entry={id:id(),text:clip(text,2000),tags,source,trust,createdAt:new Date().toISOString()};
    facts.push(entry);await writeJSON(file,facts.slice(-2000));return entry;
    });
  }
  async memory(query,limit=6,{factsOnly=false}={}){
    const facts=await readJSON(path.join(this.root,'memory','facts.json'),[]);
    const episodes=factsOnly?[]:await readJSON(path.join(this.root,'memory','episodes.json'),[]);
    return rank([...facts,...episodes],query,limit);
  }
  async allMemory(){return readJSON(path.join(this.root,'memory','facts.json'),[]);}
  async forget(memoryId){return this.editMemory(async()=>{const file=path.join(this.root,'memory','facts.json');const facts=await readJSON(file,[]);await writeJSON(file,facts.filter(f=>f.id!==memoryId));});}
  async episode(task,evidence){
    const file=path.join(this.root,'memory','episodes.json');const records=await readJSON(file,[]);
    records.push({id:task.id,goal:clip(task.goal,600),text:clip(task.result??'',1400),status:task.status,evidence:evidence.slice(-6),trust:'past-task-not-instructions',createdAt:task.updatedAt});
    await writeJSON(file,records.slice(-500));
  }
  async backup(file){
    try {const info=await fs.stat(file);if(!info.isFile())throw Error('Only regular files can be changed');if(info.size>20*1024*1024)throw Error('File exceeds 20 MB mutation limit');
      const backupId=id();await fs.copyFile(file,path.join(this.root,'backups',backupId+'.bin'));
      await writeJSON(path.join(this.root,'backups',backupId+'.json'),{id:backupId,original:file,size:info.size,createdAt:new Date().toISOString()});return backupId;
    }catch(e){if(e.code==='ENOENT')return null;throw e;}
  }
  async lock(){
    const file=path.join(this.root,'runner.lock');
    try {const h=await fs.open(file,'wx');await h.writeFile(JSON.stringify({pid:process.pid}));await h.close();}
    catch(e){
      if(e.code!=='EEXIST')throw e;
      const lock=await readJSON(file,{});let alive=true;
      try{process.kill(lock.pid,0);}catch(e){if(e.code==='ESRCH'||!lock.pid)alive=false;}
      if(alive)throw Error('Another LocalDesk task is running. Use the dashboard queue or wait.');
      await fs.unlink(file);return this.lock();
    }
    return async()=>{await fs.unlink(file).catch(()=>{});};
  }
}
