import test from 'node:test';
import {readFileSync} from 'node:fs';
import worker from '../website/_worker.js';
import assert from 'node:assert/strict';
import {isAsset,canStore,cachedRange,DownloadActivity,downloads,networkFetch,cacheAsset,MAX_CACHE_BYTES,localFetch} from '../website/player/sw.js';
import {bootstrap,proxyURL,rewriteJS,targetFromProxy,scopedCookie} from '../website/_worker.js';
const origin='https://playdeck-1z1.pages.dev';
const prefix='/player/games/';
test('local game rewrites and cookies stay under the sandbox route',()=>{
  assert.equal(proxyURL('/data.bin','https://vel.gg/bo1z',origin,prefix),origin+prefix+'vel.gg/data.bin');
  assert.equal(targetFromProxy(new URL(origin+prefix+'vel.gg/bo1z/data?q=1'),prefix).href,'https://vel.gg/bo1z/data?q=1');
  assert.ok(bootstrap('https://vel.gg/bo1z',origin,false,prefix).includes(JSON.stringify(prefix)));
  assert.ok(rewriteJS("import('./maps.js')",'https://vel.gg/bo1z/play.js',origin,prefix).includes(origin+prefix+'vel.gg/bo1z/maps.js'));
  assert.ok(scopedCookie('session=yes; Path=/',new URL('https://vel.gg/bo1z'),prefix).includes('Path='+prefix+'vel.gg/'));
});
test('cache saves complete game assets while APIs and admission downloads stay online',()=>{
  const url=origin+prefix+'vel.gg/bo1z/data.bin';
  const request=new Request(url);
  assert.equal(canStore(request,new Response('data')),true);
  assert.equal(isAsset(new Request(origin+prefix+'vel.gg/api/start')),false);
  assert.equal(isAsset(new Request(url,{method:'POST',body:'test'})),false);
  assert.equal(canStore(request,new Response('partial',{status:206})),false);
  assert.equal(isAsset(new Request(url,{headers:{'X-KSP-Offline-Download':'1'}})),false);
  assert.equal(isAsset(new Request(origin+'/__game/v4/vel.gg/data.bin')),false);
});
test('downloaded media supports bounded and suffix byte ranges offline',async()=>{
  const original=()=>new Response('0123456789',{headers:{'Content-Type':'application/octet-stream','Content-Length':'10'}});
  const response=await cachedRange(original(),'bytes=2-5');
  assert.equal(response.status,206);
  assert.equal(response.headers.get('Content-Range'),'bytes 2-5/10');
  assert.equal(await response.text(),'2345');
  assert.equal(await (await cachedRange(original(),'bytes=-3')).text(),'789');
  assert.equal((await cachedRange(original(),'bytes=100-')).status,416);
  assert.equal(await cachedRange(original(),'bytes=1-2,4-5'),null);
});

test('loading requires no active transfers and two seconds since the last transfer',()=>{
  let now=0;const activity=new DownloadActivity(()=>{},()=>now);
  const first=activity.start();const second=activity.start();
  now=5000;assert.equal(activity.idle(),false);
  first();now=8000;assert.equal(activity.idle(),false);
  second();now=9999;assert.equal(activity.idle(),false);
  now=10000;assert.equal(activity.idle(),true);
  const end=activity.start();assert.equal(activity.idle(),false);
  end();end();assert.equal(activity.active,0);
});
test('downloads stay active after headers until streamed bodies finish or cancel',async()=>{
  const originalFetch=globalThis.fetch;let controller;const pending=[];
  globalThis.fetch=async()=>new Response(new ReadableStream({start(value){controller=value;}}));
  try {
    const response=await networkFetch(new Request('https://assets.example/data'),{waitUntil:p=>pending.push(p)});
    assert.equal(downloads.active,1);
    const body=response.text();controller.enqueue(new TextEncoder().encode('part'));
    assert.equal(downloads.active,1);
    controller.close();assert.equal(await body,'part');await Promise.all(pending);
    assert.equal(downloads.active,0);
    const cancelled=await networkFetch(new Request('https://assets.example/other'),{waitUntil:p=>pending.push(p)});
    assert.equal(downloads.active,1);await cancelled.body.cancel();await Promise.all(pending);
    assert.equal(downloads.active,0);
    globalThis.fetch=async()=>{throw new Error('network failure');};
    await assert.rejects(networkFetch(new Request('https://assets.example/error'),{waitUntil:p=>pending.push(p)}));
    assert.equal(downloads.active,0);
  } finally {globalThis.fetch=originalFetch;}
});

