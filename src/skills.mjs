import fs from 'node:fs/promises';
import path from 'node:path';
import {readJSON,writeJSON,clip} from './util.mjs';

export class Skills {
  constructor(config){this.root=config.skillsDir;}
  directory(name){if(!/^[a-z][a-z0-9-]{0,49}$/.test(name))throw Error('Skill ID must be lowercase letters, digits and hyphens.');return path.join(this.root,name);}
  async list(){const entries=await fs.readdir(this.root,{withFileTypes:true});const rows=[];for(const e of entries){if(!e.isDirectory()||e.isSymbolicLink()||!/^[a-z][a-z0-9-]{0,49}$/.test(e.name))continue;const file=path.join(this.root,e.name,'skill.json');const meta=await readJSON(file,null);if(meta)rows.push({...meta,id:e.name});}return rows;}
  async get(name){const dir=this.directory(name);const real=await fs.realpath(dir);if(path.dirname(real)!==await fs.realpath(this.root))throw Error('Skill symlink denied');const meta=await readJSON(path.join(dir,'skill.json'),null);if(!meta)throw Error('Skill not found');const instructionPath=path.join(dir,'SKILL.md');if((await fs.lstat(instructionPath)).isSymbolicLink())throw Error('Skill instruction symlink denied');return {...meta,id:name,content:await fs.readFile(instructionPath,'utf8')};}
  async save(input){
    const name=input.id;const dir=this.directory(name);
    if(typeof input.content!=='string'||!input.content.trim()||Buffer.byteLength(input.content)>16000)throw Error('Skill instructions must be 1..16000 bytes');
    const meta={name:clip(input.name??name,80),description:clip(input.description??'',250),triggers:(input.triggers??[]).slice(0,12).map(t=>clip(t,50)),modes:(input.modes??['chat','work']).filter(m=>['chat','work'].includes(m)),toolGroups:(input.toolGroups??[]).filter(g=>['files','documents','system','developer','organize','research','mcp'].includes(g)),enabled:input.enabled!==false,updatedAt:new Date().toISOString()};
    if(input.responseStyle){meta.responseStyle={};for(const [key,max] of [['maxSentences',20],['maxCharacters',3500]]){const value=input.responseStyle[key];if(value!==undefined){if(!Number.isInteger(value)||value<1||value>max)throw Error(`Invalid ${key}`);meta.responseStyle[key]=value;}}}
    await fs.mkdir(dir,{recursive:true});if(path.dirname(await fs.realpath(dir))!==await fs.realpath(this.root))throw Error('Skill symlink denied');
    await writeJSON(path.join(dir,'skill.json'),meta);const md=path.join(dir,'SKILL.md');try{if((await fs.lstat(md)).isSymbolicLink())throw Error('Skill instruction symlink denied');}catch(e){if(e.code!=='ENOENT')throw e;}
    await fs.writeFile(md,input.content,'utf8');return {...meta,id:name};
  }
  async select(text,selected=[],mode='work'){
    const all=await this.list();const q=text.toLowerCase();const explicit=[...selected,...[...text.matchAll(/\$([a-z][a-z0-9-]{0,49})/g)].map(m=>m[1])];
    const chosen=all.filter(s=>s.enabled&&s.modes.includes(mode)).map(s=>({s,score:explicit.includes(s.id)?100:s.triggers.reduce((n,t)=>n+(q.includes(t.toLowerCase())?2:0),0)})).filter(r=>r.score>0).sort((a,b)=>b.score-a.score).slice(0,2);
    return Promise.all(chosen.map(r=>this.get(r.s.id)));
  }
}
