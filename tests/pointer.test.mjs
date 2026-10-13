import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {installPointerCompatibility} from '../website/player/proxy-core.js';

function setup(request) {
  class Surface extends EventTarget {}
  class Element {}
  if(request)Element.prototype.requestPointerLock=request;
  const document=new Surface();
  document.defaultView=new Surface();
  const realm=vm.createContext({document,Element,Document:Surface,Event});
  vm.runInContext('('+installPointerCompatibility.toString()+')()',realm);
  return {document,canvas:new Element(),realm};
}
function move(surface,type,x,y,extra={}) {
  // EventTarget supplies routing; plain input models a trusted browser event.
  const event=new Event(type);
  for(const [key,value] of Object.entries({isTrusted:true,movementX:x,movementY:y,clientX:50,buttons:1,pointerType:'mouse',...extra}))
    Object.defineProperty(event,key,{value,configurable:true});
  surface.dispatchEvent(event);
  return event;
}
test('raw input falls back only on unsupported options and retains receiver',async()=>{
  const calls=[];
  const {canvas}=setup(function(options){calls.push({target:this,options});return options.unadjustedMovement?Promise.reject({name:'NotSupportedError'}):Promise.resolve();});
  await canvas.requestPointerLock();
  assert.deepEqual(calls.map(call=>call.options.unadjustedMovement),[true,false]);
  assert(calls.every(call=>call.target===canvas));
  await canvas.requestPointerLock();
  assert.equal(calls.at(-1).options.unadjustedMovement,false);
});
test('explicit acceleration choices and permission errors retain native behavior',async()=>{
  let options;
  const {canvas}=setup(function(value){options=value;return undefined;});
  assert.equal(canvas.requestPointerLock({unadjustedMovement:false}),undefined);
  assert.equal(options.unadjustedMovement,false);
  let calls=0;
  const denied=setup(()=>{calls++;return Promise.reject({name:'SecurityError'});});
  await assert.rejects(denied.canvas.requestPointerLock(),error=>error.name==='SecurityError');
  assert.equal(calls,1);
});
test('lock and unlock transitions zero both mouse streams without losing events or fast turns',()=>{
  const {document}=setup(()=>undefined);
  const surface=document.defaultView;
  for(const locked of [true,false]) {
    document.pointerLockElement=locked?{}:null;
    document.dispatchEvent(new Event('pointerlockchange'));
    for(const type of ['pointermove','mousemove']) {
      const first=move(surface,type,700,-800);
      assert.equal(first.movementX,0);assert.equal(first.movementY,0);
      assert.equal(first.clientX,50);assert.equal(first.buttons,1);
      const next=move(surface,type,1200,-900);
      assert.equal(next.movementX,1200);assert.equal(next.movementY,-900);
    }
  }
});
test('focus recovery and invalid motion are sanitized while synthetic controller and touch input survive',()=>{
  const {document}=setup(()=>undefined),surface=document.defaultView;
  surface.dispatchEvent(new Event('blur'));
  const synthetic=move(surface,'mousemove',10,20,{isTrusted:false});
  assert.equal(synthetic.movementX,10);
  assert.equal(move(surface,'pointermove',10,20,{pointerType:'touch'}).movementX,10);
  assert.equal(move(surface,'mousemove',600,500).movementX,0);
  assert.equal(move(surface,'mousemove',NaN,Infinity).movementY,0);
  assert.equal(move(surface,'mousemove',3,4).movementX,3);
});