test('sandbox player and worker are routed with embeddable headers',async()=>{
  const routes=JSON.parse(readFileSync(new URL('../website/_routes.json',import.meta.url),'utf8'));
  assert.ok(routes.include.includes('/player/*'));
  for(const path of ['/player/','/player/sw.js']) {
    const response=await worker.fetch(new Request(origin+path),{ASSETS:{fetch:async()=>new Response('player',{headers:{'X-Frame-Options':'SAMEORIGIN','Content-Security-Policy':"frame-ancestors 'self'"}})}});
    assert.equal(response.headers.get('X-Frame-Options'),null);
    assert.ok(response.headers.get('Content-Security-Policy').includes('frame-ancestors https:'));
    assert.equal(response.headers.get('Cross-Origin-Resource-Policy'),'cross-origin');
    if(path.endsWith('/sw.js')) assert.equal(response.headers.get('Service-Worker-Allowed'),'/');
  }
});


test('cache honors no-store and excludes large payloads before cloning',()=>{
  const request=new Request(origin+prefix+'example.com/map.bin');
  assert.equal(canStore(request,new Response('large',{headers:{'Content-Length':String(MAX_CACHE_BYTES+1)}})),false);
  assert.equal(canStore(new Request(request,{cache:'no-store'}),new Response('small')),false);
});
test('an oversized unknown-length cache branch cannot interrupt the live download',async()=>{
  const request=new Request(origin+prefix+'example.com/map.bin'),waits=[];
  const chunks=[new Uint8Array(MAX_CACHE_BYTES),new Uint8Array(1024)];
  const response=new Response(new ReadableStream({start(c){for(const chunk of chunks)c.enqueue(chunk);c.close();}}));
  let stored=false;
  const cache={put:async(key,value)=>{await value.arrayBuffer();stored=true;}};
  assert.equal(cacheAsset(cache,request,response,{waitUntil:p=>waits.push(p)}),true);
  const live=await response.arrayBuffer();await Promise.all(waits);
  assert.equal(live.byteLength,MAX_CACHE_BYTES+1024);assert.equal(stored,false);
});
test('bounded cache completes small assets and releases its concurrency slots',async()=>{
  const request=new Request(origin+prefix+'example.com/small.bin'),waits=[],values=[];
  const cache={put:async(key,value)=>values.push(await value.text())};
  assert.equal(cacheAsset(cache,request,new Response('first'),{waitUntil:p=>waits.push(p)}),true);
  assert.equal(cacheAsset(cache,request,new Response('second'),{waitUntil:p=>waits.push(p)}),true);
  assert.equal(cacheAsset(cache,request,new Response('third'),{waitUntil:p=>waits.push(p)}),false);
  await Promise.all(waits);assert.deepEqual(values.sort(),['first','second']);
});

test('range reads of previously cached large assets stay partial and reach the network',async()=>{
  const previousFetch=globalThis.fetch,previousCaches=globalThis.caches,waits=[];let sent;
  globalThis.caches={open:async()=>({match:async()=>new Response('old full file',{headers:{'Content-Length':String(MAX_CACHE_BYTES+100)}})})};
  globalThis.fetch=async request=>{sent=request;return new Response('part',{status:206,headers:{'Content-Range':'bytes 0-3/9000000'}});};
  try {
    const response=await localFetch(new Request(origin+prefix+'example.com/large.bin',{headers:{Range:'bytes=0-3'}}),{waitUntil:p=>waits.push(p)});
    assert.equal(response.status,206);assert.equal(await response.text(),'part');assert.equal(sent.headers.get('Range'),'bytes=0-3');
    await Promise.all(waits);
  }finally{globalThis.fetch=previousFetch;if(previousCaches===undefined)delete globalThis.caches;else globalThis.caches=previousCaches;}
});

