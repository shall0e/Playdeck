import {BUILD_REVISION,FEATURE_RELEASE} from './version.js';
import {canonicalGameURL,proxyContext,recoverGameRequest,proxyOutgoingGameRequest,gameRequestClient} from './session.js';
import {staticResponse,routeCachedResponse} from './cache-policy.js';
import {partialWriter,resumeDownload,clearPartial,clearAllPartials} from './download-store.js';
const PREFIX='/player/games/';
const CACHE='timebomb-local-games-v1';
const SHELL='playdeck-local-shell-v37';
const METADATA='playdeck-local-hashes-v1';
const SHELL_FILES=['/','/home.css','/home.js','/player-ui.css','/player/','/player/boot.js','/player/controller.js','/player/performance.js','/player/graphics-quality.js','/player/settings.js','/player/toolbar.js','/player/toolbar-icons.js','/player/display.js','/player/viewport.js','/player/launch-options.js','/player/s3tc.js'];
SHELL_FILES.push('/player/version.js','/player/feature-tools.js','/player/cookies.js','/player/session.js','/player/options.js','/player/game-runtime.js','/player/proxy-core.js','/player/rewrite.js','/player/vendor/acorn.js','/player/cache-policy.js','/player/download-store.js','/player/deck.js','/player/deck.css','/player/profiles.js','/player/saves.js','/player/touch.js','/player/capture.js','/player/packages.js','/player/manifest.webmanifest','/player/icon.svg','/player/build.json');
SHELL_FILES.push('/player/network.js','/player/network-url.js');
const OLD_PREFIX='/__sandbox/games/';

