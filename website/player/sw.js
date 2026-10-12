const PREFIX='/player/games/';
const CACHE='timebomb-local-games-v1';
const SHELL='playdeck-local-shell-v22';
const METADATA='playdeck-local-hashes-v1';
export const RECHECK_MS=5*60*1000;
const UNVERSIONED_MS=24*60*60*1000;
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
// Limit hashing buffers, not the size of files saved to disk.
export const MAX_CACHE_BYTES=8*1024*1024;
let lastActivityNotification=0;
export function canStore(request,response) {
  return isAsset(request) && response.headers.get('X-Playdeck-No-Store')!=='1' && request.method==='GET' && response.status===200 && response.type!=='opaque' &&
    !response.headers.has('Content-Range') && !request.headers.has('Range');
}
export async function cachedRange(response,range,head=false,size=Number(response.headers.get('Content-Length') || 0)) {
  const match=/^bytes=(\d*)-(\d*)$/.exec(range || '');
  if (!match || (!match[1] && !match[2])) return null;
  if(!size){
    const blob=await response.blob();
    if(!blob.size){const headers=new Headers(response.headers);headers.set('Content-Range','bytes */0');return new Response(null,{status:416,headers});}
    return cachedRange(new Response(blob,{headers:response.headers}),range,head,blob.size);
  }
  const start=match[1] ? Number(match[1]) : Math.max(0,size-Number(match[2]));
  let end=match[1] ? (match[2] ? Number(match[2]) : size-1) : size-1;
  const headers=new Headers(response.headers);headers.delete('content-encoding');
  if (start>=size || end<start) {
    headers.set('Content-Range','bytes */'+size);
    return new Response(null,{status:416,headers});
  }
  end=Math.min(end,size-1);
  headers.set('Content-Range','bytes '+start+'-'+end+'/'+size);
  headers.set('Content-Length',String(end-start+1));headers.set('Accept-Ranges','bytes');
  if(head)return new Response(null,{status:206,headers});
  const reader=response.body.getReader();let offset=0;
  const body=new ReadableStream({
    async pull(controller){
      try{
        while(true){
          const next=await reader.read();
          if(next.done){controller.close();return;}
          const before=offset;offset+=next.value.byteLength;
          if(offset<=start)continue;
          controller.enqueue(next.value.subarray(Math.max(0,start-before),Math.min(next.value.byteLength,end+1-before)));
          if(offset>end){await reader.cancel();controller.close();}
          return;
        }
      }catch(error){controller.error(error);}
    },
    cancel(reason){return reader.cancel(reason);}
  });
  return new Response(body,{status:206,headers});
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
export function cacheAsset(cache,key,response,event,metadata) {
  if(!canStore(key,response) || !response.body)return response;
  // One reader feeds disk and the game with backpressure. Response.clone() on a
  // multi-GB stream can otherwise queue the entire slower branch in memory.
  const reader=response.body.getReader(),pipe=new TransformStream(),writer=pipe.writable.getWriter();
  const startedAt=cacheRevision,chunks=[];
  let bytes=0,writing=true;
  const cleared=()=>clearHistory.some(entry=>entry.revision>startedAt && (!entry.scope || matchesGameCache(key,entry.scope)));
  const saving=cache.put(key,new Response(pipe.readable,{status:response.status,statusText:response.statusText,headers:response.headers})).then(async()=>{
    if(cleared()){await cache.delete(key);return;}
    let hash=null;
    if(bytes<=MAX_CACHE_BYTES){
      const data=new Uint8Array(bytes);let offset=0;
      for(const chunk of chunks){data.set(chunk,offset);offset+=chunk.byteLength;}
      hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data)),byte=>byte.toString(16).padStart(2,'0')).join('');
    }
    if(metadata){
      await metadata.put(key,Response.json({bytes,hash,checkedAt:Date.now(),savedAt:Date.now()}));
      if(cleared()){await cache.delete(key);await metadata.delete(key);return;}
    }
    return inform({type:'sandbox:saved'});
  }).catch(error=>{
    writing=false;void writer.abort(error).catch(()=>{});
    return inform({type:'sandbox:storage-error',message:error.name==='QuotaExceededError'?'Browser storage is full. New files will stream until space is cleared.':'Some files could not be saved; the game will keep streaming.'});
  });
  event.waitUntil(saving);
  const body=new ReadableStream({
    async pull(controller){
      try{
        const next=await reader.read();
        if(next.done){if(writing)try{await writer.close();}catch{}controller.close();return;}
        bytes+=next.value.byteLength;
        if(bytes<=MAX_CACHE_BYTES)chunks.push(next.value.slice());else chunks.length=0;
        if(writing)try{await writer.write(next.value);}catch{writing=false;}
        controller.enqueue(next.value);
      }catch(error){if(writing)void writer.abort(error).catch(()=>{});controller.error(error);}
    },
    async cancel(reason){await Promise.allSettled([reader.cancel(reason),writer.abort(reason)]);}
  });
  return new Response(body,{status:response.status,statusText:response.statusText,headers:response.headers});
}
export async function localFetch(request,event) {
  if (!isAsset(request)) return networkFetch(request,event);
  let cache,metadata;
  try{[cache,metadata]=await Promise.all([caches.open(CACHE),caches.open(METADATA)]);}catch{return networkFetch(request,event);}
  const key=new Request(request.url);
  let cached=await cache.match(key),record,config;
  try{record=await (await metadata.match(key))?.json();}catch{}
  try{config=await (await metadata.match(new URL('/player/__cache-config',request.url).href))?.json();}catch{}
  if(!cached){
    const oldURL=new URL(request.url);oldURL.pathname=oldURL.pathname.replace(PREFIX,OLD_PREFIX);
    const old=await cache.match(new Request(oldURL.href));
    if(old && !/html|css|javascript|ecmascript/i.test(old.headers.get('Content-Type') || ''))cached=old;
  }
  const range=request.headers.get('Range');
  if (cached && range) {
    const partial=await cachedRange(cached,range,request.method==='HEAD',record?.bytes || Number(cached.headers.get('Content-Length') || 0));
    if (partial) return partial;
  }
  if (cached && request.method==='HEAD') return new Response(null,{status:200,headers:cached.headers});
  const rewritten=cached && /text\/html|text\/css|javascript|ecmascript/i.test(cached.headers.get('Content-Type') || '');
  const transform=cached?.headers.get('X-Playdeck-Transform')?.split(':');
  const destination=['worker','sharedworker'].includes(request.destination)?request.destination:'asset';
  const needsDesktop=rewritten && (cached.headers.get('X-Timebomb-Desktop')!=='7' || !transform || transform[0]!=='hash-cache-1' || (config?.performance && transform[1]!==config.performance) || transform[2]!==destination);
  const mutable=rewritten || request.mode==='navigate' || /\.(html|json|webmanifest)(\?|$)/i.test(request.url);
  const force=['reload','no-cache'].includes(request.cache);
  if(cached && !range && !needsDesktop && !force && Date.now()-(record?.checkedAt || 0)<RECHECK_MS)return cached;
  const checkedAt=cacheRevision;
  const markChecked=async()=>{
    if(clearHistory.some(entry=>entry.revision>checkedAt && (!entry.scope || matchesGameCache(key,entry.scope))))return;
    await metadata.put(key,Response.json({...record,checkedAt:Date.now(),savedAt:record?.savedAt || Date.now()}));
    if(clearHistory.some(entry=>entry.revision>checkedAt && (!entry.scope || matchesGameCache(key,entry.scope))))await metadata.delete(key);
  };
  try {
    const headers=new Headers(request.headers);
    // Validators describe the upstream bytes, including scripts rewritten by
    // Playdeck. A 304 means the saved body can be used without downloading it.
    if(cached && !range && !needsDesktop){
      const etag=cached.headers.get('X-Playdeck-Source-ETag') || cached.headers.get('ETag');
      const modified=cached.headers.get('Last-Modified'),hash=cached.headers.get('X-Playdeck-Content-Hash');
      if(etag)headers.set('If-None-Match',etag);
      else if(modified)headers.set('If-Modified-Since',modified);
      if(hash)headers.set('X-Playdeck-Known-Hash',hash);
      if(cached.headers.has('X-Playdeck-Transform'))headers.set('X-Playdeck-Transform',cached.headers.get('X-Playdeck-Transform'));
      if(!etag && !modified && !hash && !mutable){
        const head=await networkFetch(new Request(request,{method:'HEAD',headers,cache:'no-cache'}),event);
        const hashHeaders=['Content-Digest','Digest','Content-MD5','X-Playdeck-Source-ETag','ETag'];
        const validator=hashHeaders.find(name=>cached.headers.has(name) && head.headers.has(name));
        const unchanged=head.ok && (validator?head.headers.get(validator)===cached.headers.get(validator):!force && Date.now()-(record?.savedAt || Date.now())<UNVERSIONED_MS);
        if(unchanged){event.waitUntil(markChecked().catch(()=>{}));return cached;}
        if(head.status>=500)return cached;
      }
    }
    const response=await networkFetch(new Request(request,{headers,cache:'no-cache'}),event);
    if(response.status===304 && cached){event.waitUntil(markChecked().catch(()=>{}));return cached;}
    if (response.status>=500 && cached) return cached;
    if(response.headers.get('X-Playdeck-No-Store')==='1')event.waitUntil(Promise.all([cache.delete(key),metadata.delete(key)]));
    return cacheAsset(cache,key,response,event,metadata);
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
      if (event.data?.type==='sandbox:config') {
        if(!['full','auto','fast','native'].includes(event.data.performance))throw new Error('Invalid cache configuration');
        const metadata=await caches.open(METADATA);
        await metadata.put(sourceURL.origin+'/player/__cache-config',Response.json({performance:event.data.performance}));
        port?.postMessage({ok:true});
      } else if (event.data?.type==='sandbox:activity') {
        port?.postMessage({ok:true,...downloads.snapshot()});
      } else if (event.data?.type==='sandbox:clear') {
        clearHistory.push({revision:++cacheRevision,scope:null});
        await Promise.all([caches.delete(CACHE),caches.delete(METADATA)]);
        port?.postMessage({ok:true,files:0});
      } else if(event.data?.type==='sandbox:clear-game'){
        if(!scope)throw new Error('Invalid game scope');
        clearHistory.push({revision:++cacheRevision,scope});
        const cache=await caches.open(CACHE);
        const cleared=await clearGameCache(cache,scope);
        await clearGameCache(await caches.open(METADATA),scope);port?.postMessage({ok:true,cleared});
      } else if (event.data?.type==='sandbox:stats') {
        const cache=await caches.open(CACHE);
        const keys=await cache.keys();port?.postMessage({ok:true,files:keys.length,gameFiles:keys.filter(key=>matchesGameCache(key,scope)).length});
      }
    })().catch(error=>port?.postMessage({ok:false,error:error.message})));
  });
}




