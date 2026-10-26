import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import http from 'node:http';
import { loadConfig } from '../src/config.mjs';
import { Store } from '../src/store.mjs';
import { createToolContext,runTool } from '../src/tools.mjs';
import { startServer } from '../src/server.mjs';
import { findExe,runProcess } from '../src/process.mjs';
import { deriveContract,missingRequirements } from '../src/contract.mjs';

async function setup(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'localdesk-integration-'));const config=await loadConfig({workspace:path.join(root,'workspace'),data:path.join(root,'data'),readRoots:[],writeRoots:[]});t.after(()=>fs.rm(root,{recursive:true,force:true}));const store=new Store(config);const task=await store.newTask('test');return {root,config,store,ctx:createToolContext(config,store,task,new AbortController().signal)};}
function pdfFixture(){
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << /Font << /F1 7 0 R >> >> /Contents 4 0 R >>',null,'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>',null,'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  for(const [i,text] of [[3,'LocalDesk page one'],[5,'LocalDesk page two']]){const stream=`BT /F1 14 Tf 30 240 Td (${text}) Tj ET`;objects[i]=`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`;}
  let result='%PDF-1.4\n';const offsets=[0];objects.forEach((s,i)=>{offsets.push(Buffer.byteLength(result));result+=`${i+1} 0 obj\n${s}\nendobj\n`;});const xref=Buffer.byteLength(result);result+=`xref\n0 8\n0000000000 65535 f \n`+offsets.slice(1).map(n=>`${String(n).padStart(10,'0')} 00000 n \n`).join('')+`trailer\n<< /Size 8 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;return result;
}
test('contract detects explicit inputs, outputs and tool requirements',()=>{const c=deriveContract('Read inventory.txt. Use calculate tool to sum values. Save total in total.txt.');assert.deepEqual(c.files,['inventory.txt','total.txt']);assert.deepEqual(c.outputs,['total.txt']);assert.ok(c.calculate);assert.equal(missingRequirements(c,[],process.cwd()).length,2);});
test('qpdf checks, extracts and merges real PDFs',async t=>{const {ctx,config}=await setup(t);if(!await findExe('qpdf'))return t.skip('qpdf unavailable');await fs.writeFile(path.join(config.workspace,'two.pdf'),pdfFixture());assert.equal((await runTool('pdf_info',{path:'two.pdf'},ctx)).pages,'2');await runTool('pdf_extract',{source:'two.pdf',pages:'1',destination:'one.pdf'},ctx);assert.equal((await runTool('pdf_info',{path:'one.pdf'},ctx)).pages,'1');await runTool('pdf_merge',{sources:['one.pdf','two.pdf'],destination:'three.pdf'},ctx);assert.equal((await runTool('pdf_info',{path:'three.pdf'},ctx)).pages,'3');if(await findExe('pdftotext'))assert.match((await runTool('document_read',{path:'two.pdf'},ctx)).text,/LocalDesk page two/);});
test('Pandoc converts Markdown to DOCX and extracts it',async t=>{const {ctx}=await setup(t);if(!await findExe('pandoc'))return t.skip('pandoc unavailable');await runTool('files_write',{path:'note.md',content:'# A heading\n\nLocalDesk document test.'},ctx);await runTool('document_convert',{source:'note.md',destination:'note.docx',format:'docx'},ctx);assert.match((await runTool('document_read',{path:'note.docx'},ctx)).text,/LocalDesk document test/);});
test('Git Bash treats shell metacharacters in paths as literal data',async t=>{const {ctx}=await setup(t);if(!await findExe('bash'))return t.skip('Git Bash unavailable');await runTool('files_write',{path:'note; $(echo surprise).txt',content:'a\nb\nc\n'},ctx);const result=await runTool('bash_text',{path:'note; $(echo surprise).txt',operation:'count'},ctx);assert.equal(result.exitCode,0);assert.match(result.stdout,/\b3\b/);});
test('process timeout and cancellation stop owned commands',async()=>{const r=await runProcess(process.execPath,['-e','setInterval(()=>{},1000)'],{timeoutMs:100});assert.equal(r.timedOut,true);const c=new AbortController();setTimeout(()=>c.abort(),100);const stopped=await runProcess(process.execPath,['-e','setInterval(()=>{},1000)'],{signal:c.signal});assert.equal(stopped.cancelled,true);});
test('text pipeline filters, sorts, deduplicates and writes output',async t=>{const {ctx}=await setup(t);if(!await findExe('bash'))return t.skip('Git Bash unavailable');await runTool('files_write',{path:'rows.txt',content:'keep z\ndrop a\nkeep b\nkeep b\n'},ctx);const result=await runTool('text_pipeline',{source:'rows.txt',steps:[{operation:'filter',value:'keep'},{operation:'sort'},{operation:'unique'}],destination:'clean.txt'},ctx);assert.equal(result.text,'keep b\nkeep z\n');assert.equal((await runTool('files_read',{path:'clean.txt'},ctx)).content,'keep b\nkeep z\n');});
test('duplicate scan and recoverable rename preserve source bytes',async t=>{const {ctx}=await setup(t);await runTool('files_write',{path:'a.txt',content:'same'},ctx);await runTool('files_copy',{source:'a.txt',destination:'b.txt'},ctx);assert.equal((await runTool('duplicate_files',{path:'.'},ctx)).duplicates.length,1);const moved=await runTool('files_move',{source:'a.txt',destination:'nested/c.txt'},ctx);assert.ok(moved.backupId);assert.equal((await runTool('files_read',{path:'nested/c.txt'},ctx)).content,'same');const scan=await runTool('folder_scan',{path:'.'},ctx);assert.equal(scan.totalBytes,8);});
test('HTTP dashboard rejects cross-origin, wrong-host and unauthenticated actions',async t=>{
  const {config,store}=await setup(t);const probe=net.createServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));config.port=port;
  for(const task of await store.tasks()){task.status='cancelled';await store.saveTask(task);}
  const app=await startServer(config,store);t.after(()=>app.close());const base=app.url;
  const page=await fetch(base);assert.equal(page.status,200);assert.match(await page.text(),/type="module"/);
  const session=await (await fetch(base+'/api/session')).json();assert.equal(session.token.length,64);
  assert.equal((await fetch(base+'/api/tasks')).status,401);
  assert.equal((await fetch(base+'/api/session',{headers:{Origin:'https://attacker.example'}})).status,403);
  const deniedHost=await new Promise((resolve,reject)=>{const r=http.get(base+'/api/session',{headers:{Host:'attacker.example'}},res=>{res.resume();resolve(res.statusCode);});r.on('error',reject);});assert.equal(deniedHost,403);
  const headers={'X-LocalDesk-Token':session.token,'Content-Type':'application/json'};
  assert.equal((await fetch(base+'/api/status',{headers})).status,200);
  const add=await fetch(base+'/api/memory',{method:'POST',headers,body:JSON.stringify({text:'Integration test note'})});assert.equal(add.status,201);
  assert.equal((await (await fetch(base+'/api/memory',{headers})).json())[0].text,'Integration test note');
  const schedule=await fetch(base+'/api/schedules',{method:'POST',headers,body:JSON.stringify({goal:'Inspect free memory',minutes:60})});assert.equal(schedule.status,201);
  const item=await schedule.json();await fetch(base+'/api/schedules',{method:'DELETE',headers,body:JSON.stringify({id:item.id})});assert.equal((await (await fetch(base+'/api/schedules',{headers})).json()).length,0);
});
