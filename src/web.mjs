import dns from 'node:dns/promises';
import net from 'node:net';
import path from 'node:path';
import {findExe,runProcess} from './process.mjs';
import {clip} from './util.mjs';

const privateIP=ip=>ip==='::'||ip==='::1'||/^(?:f[cd][0-9a-f]{0,2}|fe[89ab][0-9a-f]):/i.test(ip)||/^::ffff:/i.test(ip)||/^(0|10|127|169\.254|192\.168)\./.test(ip)||/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(ip)||/^172\.(1[6-9]|2\d|3[01])\./.test(ip)||/^(22[4-9]|23\d|24\d|25[0-5])\./.test(ip);
export async function publicURL(value){const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||(u.port&&u.port!=='443'))throw Error('Web pages must use HTTPS without credentials or nonstandard ports');const host=u.hostname.replace(/^\[|\]$/g,'');const addresses=net.isIP(host)?[{address:host}]:await dns.lookup(host,{all:true});if(!addresses.length||addresses.some(a=>privateIP(a.address)))throw Error('Private/network-management addresses are not web pages');return u;}
export const stripHTML=text=>String(text).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,'').replace(/<[^>]*>/g,' ').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&nbsp;/g,' ').replace(/\s+/g,' ').trim();
async function boundedResponse(response,limit=300000){let bytes=0;const chunks=[];for await(const b of response.body){bytes+=b.length;if(bytes>limit){await response.body.cancel().catch(()=>{});throw Error('Web response exceeded size limit');}chunks.push(b);}return Buffer.concat(chunks).toString('utf8');}
let proxyLookup;
async function windowsProxy(){
  if(process.platform!=='win32')return '';
  proxyLookup??=(async()=>{try{const exe=path.join(process.env.SystemRoot??'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');const r=await runProcess(exe,['-NoProfile','-NonInteractive','-Command',"$proxySetting=Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'; if($proxySetting.ProxyEnable -eq 1){[Console]::Write($proxySetting.ProxyServer)}"],{timeoutMs:5000,maxBytes:2000});let proxy=r.stdout.trim();if(proxy.includes('='))proxy=proxy.match(/(?:^|;)https=([^;]+)/i)?.[1]??proxy.match(/(?:^|;)http=([^;]+)/i)?.[1]??'';if(!proxy)return '';const u=new URL(proxy.includes('://')?proxy:'http://'+proxy);return u.protocol==='http:'&&!u.username&&!u.password?u.href:'';}catch{return '';}})();return proxyLookup;
}
// Node does not automatically use the Windows proxy setting. Reuse installed
// curl for that case; no proxy settings, certificates or packages are modified.
export async function webFetch(url,options={}){
  const u=new URL(url);const proxy=['localhost','127.0.0.1','[::1]'].includes(u.hostname)?'':await windowsProxy();if(!proxy)return fetch(url,options);
  const curl=await findExe('curl');if(!curl)throw Error('A Windows proxy is configured but curl is unavailable');
  const args=['--silent','--show-error','--include','--suppress-connect-headers','--max-time','20','--max-filesize','300000','--proto','=http,https','--proxy',proxy,'--request','GET'];for(const [key,value] of Object.entries(options.headers??{}))args.push('--header',key+': '+value);args.push('--url',u.href);
  const r=await runProcess(curl,args,{signal:options.signal,timeoutMs:22000,maxBytes:315000});if(r.exitCode!==0||r.truncated||r.cancelled)throw Error(r.cancelled?'Web request cancelled':'Web proxy request failed: '+clip(r.stderr,250));
  const split=r.stdout.search(/\r?\n\r?\n/);if(split<0)throw Error('Invalid proxy response');const head=r.stdout.slice(0,split);const status=Number(head.match(/^HTTP\/\S+\s+(\d+)/)?.[1]);const headers={};for(const line of head.split(/\r?\n/).slice(1)){const i=line.indexOf(':');if(i>0)headers[line.slice(0,i).toLowerCase()]=line.slice(i+1).trim();}const body=r.stdout.slice(split+(r.stdout[split]==='\r'?4:2));return new Response([204,205,304].includes(status)?null:body,{status,headers});
}
export async function fetchPage(url,{signal,fetcher=webFetch,allowLocal=false}={}){
  let u=allowLocal?new URL(url):await publicURL(url);
  for(let hop=0;hop<4;hop++){
    const response=await fetcher(u,{redirect:'manual',headers:{'User-Agent':'LocalDesk/0.2 (local personal assistant)','Accept':'text/html,application/json,text/plain'},signal:signal?AbortSignal.any([signal,AbortSignal.timeout(20000)]):AbortSignal.timeout(20000)});
    if([301,302,303,307,308].includes(response.status)){const location=response.headers.get('location');if(!location)throw Error('Redirect without location');u=allowLocal?new URL(location,u):await publicURL(new URL(location,u).href);continue;}
    if(!response.ok)throw Error(`Web server returned HTTP ${response.status}`);
    const type=response.headers.get('content-type')??'';if(!/text|json|xml/.test(type))throw Error('Web tool accepts text pages only');
    return {url:u.href,text:await boundedResponse(response)};
  }throw Error('Too many web redirects');
}
export function parseDuckResults(html){
  if(/anomaly\.js|anomaly-modal|challenge-form|unfortunately.*bots/i.test(html))throw Error('Search provider presented a bot challenge. Configure a SearXNG provider or retry later.');
  const links=[...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)].filter(m=>/class="[^"]*result__a/.test(m[1])&&/href="/.test(m[1]));
  return links.slice(0,6).map(m=>{let link=m[1].match(/href="([^"]+)"/)[1].replace(/&amp;/g,'&');const u=new URL(link,'https://duckduckgo.com');link=u.searchParams.get('uddg')??u.href;return {title:stripHTML(m[2]),url:link};}).filter(r=>r.url.startsWith('https://'));
}
export async function webSearch(config,query,{signal,fetcher=webFetch}={}){
  if(!config.webSearch?.enabled)throw Error('Web search is disabled in settings');if(typeof query!=='string'||!query.trim()||query.length>400)throw Error('Search query must be 1..400 characters');
  if(config.webSearch.provider==='searxng'){
    const base=new URL(config.webSearch.url);if(!['https:','http:'].includes(base.protocol)||base.username||base.password)throw Error('Invalid SearXNG URL');if(base.protocol==='http:'&&!['localhost','127.0.0.1','[::1]'].includes(base.hostname))throw Error('Remote SearXNG must use HTTPS');
    const url=new URL('search',base.href.endsWith('/')?base.href:base.href+'/');url.searchParams.set('q',query);url.searchParams.set('format','json');
    const page=await fetchPage(url.href,{signal,fetcher,allowLocal:['localhost','127.0.0.1','[::1]'].includes(base.hostname)});const data=JSON.parse(page.text);return {query,provider:'searxng',results:(data.results??[]).filter(r=>/^https:\/\//i.test(r.url??'')).slice(0,6).map(r=>({title:r.title,url:r.url,snippet:clip(r.content??'',500)}))};
  }
  const u=new URL('https://html.duckduckgo.com/html/');u.searchParams.set('q',query);const page=await fetchPage(u.href,{signal,fetcher});return {query,provider:'duckduckgo',results:parseDuckResults(page.text),note:'Search links, not verified page contents. Read a page before citing detailed claims.'};
}
