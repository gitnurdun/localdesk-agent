import path from 'node:path';
import fs from 'node:fs/promises';
import {readJSON,writeJSON,clip} from './util.mjs';
import {rank} from './store.mjs';
import {Policy} from './policy.mjs';

export async function retrieve(config,query,limit=4){
  const rows=await readJSON(path.join(config.data,'memory','knowledge.json'),[]);const policy=new Policy(config);const hits=rank(rows,query,limit*3);const results=[];
  for(const row of hits){try{const file=await policy.resolve(row.path);const st=await fs.stat(file);results.push({...row,label:`S${results.length+1}`,text:clip(row.text,1200),possiblyStale:st.mtime.toISOString()>row.indexedAt});if(results.length>=limit)break;}catch{}}
  return results;
}
export async function knowledgeSources(config){
  const rows=await readJSON(path.join(config.data,'memory','knowledge.json'),[]);const sources=new Map();
  for(const row of rows){const r=sources.get(row.path)??{path:row.path,chunks:0,indexedAt:row.indexedAt};r.chunks++;sources.set(row.path,r);}
  return {chunks:rows.length,sources:[...sources.values()]};
}
export async function removeKnowledge(config,file){const target=await new Policy(config).resolve(file);const p=path.join(config.data,'memory','knowledge.json');const rows=await readJSON(p,[]);await writeJSON(p,rows.filter(r=>r.path!==target));}
