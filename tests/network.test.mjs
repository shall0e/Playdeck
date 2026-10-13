import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import worker,{bootstrap,rewriteJS} from '../website/_worker.js';
import {proxyURL,targetFromProxy} from '../website/player/network-url.js';
import {recoverGameRequest,proxyOutgoingGameRequest} from '../website/player/session.js';
import {staticResponse,routeCachedResponse} from '../website/player/cache-policy.js';
const origin='https://player.example',prefix='/player/games/.launch/12345678-abcd/full/101/gameid/',base='https://game.example/folder/index.html';

test('file workers retain network hooks when service worker fetches lose destination', async () => {
  class Worker { constructor(url, options) { this.url=url; this.options=options; } }
  const realm=vm.createContext({URL,Request,Worker,SharedWorker:Worker,fetch:async()=>new Response('ok')});
  vm.runInContext(bootstrap(base,origin,true,prefix),realm);
  const previous=globalThis.fetch;
  try {
    for (const [name,destination] of [['Worker','worker'],['SharedWorker','sharedworker']]) {
      const instance=new realm[name]('dl_worker.js?map=transit',{type:'module'});
      assert.equal(instance.options.type,'module');
      assert.equal(new URL(instance.url).searchParams.get('__playdeck_worker'),destination);
      globalThis.fetch=async url=>{
        assert.equal(url,'https://game.example/folder/dl_worker.js?map=transit');
        return new Response("fetch('/packs/zm_transit/dist/manifest.json');fetch('/packs/zm_transit/dist/chunk.br');",{headers:{'Content-Type':'text/javascript','Last-Modified':'test'}});
      };
      const response=await worker.fetch(new Request(instance.url,{headers:{'sec-fetch-dest':'empty','X-Playdeck-Destination':'empty'}}),{});
      assert.equal(response.headers.get('X-Playdeck-Preserve-Source'),null);
      assert.ok(response.headers.get('X-Playdeck-Transform').endsWith(':'+destination));
      const calls=[];
      const child=vm.createContext({URL,Request,fetch:url=>{calls.push(url);return Promise.resolve(new Response('ok'));}});
      vm.runInContext(await response.text(),child);
      assert.deepEqual(calls,[origin+prefix+'game.example/packs/zm_transit/dist/manifest.json',origin+prefix+'game.example/packs/zm_transit/dist/chunk.br']);
    }
  } finally { globalThis.fetch=previous; }
});

test('public HTTP, ports and sockets round-trip through the sandbox without losing queries',()=>{
  for(const source of ['https://cdn.example/file.bin?q=1#two','http://cdn.example/file.bin?q=1','https://cdn.example:8443/file','ws://cdn.example:8080/live','wss://cdn.example/live']) {
    const url=new URL(proxyURL(source,base,origin,prefix));
    assert.equal(url.hostname,'player.example');
    assert.equal(targetFromProxy(url,prefix).href,source);
    assert.equal(proxyURL(url.href,base,origin,prefix),url.href);
  }
  assert.equal(proxyURL('data:text/plain,hello',base,origin,prefix),'data:text/plain,hello');
});

test('root requests and direct HTTP dependencies retain encoded upstream protocol and port',()=>{
  const client=origin+prefix+'.net/http/game.example:8080/folder/index.html';
  assert.equal(recoverGameRequest(new Request(origin+'/packs/map.json'),[client]).url,origin+prefix+'.net/http/game.example:8080/packs/map.json');
  assert.equal(proxyOutgoingGameRequest(new Request('https://cdn.example:8443/x'),client,origin).url,origin+prefix+'.net/https/cdn.example:8443/x');
});

