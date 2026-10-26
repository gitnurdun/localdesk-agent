import path from 'node:path';

// A narrow trusted-language fast lane for common recurring requests. The
// future goal and interval come from the original user, not model paraphrases.
export function parseRecurringRequest(goal){
  const match=goal.match(/^(?:please\s+)?schedule\s+(?:(?:a|an)\s+)?(.+?)\s+every\s+(\d+)\s+(minutes?|mins?|hours?|days?)(?:\s+in\s+(chat|work)\s+mode)?[.!]?$/i);
  if(!match)return null;const unit=match[3].toLowerCase();const minutes=Number(match[2])*(unit.startsWith('hour')?60:unit.startsWith('day')?1440:1);return {goal:'Perform this task: '+match[1],kind:'interval',minutes,...(match[4]?{mode:match[4].toLowerCase()}:{} )};
}

// Narrow deterministic assistance for explicit requests, not a general language parser.
export function deriveContract(goal){
  if(/^(?:please\s+)?(?:schedule\b|remind me\b|set up (?:a )?recurring)|^(?:设置定时|定时|提醒我)/i.test(goal))return {files:[],outputs:[],requiredTools:['schedule_create'],editing:false,calculate:false,delegate:false,reread:false};
  if(/\bschedule|定时|提醒/i.test(goal)&&/^(?:please\s+)?(?:list|show|pause|disable|enable|resume)\b|^(?:列出|暂停|启用)/i.test(goal))return {files:[],outputs:[],requiredTools:[/\b(list|show)\b|列出/i.test(goal)?'schedule_list':'schedule_pause'],editing:false,calculate:false,delegate:false,reread:false};
  const matches=[...goal.matchAll(/(?:"([^"\n]+\.(?:txt|md|csv|tsv|json|html|docx|pdf|odt|tex|js|mjs|py))"|([A-Za-z0-9_.:/\\-]+\.(?:txt|md|csv|tsv|json|html|docx|pdf|odt|tex|js|mjs|py)))/gi)];
  const files=[...new Set(matches.map(m=>m[1]??m[2]))];
  const outputs=[];
  for(const m of matches){
    const prefix=goal.slice(Math.max(0,m.index-150),m.index);
    if(/(?:create|save|write|output|export|convert|merge|extract)[^.\n;]*(?:\bto\b|\bin\b|\bas\b)\s*$/i.test(prefix)||/(?:create|write|save)\s+(?:a\s+)?$/i.test(prefix))outputs.push(m[1]??m[2]);
  }
  const requiredTools=[];
  if(/\bGPU\b|graphics card/i.test(goal))requiredTools.push('gpu_info');
  if(/\bCPU\b|\bRAM\b|free disk|disk space/i.test(goal))requiredTools.push('system_info');
  if(/\bprocess(?:es)?\b/i.test(goal))requiredTools.push('process_list');
  if(/installed.*(?:cli|command.line).*tools|which.*tools.*installed/i.test(goal))requiredTools.push('cli_inventory');
  if(/\bGit Bash\b/i.test(goal)&&/\bcount\b|\bsort\b|\blines\b/i.test(goal))requiredTools.push('bash_text|text_pipeline');
  return {files,outputs:[...new Set(outputs)],requiredTools,editing:/\b(change|replace|edit|update)\b/i.test(goal)&&files.length>0,calculate:/\bcalculate tool\b|\buse (?:the )?calculator\b|\bsum\b/i.test(goal),delegate:/\bdelegate\b/i.test(goal),reread:/read(?:ing)? (?:the |it |this )?file again|read (?:it )?back|reread/i.test(goal)};
}
export function missingRequirements(contract,evidence,workspace){
  const messages=[];
  if(contract.editing&&!evidence.some(e=>e.ok&&e.tool==='files_replace'))messages.push('Make the requested precise edit with files_replace.');
  if(contract.calculate&&!evidence.some(e=>e.ok&&e.tool==='calculate'))messages.push('Use calculate with numbers read from the source.');
  if(contract.delegate&&!evidence.some(e=>e.ok&&e.tool==='delegate'))messages.push('Use delegate for the requested specialist subtask.');
  for(const required of contract.requiredTools??[])if(!evidence.some(e=>e.ok&&required.split('|').includes(e.tool)))messages.push(`Get current evidence using ${required}.`);
  for(const output of contract.outputs){
    const target=path.resolve(workspace,output).toLowerCase();
    if(!evidence.some(e=>e.ok&&e.path&&path.resolve(e.path).toLowerCase()===target&&/files_write|files_replace|document_convert|pdf_extract|pdf_merge|files_copy|files_move|text_pipeline/.test(e.tool)))messages.push(`Produce the requested output file: ${output}.`);
  }
  const lastWrite=evidence.findLastIndex(e=>e.ok&&/files_write|files_replace/.test(e.tool));
  if(contract.reread&&lastWrite>=0&&!evidence.slice(lastWrite+1).some(e=>e.ok&&/files_read|files_page/.test(e.tool)))messages.push('Read the edited file again with files_read.');
  return messages;
}
export function readyForFinal(contract,evidence,workspace){
  const recognized=contract.outputs.length||contract.requiredTools.length||contract.calculate||contract.editing||contract.delegate;
  return Boolean(recognized&&evidence.some(e=>e.ok)&&missingRequirements(contract,evidence,workspace).length===0);
}
