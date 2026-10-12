const PREFIX='/player/games/';
const CACHE='timebomb-local-games-v1';
const SHELL='playdeck-local-shell-v20';
const SHELL_FILES=['/','/home.css','/home.js','/player-ui.css','/player/','/player/boot.js','/player/controller.js','/player/performance.js','/player/settings.js','/player/toolbar.js','/player/display.js','/player/viewport.js','/player/launch-options.js','/player/s3tc.js'];
const OLD_PREFIX='/__sandbox/games/';

export class DownloadActivity {
  constructor(notify=()=>{},now=()=>Date.now()) {this.active=0;this.lastDownload=now();this.notify=notify;this.now=now;}
  snapshot() {return {type:'sandbox:downloads',active:this.active,lastDownload:this.lastDownload};}
  changed() {this.lastDownload=this.now();this.notify(this.snapshot());}
  start() {this.active++;this.changed();let ended=false;return ()=>{if(ended)return;ended=true;this.active--;this.changed();};}
  idle(now=this.now()) {return this.active===0 && now-this.lastDownload>=2000;}
}
export const downloads=new DownloadActivity(message=>{if(typeof self!=='undefined') void inform(message);});
export async function networkFetch(request,event) {
  const end=downloads.start();
  let response;
  try {response=await fetch(request);} catch(error) {end();throw error;}
  if (!response.body) {end();return response;}
  const reader=response.body.getReader();
  let finish;
  const done=new Promise(resolve=>{finish=()=>{end();resolve();};});
  event.waitUntil(done);
  const body=new ReadableStream({
    async pull(controller) {
      try {
        const result=await reader.read();
        if(result.done) {finish();controller.close();return;}
        downloads.lastDownload=Date.now();
        if(Date.now()-lastActivityNotification>=500) {lastActivityNotification=Date.now();void inform(downloads.snapshot());}
        controller.enqueue(result.value);
      } catch(error) {finish();controller.error(error);}
    },
    async cancel(reason) {try {await reader.cancel(reason);} finally {finish();}}
  });
  return new Response(body,{status:response.status,statusText:response.statusText,headers:response.headers});
}

export function isAsset(request) {
  const url=new URL(request.url);
  return url.pathname.startsWith(PREFIX) && ['GET','HEAD'].includes(request.method) &&
    !/(^|\/)api(\/|$)/i.test(url.pathname) && !request.headers.has('authorization') &&
    !request.headers.has('X-KSP-Offline-Download');
}
export const MAX_CACHE_BYTES=8*1024*1024;
let cacheWrites=0,lastActivityNotification=0;
export function canStore(request,response) {
  return isAsset(request) && request.cache!=='no-store' && Number(response.headers.get('Content-Length') || 0)<=MAX_CACHE_BYTES && request.method==='GET' && response.status===200 && response.type!=='opaque' &&
    !response.headers.has('Content-Range') && !request.headers.has('Range');
}
export async function cachedRange(response,range,head=false) {
  const blob=await response.blob();
  const match=/^bytes=(\d*)-(\d*)$/.exec(range || '');
  if (!match || (!match[1] && !match[2])) return null;
  let start=match[1] ? Number(match[1]) : Math.max(0,blob.size-Number(match[2]));
  let end=match[1] ? (match[2] ? Number(match[2]) : blob.size-1) : blob.size-1;
  const headers=new Headers(response.headers);
  headers.delete('content-encoding');
  if (start>=blob.size || end<start) {
    headers.set('Content-Range','bytes */'+blob.size);
    return new Response(null,{status:416,headers});
  }
  end=Math.min(end,blob.size-1);
  headers.set('Content-Range',`bytes ${start}-${end}/${blob.size}`);
  headers.set('Content-Length',String(end-start+1));
  headers.set('Accept-Ranges','bytes');
  return new Response(head ? null : blob.slice(start,end+1),{status:206,headers});
}

