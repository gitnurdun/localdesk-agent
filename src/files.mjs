import fs from 'node:fs/promises';
import path from 'node:path';
import { hash,clip } from './util.mjs';

export const textExtensions=new Set(['.txt','.md','.csv','.tsv','.json','.jsonl','.yaml','.yml','.js','.mjs','.cjs','.ts','.tsx','.jsx','.html','.css','.xml','.tex','.log','.ini','.toml','.py','.sh','.ps1','.sql','.rst']);
const skip=new Set(['node_modules','.git','.ssh','.aws','.codex','.env','AppData','$RECYCLE.BIN','System Volume Information']);
export async function* walk(policy,dir='.',limit=500,depth=0,counter={n:0}) {
  if(depth>10||counter.n>=limit)return;
  const root=await policy.resolve(dir);
  const entries=await fs.readdir(root,{withFileTypes:true});
  for(const e of entries){
    if(counter.n>=limit)return;
    if(skip.has(e.name)||e.isSymbolicLink())continue;
    const p=path.join(root,e.name);
    try{await policy.resolve(p);}catch{continue;}
    if(e.isDirectory())yield* walk(policy,p,limit,depth+1,counter);
    else if(e.isFile()){counter.n++;yield p;}
  }
}
export async function readText(file,maxBytes=1024*1024){
  const size=(await fs.stat(file)).size;if(size>maxBytes)throw Error('File too large for this tool; use a narrower file or a CLI recipe.');
  const buf=await fs.readFile(file);if(buf.includes(0))throw Error('Binary file: use a document tool.');return buf.toString('utf8');
}
export async function writeText(ctx,file,content){
  const target=await ctx.policy.resolve(file,'write');
  const backupId=await ctx.store.backup(target);
  await fs.mkdir(path.dirname(target),{recursive:true});
  // Recheck after creating parents to catch preexisting junctions.
  await ctx.policy.resolve(target,'write');
  await fs.writeFile(target,content,'utf8');
  const check=await fs.readFile(target,'utf8');
  if(check!==content)throw Error('Write verification failed');
  return {path:target,bytes:Buffer.byteLength(content),sha256:hash(check),backupId,verified:true};
}
export async function listFiles(ctx,args){
  const dir=await ctx.policy.resolve(args.path??'.');
  if(!(await fs.stat(dir)).isDirectory())throw Error('This path is a file. Use files_read with that path.');
  const entries=await fs.readdir(dir,{withFileTypes:true});
  const rows=[];
  for(const e of entries.slice(0,200)){
    try{const target=await ctx.policy.resolve(path.join(dir,e.name));const st=await fs.stat(target);rows.push({name:e.name,type:st.isDirectory()?'directory':'file',bytes:st.size,modifiedAt:st.mtime.toISOString()});}catch{}
  }
  return {directory:dir,entries:rows,totalEntries:entries.length,truncated:entries.length>200};
}
export async function searchFiles(ctx,args){
  const matches=[];let scanned=0;const q=args.query.toLowerCase();
  const root=await ctx.policy.resolve(args.path??'.');const isFile=(await fs.stat(root)).isFile();
  const files=isFile?[root]:walk(ctx.policy,root,500);
  for await(const file of files){
    ctx.signal?.throwIfAborted();scanned++;
    if(!textExtensions.has(path.extname(file).toLowerCase()))continue;
    let text;try{text=await readText(file);}catch{continue;}
    const lines=text.split(/\r?\n/);
    for(let i=0;i<lines.length;i++)if(lines[i].toLowerCase().includes(q)){
      matches.push({path:file,line:i+1,text:clip(lines[i],400)});
      if(matches.length>=30)return {matches,scanned,truncated:true};
    }
  }
  if(isFile&&!matches.length){const preview=await readText(root);return {matches,scanned,note:'No exact match. The singular/plural wording may differ; inspect this file excerpt.',preview:clip(preview,2000)};}
  return {matches,scanned,scanLimit:500};
}
