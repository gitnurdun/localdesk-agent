// A small safe renderer: model output never becomes raw HTML.
const node=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
function inline(parent,text){
  const pattern=/(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\(https?:\/\/[^\s)]+\))/g;let last=0;
  for(const m of text.matchAll(pattern)){parent.append(document.createTextNode(text.slice(last,m.index)));const value=m[0];if(value.startsWith('`'))parent.append(node('code',value.slice(1,-1)));else if(value.startsWith('**'))parent.append(node('strong',value.slice(2,-2)));else{const match=value.match(/^\[([^\]]+)\]\((.+)\)$/);const link=node('a',match[1]);link.href=match[2];link.target='_blank';link.rel='noopener noreferrer';parent.append(link);}last=m.index+value.length;}
  parent.append(document.createTextNode(text.slice(last)));
}
export function markdown(text){
  const root=node('div');root.className='markdown';const lines=String(text).split('\n');let code=null,codeLang='',list=null;
  for(const line of lines){
    if(line.startsWith('```')){if(code!==null){const pre=node('pre');pre.append(node('code',code.join('\n')));if(codeLang)pre.dataset.language=codeLang;root.append(pre);code=null;}else{code=[];codeLang=line.slice(3).trim();}list=null;continue;}
    if(code!==null){code.push(line);continue;}
    if(!line.trim()){list=null;continue;}
    const heading=line.match(/^(#{1,4})\s+(.+)/);if(heading){const h=node('h'+Math.min(4,heading[1].length+1));inline(h,heading[2]);root.append(h);list=null;continue;}
    const item=line.match(/^\s*(?:[-*]|\d+\.)\s+(.+)/);if(item){if(!list){list=node(/^\s*\d/.test(line)?'ol':'ul');root.append(list);}const li=node('li');inline(li,item[1]);list.append(li);continue;}
    list=null;const p=node('p');inline(p,line);root.append(p);
  }
  if(code!==null){const pre=node('pre');pre.append(node('code',code.join('\n')));root.append(pre);}return root;
}