export function gameCacheScope(gameURL,origin){
  try{
    const url=new URL(gameURL),base=new URL(origin);
    if(url.protocol!=='https:' || url.username || url.password || url.port)return null;
    const folder=url.pathname.endsWith('/')?url.pathname:url.pathname.slice(0,url.pathname.lastIndexOf('/')+1);
    return {origin:base.origin,path:PREFIX+url.host+folder};
  }catch{return null;}
}
export function matchesGameCache(request,scope){
  if(!scope)return false;
  try{const url=new URL(typeof request==='string'?request:request.url);return url.origin===scope.origin && (url.pathname.startsWith(scope.path) || url.pathname.startsWith(scope.path.replace(PREFIX,OLD_PREFIX)));}catch{return false;}
}
export async function clearGameCache(cache,scope){
  if(!scope)throw new Error('Missing game cache scope');
  const files=(await cache.keys()).filter(key=>matchesGameCache(key,scope));
  await Promise.all(files.map(key=>cache.delete(key)));
  return files.length;
}
let cacheRevision=0;
const clearHistory=[];
async function inform(message) {
  if(typeof self==='undefined') return;
  for (const client of await self.clients.matchAll({type:'window'})) {
    if (new URL(client.url).pathname==='/player/') client.postMessage(message);
  }
}
export function cacheAsset(cache,key,response,event) {
  // Bounded cache branch: the live game's stream always remains independent.
  // Respect no-store loaders and never duplicate multi-GB game installs.
  if(!canStore(key,response) || cacheWrites>=2)return false;
  cacheWrites++;
  const startedAt=cacheRevision;
  let copy;
  try {copy=response.clone();} catch {cacheWrites--;return false;}
  let bytes=0;
  const body=copy.body?.pipeThrough(new TransformStream({transform(chunk,controller){
    bytes+=chunk.byteLength;
    if(bytes>MAX_CACHE_BYTES){controller.error(new RangeError('Sandbox cache size limit'));return;}
    controller.enqueue(chunk);
  }}));
  const stored=new Response(body,{status:copy.status,statusText:copy.statusText,headers:copy.headers});
  event.waitUntil(cache.put(key,stored).then(async()=>{
    if(clearHistory.some(entry=>entry.revision>startedAt && (!entry.scope || matchesGameCache(key,entry.scope))))await cache.delete(key);
    return inform({type:'sandbox:saved'});
  }).catch(error=>{
    if(error instanceof RangeError)return;
    return inform({type:'sandbox:storage-error',message:error.name==='QuotaExceededError'?'Browser storage is full. New files will stream until space is cleared.':'Some files could not be saved; the game will keep streaming.'});
  }).finally(()=>{cacheWrites--;}));
  return true;
}
export async function localFetch(request,event) {
  if (!isAsset(request)) return networkFetch(request,event);
  const cache=await caches.open(CACHE);
  const key=new Request(request.url);
  let cached=await cache.match(key);
  if(!cached){
    const oldURL=new URL(request.url);oldURL.pathname=oldURL.pathname.replace(PREFIX,OLD_PREFIX);
    const old=await cache.match(new Request(oldURL.href));
    // Binary downloads retain their bytes across the route rename. Rewritten scripts,
    // HTML and styles are refreshed because their embedded routes may be obsolete.
    if(old && !/html|css|javascript|ecmascript/i.test(old.headers.get('Content-Type') || ''))cached=old;
  }
  const range=request.headers.get('Range');
  if (cached && range && Number(cached.headers.get('Content-Length') || 0)<=MAX_CACHE_BYTES) {
    const partial=await cachedRange(cached,range,request.method==='HEAD');
    if (partial) return partial;
  }
  if (cached && request.method==='HEAD') return new Response(null,{status:200,headers:cached.headers});
  // Refresh launch pages/manifests online, reuse downloaded immutable assets.
  const path=new URL(request.url).pathname;
  const needsDesktop=cached && cached.headers.get('X-Timebomb-Desktop')!=='6' && (/text\/html|text\/css|javascript|ecmascript/i.test(cached.headers.get('Content-Type') || '') || ['worker','sharedworker'].includes(request.destination));
  const mutable=needsDesktop || Boolean(range) || request.cache==='no-store' || ['worker','sharedworker','style'].includes(request.destination) || request.mode==='navigate' || /\.(html|json|webmanifest)(\?|$)/i.test(request.url);
  if (cached && !mutable) return cached;
  try {
    const response=await networkFetch(request,event);
    if (response.status>=500 && cached) return cached;
    if(canStore(request,response))cacheAsset(cache,request,response,event);
    return response;
  } catch(error) {
    if (cached) return cached;
    return new Response('This file has not been downloaded. Reconnect to import it.',{status:503,headers:{'Content-Type':'text/plain','Cross-Origin-Resource-Policy':'cross-origin'}});
  }
}
if (typeof self!=='undefined' && self.addEventListener) {
  self.addEventListener('install',event=>event.waitUntil((async()=>{
    const cache=await caches.open(SHELL);
    await cache.addAll(SHELL_FILES);
    await self.skipWaiting();
  })()));
  self.addEventListener('activate',event=>event.waitUntil((async()=>{
    for (const name of await caches.keys()) if((name.startsWith('timebomb-local-shell-') || name.startsWith('playdeck-local-shell-')) && name!==SHELL) await caches.delete(name);
    await self.clients.claim();
  })()));
  self.addEventListener('fetch',event=>{
    const url=new URL(event.request.url);
    if (url.origin!==self.location.origin) return;
    if (url.pathname.startsWith(PREFIX)) event.respondWith(localFetch(event.request,event));
    else if(url.pathname.startsWith('/__game/v4/')) event.respondWith(networkFetch(event.request,event));
    else if (SHELL_FILES.includes(url.pathname)) event.respondWith((async()=>{
      try {
        const response=await fetch(event.request);
        if (response.ok) {const copy=response.clone();event.waitUntil(caches.open(SHELL).then(cache=>cache.put(url.origin+url.pathname,copy)));}
        return response;
      } catch {return (await caches.open(SHELL)).match(url.origin+url.pathname);}
    })());
  });
  self.addEventListener('message',event=>{
    if (!event.source || new URL(event.source.url).pathname!=='/player/') return;
    const port=event.ports[0];
    event.waitUntil((async()=>{
      const sourceURL=new URL(event.source.url);
      const scope=gameCacheScope(sourceURL.searchParams.get('url'),sourceURL.origin);
      if (event.data?.type==='sandbox:activity') {
        port?.postMessage({ok:true,...downloads.snapshot()});
      } else if (event.data?.type==='sandbox:clear') {
        clearHistory.push({revision:++cacheRevision,scope:null});
        await caches.delete(CACHE);
        port?.postMessage({ok:true,files:0});
      } else if(event.data?.type==='sandbox:clear-game'){
        if(!scope)throw new Error('Invalid game scope');
        clearHistory.push({revision:++cacheRevision,scope});
        const cache=await caches.open(CACHE);
        const cleared=await clearGameCache(cache,scope);port?.postMessage({ok:true,cleared});
      } else if (event.data?.type==='sandbox:stats') {
        const cache=await caches.open(CACHE);
        const keys=await cache.keys();port?.postMessage({ok:true,files:keys.length,gameFiles:keys.filter(key=>matchesGameCache(key,scope)).length});
      }
    })().catch(error=>port?.postMessage({ok:false,error:error.message})));
  });
}