export class DownloadActivity {
  constructor(notify=()=>{},now=()=>Date.now()) {this.active=0;this.lastDownload=now();this.notify=notify;this.now=now;}
  snapshot() {return {type:'sandbox:downloads',active:this.active,lastDownload:this.lastDownload};}
  changed() {this.lastDownload=this.now();this.notify(this.snapshot());}
  start() {this.active++;this.changed();let ended=false;return ()=>{if(ended)return;ended=true;this.active--;this.changed();};}
  idle(now=this.now()) {return this.active===0 && now-this.lastDownload>=2000;}
}
const sessions=new Map(),clientSessions=new Map(),sessionOptions=new Map(),inflight=new Map();
const metadataWrites=new Map();
// The launcher supplies its exact game route to recover native root-path fetches
// that originate in its document or in a worker without a usable referrer.
export function recoverAssetRequest(request,{clientURL,referrer,session}={}) {
  // Prefer the exact launch session, then the referrer, then the launch URL.
  // The latter also works after the worker loses its in-memory session map.
  const candidates=[];
  if(session?.prefix && session?.sourceURL) {
    try {
      const context=proxyContext(session.prefix+'source.example/');
      const source=new URL(session.sourceURL);
      const requested=new URL(request.url);
      const client=new URL(clientURL || '');
      if(context.prefix===session.prefix && context.session===session.session &&
         context.game===session.game && source.protocol==='https:' && !source.username &&
         !source.password && !source.port && client.origin===requested.origin &&
         client.pathname==='/player/' && !requested.pathname.startsWith('/player/') &&
         !requested.pathname.startsWith('/__game/') && !['/','/home.css','/home.js','/games.json','/favicon.ico'].includes(requested.pathname)) {
        candidates.push(requested.origin+session.prefix+source.host+source.pathname);
      }
    } catch {}
  }
  candidates.push(clientURL,referrer);
  return recoverGameRequest(request,candidates);
}
function sessionActivity(request){const session=proxyContext(new URL(request.url).pathname).session;if(!session)return downloads;if(!sessions.has(session))sessions.set(session,new DownloadActivity(data=>void inform({...data,session})));return sessions.get(session);}
export const downloads=new DownloadActivity(message=>{if(typeof self!=='undefined') void inform(message);});
export async function networkFetch(request,event) {
  const headers=new Headers(request.headers);headers.set('X-Playdeck-Destination',request.destination || request.headers.get('X-Playdeck-Destination') || 'empty');if(request.integrity)headers.set('X-Playdeck-Integrity',request.integrity);request=new Request(request,{headers,integrity:''});
  const activity=sessionActivity(request),session=proxyContext(new URL(request.url).pathname).session;
  activity.received ||= 0;activity.url=request.url;
  const end=activity.start();
  let response;
  try {response=await fetch(request);} catch(error) {end();throw error;}
  // Live event streams are connections, not downloads that block game readiness.
  if(/text\/event-stream/i.test(response.headers.get('Content-Type') || '')){end();return response;}
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
        activity.lastDownload=Date.now();
        activity.received+=result.value.byteLength;
        if(Date.now()-lastActivityNotification>=500) {lastActivityNotification=Date.now();void inform({...activity.snapshot(),session,received:activity.received,url:request.url});}
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
    !/(^|\/)api(\/|$)/i.test(url.pathname) && !request.headers.has('authorization');
}
// Retained for callers; downloads have no per-file size limit.
export const MAX_CACHE_BYTES=8*1024*1024;
let lastActivityNotification=0;
export export function isStaticFileRequest(request) {
  const path=new URL(request.url).pathname;
  return request.method==='GET' && /\.[a-z0-9]{1,16}$/i.test(path) && !/\.(?:html?|xhtml)$/i.test(path);
}
async function staticAssetProblem(request,response) {
  if(response.status!==200 || !isStaticFileRequest(request))return null;
  if(/html/i.test(response.headers.get('Content-Type') || ''))return 'an HTML fallback';
  if(response.headers.get('Content-Length')==='0' || !response.body)return 'an empty response';
  const reader=response.clone().body?.getReader();
  if(!reader)return 'an empty response';
  try {
    while(true) {
      const next=await reader.read();
      if(next.done)return 'an empty response';
      if(!next.value?.byteLength)continue;
      const start=new TextDecoder().decode(next.value.subarray(0,512)).replace(/^\uFEFF/,'').trimStart();
      if(/^(?:<!doctype\s+html\b|<html\b)/i.test(start))return 'an HTML fallback';
      return null;
    }
  } catch {return null;}
  finally {void reader.cancel().catch(()=>{});}
}
async function repairStaticAsset(request,response,fetcher) {
  let problem=await staticAssetProblem(request,response);
  if(!problem)return response;
  try{await response.body?.cancel();}catch{}
  const headers=new Headers(request.headers);headers.set('Cache-Control','no-cache');
  response=await fetcher(new Request(request,{cache:'reload',headers}));
  problem=await staticAssetProblem(request,response);
  if(!problem)return response;
  try{await response.body?.cancel();}catch{}
  return new Response('Playdeck could not load this game asset after retry: '+problem+'.',{status:502,headers:{'Content-Type':'text/plain','Cache-Control':'no-store','Cross-Origin-Resource-Policy':'cross-origin'}});
}
async function cachedAssetInvalid(request,response) {
  if(!staticResponse(request,response))return true;
  const expected=!response.headers.has('Content-Encoding')?Number(response.headers.get('Content-Length') || 0):0;
  try {
    const metadata=await caches.open(METADATA),saved=await metadata.match(localKey(request));
    if(!saved)return false;
    const info=await saved.json(),bytes=Number(info.bytes);
    if(bytes===0)return true;
    if(expected>0 && bytes>0 && expected!==bytes)return true;
  } catch {}
  return false;
}
async function deleteCachedAsset(cache,request) {
  await cache.delete(request);
  try{await (await caches.open(METADATA)).delete(localKey(request));}catch{}
}
export function canStore(request,response) {
  return isAsset(request) && request.method==='GET' && response.status===200 && response.type!=='opaque' &&
    staticResponse(request,response) && !response.headers.has('Content-Range') && !request.headers.has('Range');
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
const pendingSaves=new Map();
async function inform(message) {
  if(typeof self==='undefined') return;
  for (const client of await self.clients.matchAll({type:'window'})) {
    if (new URL(client.url).pathname==='/player/' && (!message.session || clientSessions.get(client.id)?.session===message.session)) client.postMessage(message);
  }
}
export function cacheAsset(cache,key,response,event,metadata) {
  if(!canStore(key,response) || !response.body)return response;
  // One reader feeds disk and the game with backpressure. Response.clone() on a
  // multi-GB stream can otherwise queue the entire slower branch in memory.
  const partial=partialWriter(key.url,response);
  const reader=response.body.getReader(),pipe=new TransformStream(),writer=pipe.writable.getWriter();
  const startedAt=cacheRevision,expected=!response.headers.has('Content-Encoding')?Number(response.headers.get('Content-Length') || 0):0;
  let bytes=0,writing=true;
  const cleared=()=>clearHistory.some(entry=>entry.revision>startedAt && (!entry.scope || matchesGameCache(key,entry.scope)));
  const saving=cache.put(key,new Response(pipe.readable,{status:response.status,statusText:response.statusText,headers:response.headers})).then(async()=>{
    if(cleared()){await cache.delete(key);return;}
    if(bytes===0 || (expected>0 && bytes!==expected)){
      await cache.delete(key);
      if(metadata)await metadata.delete(key);
      return;
    }
    if(metadata){
      const previous=metadataWrites.get(key.url) || Promise.resolve();
      const write=previous.catch(()=>{}).then(async()=>{let saved={};try{saved=await (await metadata.match(key))?.json() || {};}catch{}const owner=event.playdeckOwner;await metadata.put(key,Response.json({...saved,bytes,owners:[...new Set([...(saved.owners || []),...(owner?[owner]:[])])],pinnedOwners:[...new Set([...(saved.pinnedOwners || []),...(event.playdeckPinned && owner?[owner]:[])])],savedAt:Date.now()}));});
      metadataWrites.set(key.url,write);await write;if(metadataWrites.get(key.url)===write)metadataWrites.delete(key.url);
      if(cleared()){await cache.delete(key);await metadata.delete(key);return;}
    }
    await partial?.finish();
    return inform({type:'sandbox:saved',session:event.playdeckSession});
  }).catch(error=>{
    writing=false;void writer.abort(error).catch(()=>{});
    return inform({type:'sandbox:storage-error',session:event.playdeckSession,message:error.name==='QuotaExceededError'?'Browser storage is full. New files will stream until space is cleared.':'Some files could not be saved; the game will keep streaming.'});
  });
  pendingSaves.set(key.url,saving);
  event.waitUntil(saving.finally(()=>{if(pendingSaves.get(key.url)===saving)pendingSaves.delete(key.url);}));
  const body=new ReadableStream({
    async pull(controller){
      try{
        const next=await reader.read();
        if(next.done){
          if(bytes>0 && (!expected || bytes===expected))await partial?.finish();else await partial?.interrupt();
          if(writing)try{await writer.close();}catch{}controller.close();return;
        }
        bytes+=next.value.byteLength;await partial?.write(next.value);
        if(writing)try{await writer.write(next.value);}catch{writing=false;}
        controller.enqueue(next.value);
      }catch(error){await partial?.interrupt();if(writing)void writer.abort(error).catch(()=>{});controller.error(error);}
    },
    async cancel(reason){await partial?.interrupt();await Promise.allSettled([reader.cancel(reason),writer.abort(reason)]);}
  });
  return new Response(body,{status:response.status,statusText:response.statusText,headers:response.headers});
}
export function localKey(request,range=false){
  const url=canonicalGameURL(request.url);
  for(const name of [...url.searchParams.keys()]){
    if(/^(?:_+|cache[-_]?bust(?:er)?|timestamp|nocache)$/i.test(name))url.searchParams.delete(name);
  }
  if(request.integrity)url.searchParams.set('__playdeck_integrity',request.integrity);
  else if(request.headers.has('X-Playdeck-Integrity') || (request.headers.get('sec-fetch-dest')==='empty' && !request.headers.has('X-Playdeck-Executable') && /\.(?:html?|css|js|mjs)$/i.test(url.pathname)))url.searchParams.set('__playdeck_original','1');
  if(range)url.searchParams.set('__playdeck_range',request.headers.get('Range'));
  return new Request(url.href);
}
export function needsAssetRefresh(request,response){
  const transform=response.headers.get('X-Playdeck-Transform'),type=response.headers.get('Content-Type') || '';
  if(transform?.startsWith('hash-cache-1:'))return true;
  if(/text\/html|text\/css/i.test(type) && !transform)return true;
  return ['worker','sharedworker'].includes(request.destination) && !request.integrity && !transform?.endsWith(':'+request.destination);
}
// Mark device-local replies so browser DevTools can distinguish them
// from requests to Cloudflare. No network validation occurs on these paths.
function localCacheHit(response) {
  const headers=new Headers(response.headers);
  headers.set('X-Playdeck-Cache','HIT');
  return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
}
export async function localFetch(request,eventOriginal) {
  const event={waitUntil:promise=>eventOriginal.waitUntil(promise)};
  const key=localKey(request,request.headers.has('Range'));
  const id=request.method+':'+key.url;
  const pending=inflight.get(id);
  if(pending){await pending.catch(()=>{});}
  else {let finish;const complete=new Promise(resolve=>{finish=resolve;});inflight.set(id,complete);event.playdeckFinish=()=>{if(inflight.get(id)===complete)inflight.delete(id);finish();};}
  try{return await fetchLocal(request,event);}finally{if(event.playdeckFinish){const finish=event.playdeckFinish;event.playdeckFinish=null;event.waitUntil((pendingSaves.get(key.url) || Promise.resolve()).finally(finish));}}
}
export async function fetchLocal(request,event) {
  const context=proxyContext(new URL(request.url).pathname);event.playdeckSession=context.session;event.playdeckOwner=context.game;event.playdeckPinned=!!sessionOptions.get(context.session)?.pinned;
  const forceNetwork=request.headers.get('X-Playdeck-Update')==='1' || sessionOptions.get(context.session)?.online;
  if (!isAsset(request)) return networkFetch(request,event);
  let cache;
  try{cache=await caches.open(CACHE);}catch{return networkFetch(request,event);}
  const key=localKey(request),range=request.headers.get('Range');
  let cached=await cache.match(key);
  if(cached && needsAssetRefresh(request,cached)){await deleteCachedAsset(cache,key);cached=null;}
  if(cached && await cachedAssetInvalid(key,cached)){cached=null;await deleteCachedAsset(cache,key);}
  if(!cached && pendingSaves.has(key.url)){await pendingSaves.get(key.url);cached=await cache.match(key);}
  // Cache-busting query strings must not cause another download of a saved
  // static file. Documents and API/manifest responses retain query semantics.
  if(!cached && request.mode!=='navigate'){
    // Preserve semantic queries such as asset IDs, language and level numbers.
    for(const savedKey of await cache.keys?.(key,{ignoreSearch:true}) || []){
      if(localKey(savedKey).url!==key.url)continue;
      const candidate=await cache.match(savedKey),candidateRequest=localKey(savedKey);
      if(candidate && !/html|json|xml/i.test(candidate.headers.get('Content-Type') || '') && !candidate.headers.has('X-Playdeck-Stored-Status')){
        if(await cachedAssetInvalid(candidateRequest,candidate)){await deleteCachedAsset(cache,candidateRequest);continue;}
        cached=candidate;break;
      }
    }
  }
  if(!cached){
    const oldURL=new URL(request.url);oldURL.pathname=oldURL.pathname.replace(PREFIX,OLD_PREFIX);
    const oldRequest=new Request(oldURL.href),old=await cache.match(oldRequest);
    if(old && !/html|css|javascript|ecmascript/i.test(old.headers.get('Content-Type') || '')){
      if(await cachedAssetInvalid(oldRequest,old))await deleteCachedAsset(cache,oldRequest);else cached=old;
    }
  }
  if(cached && !forceNetwork){
    event.waitUntil(inform({type:'sandbox:cache-hit',session:context.session,url:request.url}));
    if(range){
      let size=Number(cached.headers.get('Content-Length') || 0);
      if(!size)try{size=(await (await (await caches.open(METADATA)).match(key))?.json())?.bytes || 0;}catch{}
      const partial=await cachedRange(cached,range,request.method==='HEAD',size);
      if(partial)return localCacheHit(partial);
    }else{
      if(request.method==='HEAD')return localCacheHit(new Response(null,{status:200,headers:cached.headers}));
      if(context.game){const metadata=await caches.open(METADATA);event.waitUntil((async()=>{try{let info=await (await metadata.match(key))?.json() || {};if(!info.owners?.includes(context.game))await metadata.put(key,Response.json({...info,owners:[...(info.owners || []),context.game]}));}catch{}})());}
      return localCacheHit(await routeCachedResponse(cached,request));
    }
  }
  const rangeKey=range?localKey(request,true):null;
  if(rangeKey && !forceNetwork){
    if(pendingSaves.has(rangeKey.url))await pendingSaves.get(rangeKey.url);
    const partial=await cache.match(rangeKey);
    if(partial){
      const headers=new Headers(partial.headers);
      headers.set('Content-Range',headers.get('X-Playdeck-Content-Range'));
      headers.delete('X-Playdeck-Stored-Status');headers.delete('X-Playdeck-Content-Range');
      return localCacheHit(new Response(request.method==='HEAD'?null:partial.body,{status:206,headers}));
    }
  }
  try {
    const fetcher=value=>networkFetch(value,event);
    let response=(!range && request.method==='GET'?await resumeDownload(request,key.url,fetcher):null) || await fetcher(request);
    if(!range && request.method==='GET')response=await repairStaticAsset(request,response,fetcher);
    if(forceNetwork && response.status===304 && cached)return routeCachedResponse(cached,request);
    if(sessionOptions.get(context.session)?.online)return response;
    if(!response.ok && response.status!==206)event.waitUntil(inform({type:'sandbox:request-error',session:context.session,url:request.url,status:response.status,contentType:response.headers.get('Content-Type')}));
    let metadata;try{metadata=await caches.open(METADATA);}catch{}
    if(rangeKey && request.method==='GET' && response.status===206){
      // CacheStorage rejects 206 entries. Store the complete requested range
      // under its own key as 200, then restore 206 when serving it to the game.
      const headers=new Headers(response.headers);headers.set('X-Playdeck-Stored-Status','206');
      headers.set('X-Playdeck-Content-Range',headers.get('Content-Range'));
      const storedHeaders=new Headers(headers);storedHeaders.delete('Content-Range');
      const input=new Response(response.body,{status:200,headers:storedHeaders});
      const saved=cacheAsset(cache,rangeKey,input,event,metadata);
      return new Response(saved.body,{status:206,statusText:response.statusText,headers:response.headers});
    }
    return routeCachedResponse(cacheAsset(cache,key,response,event,metadata),request);
  } catch(error) {
    event.waitUntil(inform({type:'sandbox:request-error',session:context.session,url:request.url,status:503,detail:String(error.message)}));
    return new Response('This file has not been downloaded. Reconnect to import it.',{status:503,headers:{'Content-Type':'text/plain','Cross-Origin-Resource-Policy':'cross-origin'}});
  }
}
export async function shellFetch(request,event){
  const url=new URL(request.url),key=url.origin+url.pathname;
  // Player updates are independent of the permanently local-first game store.
  try{
    const response=await fetch(new Request(request,{cache:'no-cache'}));
    if(response.ok){
      const copy=response.clone();
      event.waitUntil(caches.open(SHELL).then(cache=>cache.put(key,copy)).catch(()=>{}));
      return response;
    }
    return (await (await caches.open(SHELL)).match(key)) || response;
  }catch(error){
    const saved=await (await caches.open(SHELL)).match(key);
    if(saved)return saved;
    throw error;
  }
}
if (typeof self!=='undefined' && self.addEventListener) {
  self.addEventListener('install',event=>event.waitUntil((async()=>{
    const cache=await caches.open(SHELL);
    await Promise.all(SHELL_FILES.map(async path=>{try{const response=await fetch(path,{cache:'no-cache'});if(response.ok)await cache.put(path,response);}catch{}}));
    await self.skipWaiting();
  })()));
  self.addEventListener('activate',event=>event.waitUntil((async()=>{
    for (const name of await caches.keys()) if((name.startsWith('timebomb-local-shell-') || name.startsWith('playdeck-local-shell-')) && name!==SHELL) await caches.delete(name);
    await self.clients.claim();
  })()));
  self.addEventListener('fetch',event=>{
    event.respondWith((async()=>{
      // Browser-native WebAssembly, media, and worker requests can bypass the
      // page's fetch/XHR hooks. Catch outgoing traffic at the service worker.
      const client=event.clientId ? await self.clients.get(event.clientId) : null;
      let clientURL=client?.url;
      if(!clientURL || /^(?:blob:|about:|data:)/i.test(clientURL)){
        const frames=await self.clients.matchAll({type:'window'});
        clientURL=gameRequestClient(clientURL,frames.map(frame=>frame.url));
      }
      const recovered=recoverAssetRequest(event.request,{clientURL,referrer:event.request.referrer,session:clientSessions.get(event.clientId)});
      const request=proxyOutgoingGameRequest(recovered,clientURL,self.location.origin);
      const routed=new URL(request.url);
      if(routed.origin===self.location.origin && routed.pathname.startsWith(PREFIX))return localFetch(request,event);
      if(routed.origin===self.location.origin && routed.pathname.startsWith('/__game/v4/'))return networkFetch(request,event);
      if(routed.origin===self.location.origin && SHELL_FILES.includes(routed.pathname))return shellFetch(request,event);
      return fetch(request);
    })());
  });
  self.addEventListener('message',event=>{
    if (!event.source || new URL(event.source.url).pathname!=='/player/') return;
    const port=event.ports[0];
    event.waitUntil((async()=>{
      const sourceURL=new URL(event.source.url);
      if(event.data?.session)clientSessions.set(event.source.id,{
        session:event.data.session,game:event.data.game,
        prefix:event.data.routePrefix,
        sourceURL:sourceURL.searchParams.get('url')
      });
      const scope=gameCacheScope(sourceURL.searchParams.get('url'),sourceURL.origin);
      if(event.data?.type==='sandbox:version'){port?.postMessage({ok:true,revision:BUILD_REVISION,features:FEATURE_RELEASE,compatibility:'deck-runtime-1',shell:SHELL});
      } else if (event.data?.type==='sandbox:config') {
        if(!['full','auto','fast','native'].includes(event.data.performance))throw new Error('Invalid cache configuration');
        if(event.data.session)sessionOptions.set(event.data.session,{online:!!event.data.online,pinned:!!event.data.keepDownloaded});
        port?.postMessage({ok:true});
      } else if (event.data?.type==='sandbox:activity') {
        const activity=sessions.get(event.data.session) || downloads;port?.postMessage({ok:true,...activity.snapshot(),received:activity.received || 0,url:activity.url});
      } else if (event.data?.type==='sandbox:clear') {
        clearHistory.push({revision:++cacheRevision,scope:null});
        const cache=await caches.open(CACHE),metadata=await caches.open(METADATA);for(const key of await cache.keys()){let info;try{info=await (await metadata.match(key))?.json();}catch{}if(info?.pinnedOwners?.length)continue;await cache.delete(key);await metadata.delete(key);}await clearAllPartials();
        port?.postMessage({ok:true,files:0});
      } else if(event.data?.type==='sandbox:clear-game'){
        if(!scope)throw new Error('Invalid game scope');
        clearHistory.push({revision:++cacheRevision,scope});
        const cache=await caches.open(CACHE);
        const cleared=await clearGameCache(cache,scope);
        await clearGameCache(await caches.open(METADATA),scope);port?.postMessage({ok:true,cleared});
      } else if(event.data?.type==='sandbox:repair-file'){
        const cache=await caches.open(CACHE),metadata=await caches.open(METADATA);
        const requested=new URL(event.data.url);if(requested.origin!==sourceURL.origin || !requested.pathname.startsWith(PREFIX))throw new Error('Invalid downloaded file');
        const target=localKey(new Request(requested));for(const key of await cache.keys(target,{ignoreSearch:true})){await cache.delete(key);await metadata.delete(key);await clearPartial(key.url);}port?.postMessage({ok:true});
      } else if(event.data?.type==='sandbox:library'){
        const cache=await caches.open(CACHE),metadata=await caches.open(METADATA),files=[];
        for(const key of await cache.keys()){let info={};try{info=await (await metadata.match(key))?.json() || {};}catch{}files.push({url:key.url,...info});}port?.postMessage({ok:true,files});
      } else if(event.data?.type==='sandbox:pin-owner'){
        const owner=event.data.owner;if(!/^[a-z0-9]+$/.test(owner || ''))throw new Error('Invalid game identifier');for(const [session,options] of sessionOptions)if(clientSessions.get(event.source.id)?.session===session)options.pinned=!!event.data.pinned;const metadata=await caches.open(METADATA);for(const key of await metadata.keys()){let info;try{info=await (await metadata.match(key)).json();}catch{continue;}if(!info.owners?.includes(owner))continue;const pinned=new Set(info.pinnedOwners || []);event.data.pinned?pinned.add(owner):pinned.delete(owner);await metadata.put(key,Response.json({...info,pinnedOwners:[...pinned]}));}port?.postMessage({ok:true});
      } else if(event.data?.type==='sandbox:remove-owner'){
        const owner=event.data.owner;if(!/^[a-z0-9]+$/.test(owner || ''))throw new Error('Invalid game identifier');
        const cache=await caches.open(CACHE),metadata=await caches.open(METADATA);let removed=0;
        for(const key of await cache.keys()){let info;try{info=await (await metadata.match(key))?.json();}catch{}if(!info?.owners?.includes(owner))continue;info.owners=info.owners.filter(value=>value!==owner);if(info.owners.length)await metadata.put(key,Response.json(info));else{await cache.delete(key);await metadata.delete(key);await clearPartial(key.url);removed++;}}port?.postMessage({ok:true,removed});
      } else if (event.data?.type==='sandbox:stats') {
        const cache=await caches.open(CACHE);
        const keys=await cache.keys();port?.postMessage({ok:true,files:keys.length,gameFiles:keys.filter(key=>matchesGameCache(key,scope)).length});
      }
    })().catch(error=>port?.postMessage({ok:false,error:error.message})));
  });
}