test('WebSocket, EventSource and beacon requests are mapped in worker realms',async()=>{
  const calls=[];
  class Socket {static OPEN=1;constructor(...args){this.args=args;}}
  class Events {constructor(...args){this.args=args;}}
  const realm=vm.createContext({URL,Request,Blob,WebSocket:Socket,EventSource:Events,navigator:{sendBeacon:(...args)=>{calls.push(args);return true;}},fetch:(...args)=>{calls.push(args);return Promise.resolve(new Response('ok'));}});
  vm.runInContext(bootstrap(base,origin,true,prefix),realm);
  const socket=new realm.WebSocket('wss://player.example/api/ws',['game-v1']);
  const mapped=new URL(socket.args[0]);
  assert.equal(mapped.host,'player.example');
  assert.equal(mapped.pathname,prefix+'.net/wss/game.example/api/ws');
  assert.equal(mapped.searchParams.get('__playdeck_source'),'https://game.example');
  assert.deepEqual(socket.args[1],['game-v1']);
  assert.equal(realm.WebSocket.OPEN,1);
  assert(socket instanceof Socket);
  assert.equal(new realm.EventSource('https://events.example/live',{withCredentials:true}).args[0],origin+prefix+'events.example/live');
  assert.equal(realm.navigator.sendBeacon('/metrics','body'),true);
  assert.equal(calls.at(-1)[0],origin+prefix+'game.example/metrics');
  assert.equal(calls.at(-1)[1],'body');
  await realm.fetch(new Request('https://cdn.example/data',{method:'POST',body:'payload'}));
  assert.equal(calls.at(-1)[0].url,origin+prefix+'cdn.example/data');
  assert.equal(await calls.at(-1)[0].text(),'payload');
});

test('nested blob workers install network hooks before their own code',async()=>{
  const blobs=new Map();
  class URLs extends URL {static createObjectURL(blob){const url='blob:'+origin+'/'+(blobs.size+1);blobs.set(url,blob);return url;}static revokeObjectURL(url){blobs.delete(url);}}
  class Worker {constructor(url){this.url=url;}}
  const realm=vm.createContext({URL:URLs,Blob,Request,Worker,fetch:async()=>new Response('ok')});
  vm.runInContext(bootstrap(base,origin,true,prefix),realm);
  const first=new realm.Worker(realm.URL.createObjectURL(new Blob(["globalThis.nested=new Worker(URL.createObjectURL(new Blob([\"fetch('https://cdn.example/map.bin')\"],{type:'text/javascript'})))"],{type:'text/javascript'})));
  const child=vm.createContext({URL:URLs,Blob,Request,Worker,fetch:async()=>new Response('ok')});
  vm.runInContext(await blobs.get(first.url).text(),child);
  const calls=[],grandchild=vm.createContext({URL:URLs,Blob,Request,fetch:url=>{calls.push(url);return Promise.resolve(new Response('ok'));}});
  vm.runInContext(await blobs.get(child.nested.url).text(),grandchild);
  assert.equal(calls[0],origin+prefix+'cdn.example/map.bin');
});

test('WebSocket upgrades preserve the native response and subprotocol without retries',async()=>{
  const original=globalThis.fetch,socket={},response={status:101,webSocket:socket};let calls=0;
  globalThis.fetch=async(url,options)=>{calls++;assert.equal(url,'https://signal.example/live?token=abc');assert.equal(options.headers.get('Upgrade'),'websocket');assert.equal(options.headers.get('sec-websocket-protocol'),'game-v1');assert.equal(options.headers.get('Origin'),'https://game.example');return response;};
  try {
    const result=await worker.fetch(new Request(origin+prefix+'.net/wss/signal.example/live?token=abc&__playdeck_source=https%3A%2F%2Fgame.example',{headers:{Upgrade:'websocket','sec-websocket-protocol':'game-v1'}}),{});
    assert.equal(result,response);assert.equal(calls,1);
  }finally{globalThis.fetch=original;}
});

test('HTTP-only dependencies preserve method, body and public nondefault ports',async()=>{
  const original=globalThis.fetch;
  globalThis.fetch=async(url,options)=>{assert.equal(url,'http://game.example:8080/save');assert.equal(options.method,'POST');assert.equal(await new Response(options.body).text(),'save');return new Response('ok');};
  try {assert.equal(await (await worker.fetch(new Request(origin+prefix+'.net/http/game.example:8080/save',{method:'POST',body:'save'}),{})).text(),'ok');}finally{globalThis.fetch=original;}
});

