import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../website/_worker.js';
import {localFetch,matchesGameCache,gameCacheScope} from '../website/player/sw.js';
test('legacy player links and assets redirect without losing the launch query',async()=>{
 for(const path of ['/__sandbox','/_sandbox']){
  for(const suffix of ['/?url=https%3A%2F%2Fgame.example%2F%3Fx%3D1%26y%3D2&displayOptions','/boot.js?v=old','/games/game.example/data.bin']){
   const response=await worker.fetch(new Request('https://player.example'+path+suffix),{});
   assert.equal(response.status,308);assert.equal(response.headers.get('Location'),'https://player.example/player'+suffix);
  }
 }
 const response=await worker.fetch(new Request('https://player.example/player?displayOptions'),{});
 assert.equal(response.headers.get('Location'),'https://player.example/player/?displayOptions');
});
test('the new player route retains embedding and service worker scope headers',async()=>{
 const response=await worker.fetch(new Request('https://player.example/player/sw.js'),{ASSETS:{fetch:async()=>new Response('worker')}});
 assert.equal(response.headers.get('Service-Worker-Allowed'),'/');assert.equal(response.headers.get('Cross-Origin-Resource-Policy'),'cross-origin');
});
test('cached binary assets survive the route rename without copying the cache',async()=>{
 const previousCaches=globalThis.caches,previousFetch=globalThis.fetch;
 const old='https://player.example/__sandbox/games/game.example/data.bin';
 globalThis.caches={open:async()=>({match:async key=>key.url===old?new Response('saved bytes',{headers:{'Content-Type':'application/octet-stream'}}):undefined})};
 globalThis.fetch=async()=>{throw new Error('Offline');};
 try{
  const response=await localFetch(new Request('https://player.example/player/games/game.example/data.bin'),{waitUntil(){}});
  assert.equal(await response.text(),'saved bytes');
  assert.equal(matchesGameCache(old,gameCacheScope('https://game.example/','https://player.example')),true);
 }finally{globalThis.caches=previousCaches;globalThis.fetch=previousFetch;}
});

test('legacy service-worker scripts update with 200 instead of an unsupported redirect',async()=>{
 for(const prefix of ['/__sandbox','/_sandbox']){
  let target;
  const response=await worker.fetch(new Request('https://player.example'+prefix+'/sw.js?v=old'),{ASSETS:{fetch:async request=>{target=request.url;return new Response('current worker',{headers:{'Content-Type':'text/javascript'}});}}});
  assert.equal(response.status,200);assert.equal(await response.text(),'current worker');
  assert.equal(target,'https://player.example/player/sw.js?v=old');
  assert.equal(response.headers.get('Service-Worker-Allowed'),'/');
  assert.equal(response.headers.get('Location'),null);
 }
});
