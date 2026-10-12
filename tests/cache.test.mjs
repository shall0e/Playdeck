import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {localFetch,cacheAsset,MAX_CACHE_BYTES,RECHECK_MS,cachedRange} from '../website/player/sw.js';
import worker,{contentHashResponse} from '../website/_worker.js';
const origin='https://player.example',url=origin+'/player/games/game.example/game.bin';
class MemoryCache{
  constructor(){this.entries=new Map();}
  async match(key){const value=this.entries.get(typeof key==='string'?key:key.url);return value?new Response(value.body.slice(),{status:value.status,headers:value.headers}):undefined;}
  async put(key,response){this.entries.set(typeof key==='string'?key:key.url,{body:new Uint8Array(await response.arrayBuffer()),status:response.status,headers:new Headers(response.headers)});}
  async delete(key){return this.entries.delete(typeof key==='string'?key:key.url);}
}
async function fixture(run){
  const previousFetch=globalThis.fetch,previousCaches=globalThis.caches,waits=[];
  const data=new MemoryCache(),metadata=new MemoryCache(),calls=[];
  globalThis.caches={open:async name=>name==='playdeck-local-hashes-v1'?metadata:data};
  let upstream=async()=>new Response('saved asset',{headers:{ETag:'"version-1"','Content-Type':'application/octet-stream'}});
  globalThis.fetch=async request=>{calls.push(request);return upstream(request);};
  const event={waitUntil:promise=>waits.push(promise)};
  const finish=async()=>{while(waits.length)await Promise.all(waits.splice(0));};
  try{await run({data,metadata,calls,event,finish,setUpstream:value=>upstream=value});await finish();}
  finally{globalThis.fetch=previousFetch;if(previousCaches===undefined)delete globalThis.caches;else globalThis.caches=previousCaches;}
}
test('repeat no-store loader requests use the completed local download and its SHA-256',async()=>fixture(async({calls,metadata,event,finish})=>{
  const request=()=>new Request(url,{cache:'no-store'});
  assert.equal(await (await localFetch(request(),event)).text(),'saved asset');await finish();
  assert.equal(await (await localFetch(request(),event)).text(),'saved asset');
  assert.equal(calls.length,1);
  const record=await (await metadata.match(url)).json();
  assert.equal(record.hash,createHash('sha256').update('saved asset').digest('hex'));
}));
test('stale files send a validator, use saved bytes on 304, and download changed bytes once',async()=>fixture(async({calls,metadata,event,finish,setUpstream})=>{
  await (await localFetch(new Request(url),event)).text();await finish();
  const record=await (await metadata.match(url)).json();
  await metadata.put(url,Response.json({...record,checkedAt:Date.now()-RECHECK_MS-1}));
  setUpstream(async request=>{assert.equal(request.headers.get('If-None-Match'),'"version-1"');return new Response(null,{status:304});});
  assert.equal(await (await localFetch(new Request(url),event)).text(),'saved asset');await finish();
  assert.equal(calls.length,2);
  assert.equal(await (await localFetch(new Request(url),event)).text(),'saved asset');assert.equal(calls.length,2);
  setUpstream(async()=>new Response('new bytes',{headers:{ETag:'"version-2"'}}));
  assert.equal(await (await localFetch(new Request(url,{cache:'reload'}),event)).text(),'new bytes');await finish();
  assert.equal(await (await localFetch(new Request(url),event)).text(),'new bytes');assert.equal(calls.length,3);
}));
test('rewritten scripts retain the upstream ETag for a body-free conditional check',async()=>fixture(async({data,metadata,event,finish,setUpstream,calls})=>{
  const script=origin+'/player/games/game.example/engine.js';
  await data.put(script,new Response('rewritten engine',{headers:{'Content-Type':'text/javascript','X-Timebomb-Desktop':'7','X-Playdeck-Transform':'hash-cache-1:full:asset','X-Playdeck-Source-ETag':'"source-v1"'}}));
  await metadata.put(script,Response.json({checkedAt:0}));
  setUpstream(async request=>{assert.equal(request.headers.get('If-None-Match'),'"source-v1"');return new Response(null,{status:304});});
  assert.equal(await (await localFetch(new Request(script),event)).text(),'rewritten engine');await finish();
  assert.equal(calls.length,1);
  assert.equal(await (await localFetch(new Request(script),event)).text(),'rewritten engine');assert.equal(calls.length,1);
}));
test('changing performance mode rebuilds cached rewrites while preserving game data',async()=>fixture(async({data,metadata,event,finish,setUpstream,calls})=>{
  const script=origin+'/player/games/game.example/engine.js';
  await data.put(script,new Response('old script',{headers:{'Content-Type':'text/javascript','X-Timebomb-Desktop':'7','X-Playdeck-Transform':'hash-cache-1:full:asset'}}));
  await metadata.put(script,Response.json({checkedAt:Date.now()}));
  await metadata.put(origin+'/player/__cache-config',Response.json({performance:'native'}));
  setUpstream(async request=>{assert.equal(request.headers.get('If-None-Match'),null);return new Response('native script',{headers:{'Content-Type':'text/javascript','X-Timebomb-Desktop':'7','X-Playdeck-Transform':'hash-cache-1:native:asset'}});});
  assert.equal(await (await localFetch(new Request(script),event)).text(),'native script');await finish();
  assert.equal(calls.length,1);
}));
test('large files are reused and large byte ranges are read locally without buffering the entire file',async()=>fixture(async({calls,event,finish,setUpstream,metadata})=>{
  const size=MAX_CACHE_BYTES+1024;
  setUpstream(async()=>new Response(new Uint8Array(size).fill(42),{headers:{ETag:'"large-v1"','Content-Length':String(size)}}));
  assert.equal((await (await localFetch(new Request(url,{cache:'no-store'}),event)).arrayBuffer()).byteLength,size);await finish();
  const range=await localFetch(new Request(url,{headers:{Range:'bytes=8388607-8388610'}}),event);
  assert.equal(range.status,206);assert.deepEqual([...new Uint8Array(await range.arrayBuffer())],[42,42,42,42]);
  assert.equal(calls.length,1);
  assert.equal((await (await metadata.match(url)).json()).bytes,size);
  const sparse=new Response(new ReadableStream({start(controller){controller.enqueue(new Uint8Array(4));controller.close();}}),{headers:{'Content-Length':'1000000000'}});
  sparse.blob=()=>{throw new Error('Do not buffer a large cached file');};
  assert.equal((await (await cachedRange(sparse,'bytes=0-3')).arrayBuffer()).byteLength,4);
  assert.equal((await cachedRange(new Response(''),'bytes=0-3')).status,416);
}));
test('storage errors and interrupted transfers never leave a reusable partial download',async()=>{
  const request=new Request(url),waits=[],event={waitUntil:p=>waits.push(p)};
  const full=cacheAsset({put:async()=>{throw new DOMException('Full','QuotaExceededError');}},request,new Response('live game bytes'),event);
  assert.equal(await full.text(),'live game bytes');await Promise.all(waits);
  const data=new MemoryCache();waits.length=0;
  let count=0;
  const broken=new Response(new ReadableStream({pull(controller){if(count++===0)controller.enqueue(new Uint8Array([1,2]));else controller.error(new Error('Connection lost'));}}));
  await assert.rejects(cacheAsset(data,request,broken,event).arrayBuffer(),/Connection lost/);
  await Promise.all(waits);assert.equal(await data.match(request),undefined);
});
test('offline launches use the saved file even when its online check fails',async()=>fixture(async({event,finish,setUpstream})=>{
  await (await localFetch(new Request(url),event)).text();await finish();
  setUpstream(async()=>{throw new Error('Offline');});
  assert.equal(await (await localFetch(new Request(url,{cache:'reload'}),event)).text(),'saved asset');
}));
test('text without upstream validators uses SHA-256 to return 304 for unchanged saved content',async()=>{
  const first=await contentHashResponse(new Response('game code'),new Request(url));
  const hash=first.headers.get('X-Playdeck-Content-Hash');
  assert.equal(hash,createHash('sha256').update('game code').digest('hex'));
  assert.equal(await first.text(),'game code');
  const unchanged=await contentHashResponse(new Response('game code'),new Request(url,{headers:{'X-Playdeck-Known-Hash':hash}}));
  assert.equal(unchanged.status,304);assert.equal(unchanged.body,null);
  const changed=await contentHashResponse(new Response('new code'),new Request(url,{headers:{'X-Playdeck-Known-Hash':hash}}));
  assert.equal(changed.status,200);assert.equal(await changed.text(),'new code');
});
test('the proxy preserves source validators, strips internal headers, and invalidates obsolete rewrites',async()=>{
  const previousFetch=globalThis.fetch;let sent;
  globalThis.fetch=async(target,options)=>{sent=options;return new Response('let game=1;',{headers:{'Content-Type':'text/javascript',ETag:'"source-v1"'}});};
  try{
    const script=origin+'/player/games/game.example/engine.js';
    const first=await worker.fetch(new Request(script),{});
    assert.equal(first.headers.get('ETag'),null);assert.equal(first.headers.get('X-Playdeck-Source-ETag'),'"source-v1"');
    assert.equal(first.headers.get('X-Playdeck-Transform'),'hash-cache-1:full:asset');
    const second=await worker.fetch(new Request(script,{headers:{'If-None-Match':'"source-v1"','X-Playdeck-Transform':'outdated:full:asset','X-Playdeck-Known-Hash':'internal'}}),{});
    assert.equal(sent.headers.get('If-None-Match'),null);assert.equal(sent.headers.get('X-Playdeck-Known-Hash'),null);
    await second.text();
  }finally{globalThis.fetch=previousFetch;}
});