test('live server events are never stored as downloaded game files',()=>{
  assert.equal(staticResponse(new Request(origin+prefix+'game.example/events'),new Response('data: ready\n\n',{headers:{'Content-Type':'text/event-stream'}})),false);
});

test('navigation destinations are mapped without rewriting game data or shadowed variables',()=>{
  const source="location.href=next; window.location.assign('/client.html'); document.location='https://cdn.example/page'; function local(location){location.href='/untouched';} const data='https://cdn.example/data';";
  const rewritten=rewriteJS(source,base,origin,prefix);
  assert(rewritten.includes('location.href=globalThis.__playdeckMap(next)'));
  assert(rewritten.includes("window.location.assign(globalThis.__playdeckMap('/client.html'))"));
  assert(rewritten.includes("document.location=globalThis.__playdeckMap('https://cdn.example/page')"));
  assert(rewritten.includes("location.href='/untouched'"));
  assert(rewritten.includes("const data='https://cdn.example/data'"));
});

test('existing cached documents get new network hooks locally without changing saved game bytes',async()=>{
  const request=new Request(origin+prefix+'game.example/index.html');
  const response=await routeCachedResponse(new Response('<html><head></head><body>saved</body></html>',{headers:{'Content-Type':'text/html','X-Playdeck-Compatibility':'deck-runtime-1'}}),request);
  const text=await response.text();assert(text.includes('installNetworkProxy'));assert.equal(response.headers.get('X-Playdeck-Network'),'deck-network-3');
  const binary=new Response(new Uint8Array([1,2,3]));assert.equal(await routeCachedResponse(binary,request),binary);
});
import {rewriteImportMap} from '../website/player/rewrite.js';
test('import maps proxy module dependencies while retaining bare aliases and blocked entries',()=>{
  const result=JSON.parse(rewriteImportMap(JSON.stringify({imports:{engine:'https://modules.example/engine.mjs',blocked:null},scopes:{'/folder/':{data:'http://modules.example:8080/data.mjs'}}}),value=>proxyURL(value,base,origin,prefix)));
  assert.equal(result.imports.engine,origin+prefix+'modules.example/engine.mjs');assert.equal(result.imports.blocked,null);
  assert.equal(result.scopes[origin+prefix+'game.example/folder/'].data,origin+prefix+'.net/http/modules.example:8080/data.mjs');
});
import {buildSync} from 'esbuild';
test('deployment bundling keeps nested worker hooks self-contained',async()=>{
  const bundle=buildSync({entryPoints:['website/player/proxy-core.js'],bundle:true,write:false,format:'iife',globalName:'ProxyCore',keepNames:true,platform:'browser'}).outputFiles[0].text;
  const compiled=vm.createContext({URL,Request});vm.runInContext(bundle,compiled);
  const blobs=new Map();class URLs extends URL {static createObjectURL(blob){const url='blob:'+origin+'/'+(blobs.size+1);blobs.set(url,blob);return url;}}class Worker {constructor(url){this.url=url;}}
  const realm=vm.createContext({URL:URLs,Request,Blob,Worker,fetch:async()=>new Response('ok')});
  vm.runInContext(compiled.ProxyCore.bootstrap(base,origin,true,prefix),realm);
  const instance=new realm.Worker(realm.URL.createObjectURL(new Blob(["fetch('https://cdn.example/bundled.bin')"],{type:'text/javascript'})));
  const calls=[],child=vm.createContext({URL:URLs,Request,Blob,fetch:url=>{calls.push(url);return Promise.resolve(new Response('ok'));}});
  vm.runInContext(await blobs.get(instance.url).text(),child);
  assert.equal(calls[0],origin+prefix+'cdn.example/bundled.bin');
});
