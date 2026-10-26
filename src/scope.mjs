// Task scope is derived only from the original user request, never tool output
// or a model-generated worker instruction. Ambiguous destructive requests fail closed.
export function toolPermitted(name,args,goal){
  const writing=/\b(create|write|save|edit|replace|change|update|copy|move|rename|convert|merge|extract|restore|organize|build|fix|generate)\b|创建|写入|保存|修改|更新|复制|移动|重命名|转换|合并|提取|恢复|整理/.test(goal.toLowerCase());
  if(['files_write','files_replace','files_copy','document_convert','pdf_extract','pdf_merge'].includes(name))return writing;
  if(name==='files_move')return /\b(move|rename|organize)\b|移动|重命名|整理/i.test(goal);
  if(name==='files_trash')return /\b(delete|remove|trash)\b|删除/i.test(goal);
  if(name==='files_restore')return /\b(restore|undo|recover)\b|恢复|撤销/i.test(goal);
  if(name==='memory_store')return /\b(remember|memorize|memory|preference)\b|记住|记忆|偏好/i.test(goal);
  if(name==='text_pipeline'&&args?.destination)return writing;
  if(name==='recipe_run')return /\b(recipe|run|execute)\b|运行|执行/i.test(goal);
  if(name==='schedule_create')return /\b(schedule|remind|recurring)\b|定时|提醒/i.test(goal);
  if(name==='schedule_pause')return /\b(pause|disable|stop|enable|resume)\b|暂停|停止|启用|恢复/i.test(goal)&&/\bschedule|定时|提醒/i.test(goal);
  return true;
}
