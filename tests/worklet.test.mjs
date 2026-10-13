import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {bootstrap,rewriteJS} from '../website/player/proxy-core.js';
import {routeCachedResponse} from '../website/player/cache-policy.js';
const origin='https://player.example',prefix='/player/games/.launch/12345678-abcd/full/101/gameid/';
const base='https://game.example/audio-module.js';
const source="class Processor extends AudioWorkletProcessor {process(){return true;}} registerProcessor('generic-audio',Processor);";

test('audio and paint worklets skip browser runtime hooks before registering',()=>{
  for(const kind of ['audio','paint']) {
    const registered=[];
    const realm=vm.createContext(kind==='audio'?{AudioWorkletProcessor:class {},registerProcessor:(...args)=>registered.push(args)}:{registerPaint:(...args)=>registered.push(args)});
    const module=kind==='audio'?source:"registerPaint('generic-paint',class {});";
    vm.runInContext(bootstrap(base,origin,true,prefix)+'\n'+rewriteJS(module,base,origin,prefix),realm);
    assert.equal(registered.length,1);
    assert.equal(realm.__playdeckProxyInstalled,undefined);
  }
});
test('cached worklets receive a safe bootstrap without redownloading source',async()=>{
  const registered=[];
  const request=new Request(origin+prefix+'game.example/audio-module.js');
  const cached=new Response(bootstrap(base,origin,true,prefix)+'\n'+source,{headers:{'Content-Type':'text/javascript','X-Playdeck-Network':'older-runtime','X-Playdeck-Route':prefix}});
  const repaired=await routeCachedResponse(cached,request);
  const realm=vm.createContext({AudioWorkletProcessor:class {},registerProcessor:(...args)=>registered.push(args)});
  vm.runInContext(await repaired.text(),realm);
  assert.equal(registered[0][0],'generic-audio');
});
test('worklet module URLs are proxied while receiver, options and promise survive',()=>{
  const calls=[],promise=Promise.resolve();
  class Worklet {addModule(...args){calls.push({receiver:this,args});return promise;}}
  const realm=vm.createContext({URL,Request,Worklet,fetch:async()=>new Response('ok')});
  vm.runInContext(bootstrap('https://game.example/folder/index.html',origin,true,prefix),realm);
  const worklet=new Worklet(),options={credentials:'omit'};
  assert.equal(worklet.addModule('./processor.js',options),promise);
  assert.equal(calls[0].receiver,worklet);
  assert.equal(calls[0].args[0],origin+prefix+'game.example/folder/processor.js');
  assert.equal(calls[0].args[1],options);
});
