export function routeInput(goal,{attachments=[]}={}){
  const q=goal.toLowerCase();
  const local=/\b(my|installed|workspace|computer|laptop|folder|directory|processes|current|today|latest)\b|我的|电脑|文件夹|当前|最新/.test(q);
  const artifact=/\.(txt|md|csv|json|docx|pdf|js|mjs|ts|py|html)\b|[a-z]:[\\/]|https:\/\//i.test(q);
  const explanatory=/^(?:please\s+)?(?:explain|what is|what are|how does|how do|how to|why|tell me about)\b|^(解释|什么是|如何|为什么)/i.test(q);
  const explicit=/\b(read|list|find|search|inspect|check|count|calculate|convert|merge|extract|remember|restore|delete|rename|move|edit|replace|run|execute|perform|delegate|index|build|create|write|save|fix|schedule|remind)\b|读取|列出|搜索|查看|检查|计算|转换|合并|记住|删除|修改|运行|创建|保存|定时|提醒/.test(q);
  const work=!(explanatory&&!local&&!artifact)&&(explicit||local&&/cpu|gpu|ram|disk|memory|file|tool/i.test(q)||artifact||attachments.length>0);
  return {intent:work?'work':'conversation',reason:work?'The request refers to an action, local evidence, or a source.':'A conversational answer does not require computer actions.'};
}
