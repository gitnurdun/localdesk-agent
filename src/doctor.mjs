import fs from 'node:fs/promises';
import { Ollama } from './ollama.mjs';
import { findExe,runProcess } from './process.mjs';

export async function doctor(config){
  const report={node:process.version,model:config.model,contextTokens:config.contextTokens,workspace:config.workspace,storage:config.data,tools:{},ollama:{reachable:false},warnings:[]};
  await Promise.all(['bash','git','qpdf','pandoc','pdftotext','node','ollama','nvidia-smi'].map(async name=>report.tools[name]=await findExe(name)));
  try{
    const ollama=new Ollama(config);const models=await ollama.models();report.ollama={reachable:true,models:models.map(m=>({name:m.name,sizeGB:+(m.size/1e9).toFixed(2),parameters:m.details?.parameter_size}))};
    const info=await ollama.show();report.ollama.parameters=info.model_info?.['general.parameter_count'];report.ollama.sizeLabel=info.model_info?.['general.size_label'];report.ollama.capabilities=info.capabilities;
    if(report.ollama.parameters>=2e9)report.warnings.push('Installed Qwen 1.7B reports 2.03B stored parameters. The selected installed model is used as requested.');
  }catch(e){report.ollama.error=e.message;}
  if(report.tools['nvidia-smi'])report.gpu=await runProcess(report.tools['nvidia-smi'],['--query-gpu=name,memory.total,memory.used','--format=csv,noheader'],{timeoutMs:5000});
  if(!report.tools.pdftotext)report.warnings.push('PDF extraction needs pdftotext; qpdf page operations still work.');
  report.diskFreeGB=+( (await fs.statfs(config.workspace)).bavail*(await fs.statfs(config.workspace)).bsize/2**30).toFixed(2);
  return report;
}
