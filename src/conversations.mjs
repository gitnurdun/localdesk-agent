import path from 'node:path';
import fs from 'node:fs/promises';
import {id,readJSON,writeJSON,clip} from './util.mjs';

function summaryOf(messages){const past=messages.filter(m=>m.content).slice(0,-8);const facts=past.filter(m=>m.role==='user'&&/\b(?:my .{0,50} (?:is|are)|remember|prefer|always|never)\b|记住|偏好|我的.{0,20}是/i.test(m.content)).slice(-5).map(m=>clip(m.content,150)).join('\n');const recent=past.slice(-6).map(m=>`${m.role}: ${clip(m.content,140)}`).join('\n');return clip('Earlier user statements (data):\n'+facts+'\nEarlier exchanges (data):\n'+recent,1600);}

export class Conversations {
  constructor(config){this.root=path.join(config.data,'conversations');this.pending=new Map();}
  file(key){if(!/^[0-9a-f-]{36}$/.test(key))throw Error('Invalid conversation ID');return path.join(this.root,key+'.json');}
  async create(title='New conversation'){
    const c={id:id(),title:clip(title,100),createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),archived:false,messages:[],summary:'',settings:{mode:'chat',rag:true,web:false,skillIds:[]}};
    await writeJSON(this.file(c.id),c);return c;
  }
  async get(key){return readJSON(this.file(key),null);}
  async list(){const names=await fs.readdir(this.root);const rows=await Promise.all(names.filter(n=>/^[0-9a-f-]{36}\.json$/.test(n)).map(n=>readJSON(path.join(this.root,n),null)));return rows.filter(Boolean).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)).map(({messages,...c})=>({...c,messageCount:messages.length,lastMessage:clip(messages.at(-1)?.content??'',120)}));}
  async mutate(key,fn){
    const previous=this.pending.get(key)??Promise.resolve();
    const next=previous.catch(()=>{}).then(async()=>{const c=await this.get(key);if(!c)throw Error('Conversation not found');const result=await fn(c);c.updatedAt=new Date().toISOString();await writeJSON(this.file(key),c);return result??c;});
    this.pending.set(key,next);try{return await next;}finally{if(this.pending.get(key)===next)this.pending.delete(key);}
  }
  async addTurn(key,text,{mode='chat',attachments=[],skillIds=[],rag=true,web=false,scheduled=false}={}){
    if(!['chat','work'].includes(mode))throw Error('Mode must be chat or work');
    if(typeof text!=='string'||!text.trim()||text.length>12000)throw Error('Message must be 1..12000 characters');
    return this.mutate(key,c=>{
      if(c.messages.length>=1000)throw Error('Conversation has 1000 messages. Start a new conversation.');
      const user={id:id(),role:'user',content:text,mode,attachments,skillIds,rag,web,scheduled,createdAt:new Date().toISOString()};
      const assistant={id:id(),role:'assistant',content:'',mode,status:'queued',createdAt:new Date().toISOString(),citations:[]};
      c.messages.push(user,assistant);c.settings={mode,rag,web,skillIds};if(c.title==='New conversation')c.title=clip(text.replace(/\s+/g,' '),60);
      if(c.messages.length>16)c.summary=summaryOf(c.messages);
      return {user,assistant};
    });
  }
  async updateMessage(key,messageId,changes){return this.mutate(key,c=>{const m=c.messages.find(m=>m.id===messageId);if(!m)throw Error('Message not found');Object.assign(m,changes);return m;});}
  async history(key,beforeMessageId){const c=await this.get(key);if(!c)return [];const at=c.messages.findIndex(m=>m.id===beforeMessageId);return c.messages.slice(0,at<0?c.messages.length:at).filter(m=>m.content&&(m.role==='user'||['completed','blocked'].includes(m.status))).slice(-12).map(m=>({role:m.role,content:m.content}));}
  async compact(key){return this.mutate(key,c=>{c.summary=summaryOf(c.messages);return {summary:c.summary,retainedMessages:c.messages.length};});}
  async importLegacy(store){
    const marker=path.join(this.root,'legacy-import.json');if(await readJSON(marker,null))return;
    const tasks=(await store.tasks(1000)).filter(t=>!t.conversationId).reverse();
    if(tasks.length){const c=await this.create('Earlier work');await this.mutate(c.id,thread=>{for(const t of tasks){thread.messages.push({id:id(),role:'user',content:t.goal,mode:'work',createdAt:t.createdAt},{id:id(),role:'assistant',content:t.result??'',mode:'work',status:t.status,taskId:t.id,createdAt:t.finishedAt??t.createdAt});}});}
    await writeJSON(marker,{at:new Date().toISOString(),count:tasks.length});
  }
}
