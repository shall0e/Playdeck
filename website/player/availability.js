import {publicHost} from './proxy-core.js';

export async function checkAvailability(request) {
  const headers={'Content-Type':'application/json','Cache-Control':'no-store','Access-Control-Allow-Origin':'*'};
  const reply=(data,status=200)=>Response.json(data,{status,headers});
  if(request.method!=='GET')return reply({error:'Method not allowed'},405);
  const endpoint=new URL(request.url);
  const allowed=url=>/^https?:$/.test(url.protocol) && publicHost(url.hostname) && !url.username && !url.password && !url.port && ![endpoint.hostname,'timebomb.lol','www.timebomb.lol'].includes(url.hostname);
  let target;
  try {target=new URL(endpoint.searchParams.get('url'));if(target.protocol!=='https:' || !allowed(target))throw new Error();}
  catch {return reply({error:'Invalid game URL'},400);}
  const signal=AbortSignal.timeout(10000);
  try {
    let method='HEAD';
    for(let redirects=0;redirects<=5;redirects++) {
      const response=await fetch(target.href,{method,redirect:'manual',signal,headers:method==='GET'?{Range:'bytes=0-0'}:{}});
      await response.body?.cancel();
      if([301,302,303,307,308].includes(response.status) && response.headers.has('Location')) {
        const next=new URL(response.headers.get('Location'),target);
        if(!allowed(next))return reply({available:false,reason:'invalid-redirect'});
        target=next;continue;
      }
      // Some hosts reject HEAD even though their game page works with GET.
      if(method==='HEAD' && response.status>=400 && response.status!==429){method='GET';redirects--;continue;}
      // Rate limiting does not establish whether the game itself is offline.
      if(response.status===429)return reply({available:null,status:429});
      return reply({available:response.ok,status:response.status});
    }
    return reply({available:false,reason:'redirect-loop'});
  }catch {return reply({available:false,reason:'unreachable'});}
}
