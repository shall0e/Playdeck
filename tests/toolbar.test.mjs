import test from 'node:test';
import assert from 'node:assert/strict';
import {installToolbar} from '../website/player/toolbar.js';
test('edge toolbar hides by default, reveals on hover or tap, and stays open for settings',t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 class Element {
  constructor(){this.events=new Map();this.attrs={};this.hidden=true;this.classes=new Set();this.classList={add:c=>this.classes.add(c),remove:c=>this.classes.delete(c)};this.children=[];this.inert=false;}
  setAttribute(k,v){this.attrs[k]=v;}addEventListener(k,v){this.events.set(k,v);}append(el){this.children.push(el);}
  querySelectorAll(){return [];}querySelector(){return null;}matches(){return false;}
  fire(type,event={}){this.events.get(type)?.(event);}
 }
 const oldDocument=globalThis.document,oldHeight=globalThis.innerHeight;
 const doc=new Element();doc.createElement=()=>new Element();doc.body=new Element();doc.pointerLockElement=null;
 globalThis.document=doc;globalThis.innerHeight=800;
 try {
  const bar=new Element();bar.id='game-menu-bar';const panel=new Element();panel.hidden=true;
  const api=installToolbar(bar,panel,{getFrame:()=>({getBoundingClientRect:()=>({top:0,height:800})})});
  assert.equal(bar.inert,true);assert.equal(bar.classes.has('is-visible'),false);
  doc.fire('pointermove',{clientY:780,pointerType:'mouse'});
  assert.equal(bar.inert,false);assert.equal(bar.classes.has('is-visible'),true);
  doc.fire('pointermove',{clientY:100,pointerType:'mouse'});t.mock.timers.tick(651);
  assert.equal(bar.classes.has('is-visible'),false);
  doc.body.children[0].fire('click');assert.equal(bar.classes.has('is-visible'),true);
  panel.hidden=false;doc.fire('pointermove',{clientY:100,pointerType:'mouse'});t.mock.timers.tick(651);
  assert.equal(bar.classes.has('is-visible'),true);
  panel.hidden=true;doc.fire('pointermove',{clientY:100,pointerType:'mouse'});t.mock.timers.tick(651);
  assert.equal(bar.classes.has('is-visible'),false);
  const child=new Element();child.defaultView={innerHeight:800};api.attach(child);
  child.fire('pointermove',{clientY:799,pointerType:'mouse'});assert.equal(bar.classes.has('is-visible'),true);
  child.pointerLockElement={};child.fire('pointerlockchange');assert.equal(bar.classes.has('is-visible'),false);
 }finally{if(oldDocument===undefined)delete globalThis.document;else globalThis.document=oldDocument;if(oldHeight===undefined)delete globalThis.innerHeight;else globalThis.innerHeight=oldHeight;}
});

