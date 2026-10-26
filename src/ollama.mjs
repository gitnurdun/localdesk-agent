import { clip } from './util.mjs';

export class Ollama {
  constructor(config){this.config=config;}
  async request(endpoint,body,signal){
    const timeout=AbortSignal.timeout(this.config.requestTimeoutSeconds*1000);
    const combined=signal?AbortSignal.any([signal,timeout]):timeout;
    let response;
    try{response=await fetch(this.config.ollamaUrl+endpoint,{method:body?'POST':'GET',headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:combined});}
    catch(e){throw Error(`Cannot reach local Ollama (${this.config.ollamaUrl}): ${e.message}. Start Ollama, then retry.`);}
    if(!response.ok)throw Error(`Ollama ${response.status}: ${clip(await response.text(),600)}`);
    return response.json();
  }
  async models(){return (await this.request('/api/tags')).models;}
  async show(signal){return this.request('/api/show',{model:this.config.model},signal);}
  async streamText(messages,signal,onText=()=>{}){
    const bytes=messages.reduce((n,m)=>n+Buffer.byteLength(m.content)+32,0);if(bytes>this.config.contextTokens-this.config.outputTokens-768)throw Error('Chat context budget exceeded');
    const timeout=AbortSignal.timeout(this.config.requestTimeoutSeconds*1000);const combined=signal?AbortSignal.any([signal,timeout]):timeout;
    const response=await fetch(this.config.ollamaUrl+'/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:this.config.model,messages,stream:true,think:false,keep_alive:this.config.keepAlive,options:{num_ctx:this.config.contextTokens,num_predict:this.config.outputTokens,temperature:this.config.temperature,seed:42}}),signal:combined});
    if(!response.ok)throw Error(`Ollama ${response.status}: ${clip(await response.text(),600)}`);
    const decoder=new TextDecoder();let buffer='',text='',last={};
    const consume=raw=>{if(!raw.trim())return;const r=JSON.parse(raw);if(r.error)throw Error(r.error);const delta=r.message?.content??'';if(delta){text+=delta;if(text.length>30000)throw Error('Chat output limit exceeded');onText(delta);}if(r.done)last=r;};
    for await(const chunk of response.body){buffer+=decoder.decode(chunk,{stream:true});const lines=buffer.split('\n');buffer=lines.pop();for(const line of lines)consume(line);}if(buffer.trim())consume(buffer);
    if(!text.trim())throw Error('Ollama returned an empty answer');return {text,usage:{promptTokens:last.prompt_eval_count,outputTokens:last.eval_count,seconds:(last.total_duration??0)/1e9,promptBytes:bytes,truncated:last.done_reason==='length'}};
  }
  async chat(messages,schema,signal){
    // Byte count is a conservative upper bound for ordinary byte-BPE content.
    // Reserve additional room for the chat template and response grammar.
    const bytes=messages.reduce((n,m)=>n+Buffer.byteLength(m.content,'utf8')+32,0);
    const budget=this.config.contextTokens-this.config.outputTokens-768;
    if(bytes>budget)throw Error(`Prompt byte budget exceeded (${bytes}/${budget}); reduce tool descriptions or task size.`);
    const r=await this.request('/api/chat',{model:this.config.model,messages,stream:false,think:this.config.think,format:schema,keep_alive:this.config.keepAlive,options:{num_ctx:this.config.contextTokens,num_predict:this.config.outputTokens,temperature:this.config.temperature,seed:42}},signal);
    if(r.done_reason==='length')throw Error('Model response reached output limit. Retry with a smaller action.');
    let action;try{action=JSON.parse(r.message.content);}catch{throw Error(`Invalid model JSON: ${clip(r.message?.content,200)}`);}
    return {action,usage:{promptTokens:r.prompt_eval_count,outputTokens:r.eval_count,seconds:(r.total_duration??0)/1e9,tokensPerSecond:r.eval_duration?r.eval_count/(r.eval_duration/1e9):null,promptBytes:bytes}};
  }
}
